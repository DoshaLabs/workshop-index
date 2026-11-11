#!/usr/bin/env node
// Checks every entry of tiles.json the way workshop will treat it:
//
//   1. the entry itself, with core's own index rules (checkEntry);
//   2. the pinned commit, fetched exactly as core installs it (fetchCommit: one commit, no hooks,
//      submodules, LFS or symlinks, .git deleted);
//   3. the folder, with core's own `tile check` as a tile from outside (no backend);
//   4. what only the index can say: the entry matches tile.json (id, version, the same
//      permissions), and the page is there as committed (every file the entry page names exists:
//      nothing is ever built on a user's Mac);
//   5. `transcripts` with `net` (a conversation could leave the Mac) waits for a person.
//
// A tile that needs a newer workshop than core's main branch (its "workshop" range starts above
// core's bridge) cannot be fully checked yet: it is reported as waiting, not failed, as long as
// every error is one a newer core would answer (the range, or a permission core does not know).
//
// Usage: node ci/check-index.mjs tiles.json [--base base-tiles.json] [--core ci/out/core.mjs]
// Env: REVIEWED=true lets transcripts-with-net through (a maintainer's label on the PR).
// Writes a markdown report to $GITHUB_STEP_SUMMARY (or stdout). Exit 1 if anything failed.

import { mkdtemp, readFile, realpath, rm, stat, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'tiles.json'
const core = await import(pathToFileURL(resolve(opt('--core') ?? 'ci/out/core.mjs')).href)
const { checkEntry, checkTileFolder, fetchCommit, permissionWords, permissionChange, BRIDGE_VERSION, semver } = core
const reviewed = process.env.REVIEWED === 'true'

const raw = JSON.parse(await readFile(file, 'utf8'))
if (!Array.isArray(raw)) {
  console.error('tiles.json must be a JSON array of entries')
  process.exit(1)
}
let base = []
if (opt('--base')) {
  try {
    base = JSON.parse(await readFile(opt('--base'), 'utf8'))
  } catch {
    base = []
  }
}
const baseById = new Map((Array.isArray(base) ? base : []).filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]))

/** JSON with sorted keys, so two permission objects compare by content. */
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v))
const exists = (p) => stat(p).then(() => true, () => false)
const UNKNOWN_PERM = /^permissions\.[a-zA-Z]+: not a permission this core knows$/
const RANGE = /^workshop: this core implements bridge /

/** Whether a tile's range asks for a bridge newer than this core's (so its unknown words may be the new core's). */
function needsNewer(range) {
  try {
    const min = semver.minVersion(range)
    return !!min && semver.gt(min, BRIDGE_VERSION)
  } catch {
    return false
  }
}

/** Relative files the entry page names in src= and href=, which must be committed. */
async function missingFromPage(root, entry) {
  const page = join(root, entry)
  let html
  try {
    html = await readFile(page, 'utf8')
  } catch {
    return []
  }
  const missing = []
  for (const m of html.matchAll(/\s(?:src|href)\s*=\s*["']([^"'#?]+)["']/gi)) {
    const ref = m[1].trim()
    if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) continue
    const target = resolve(dirname(page), ref.startsWith('/') ? `.${ref}` : ref)
    if (!target.startsWith(root + sep)) continue
    if (!(await exists(target))) missing.push(ref)
  }
  return missing
}

const results = []
const seen = new Set()
for (const [i, item] of raw.entries()) {
  const label = item && typeof item.id === 'string' ? item.id : `entry ${i + 1}`
  const r = { id: label, commit: String(item?.commit ?? '').slice(0, 7), status: 'ok', errors: [], warnings: [], words: [], change: null, person: false }
  results.push(r)
  if (seen.has(label)) {
    r.status = 'fail'
    r.errors.push('listed twice')
    continue
  }
  seen.add(label)

  const entry = checkEntry(item)
  const entryErrors = entry.ok ? [] : entry.errors
  const future = entryErrors.length > 0 && entryErrors.every((e) => UNKNOWN_PERM.test(e))
  if (entryErrors.length && !future) {
    r.status = 'fail'
    r.errors.push(...entryErrors)
    continue
  }
  const e = entry.ok ? entry.entry : item

  const tmp = await mkdtemp(join(tmpdir(), 'tile-'))
  const dir = join(tmp, 'tile')
  try {
    try {
      await fetchCommit(e.repo, e.commit, dir)
    } catch (err) {
      r.status = 'fail'
      r.errors.push(`could not fetch ${e.repo} at ${e.commit.slice(0, 7)}: ${err.message}`)
      continue
    }
    let manifest
    try {
      manifest = JSON.parse(await readFile(join(dir, 'tile.json'), 'utf8'))
    } catch (err) {
      r.status = 'fail'
      r.errors.push(`tile.json: ${err.message}`)
      continue
    }
    const checked = await checkTileFolder(dir)
    r.warnings.push(...checked.warnings)
    const newer = typeof manifest.workshop === 'string' && needsNewer(manifest.workshop)
    const waitable = (msg) => RANGE.test(msg) || UNKNOWN_PERM.test(msg)
    if (!checked.ok) {
      if (newer && checked.errors.every(waitable)) {
        r.status = 'waiting'
        r.warnings.push(`needs workshop ${manifest.workshop}; core's main implements ${BRIDGE_VERSION}, so it is listed but installs only once core catches up (${checked.errors.join('; ')})`)
      } else {
        r.status = 'fail'
        r.errors.push(...checked.errors)
      }
    }
    if (future && !newer) {
      r.status = 'fail'
      r.errors.push(...entryErrors)
    }

    // The entry must say what tile.json says.
    if (manifest.id !== e.id) r.errors.push(`id: the entry says "${e.id}", tile.json says "${manifest.id}"`)
    if (manifest.version !== e.version) r.errors.push(`version: the entry says ${e.version}, tile.json says ${manifest.version}`)
    if (canon(manifest.permissions ?? {}) !== canon(e.permissions ?? {})) r.errors.push('permissions: must be exactly tile.json\'s, so what the menu shows before install is what the tile asks for')
    if (manifest.name !== e.name) r.warnings.push(`name: the entry says "${e.name}", tile.json says "${manifest.name}"`)

    // Nothing is built on install: the page and everything it names are in the commit.
    if (typeof manifest.entry === 'string' && !/^https?:/.test(manifest.entry)) {
      const missing = await missingFromPage(await realpath(dir), manifest.entry)
      if (missing.length) r.errors.push(`${manifest.entry} names files that are not in the commit (${missing.join(', ')}): commit the built page; nothing is built on install`)
    }
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      const scripts = Object.keys(pkg.scripts ?? {}).filter((s) => ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish'].includes(s))
      if (scripts.length) r.warnings.push(`package.json has ${scripts.join(', ')}: workshop never runs them, so the tile must work without them`)
    } catch {
      // no package.json: the usual case
    }

    const perms = manifest.permissions ?? {}
    r.words = permissionWords(perms)
    // A permission core's main does not know yet has no words: name it as it is written.
    for (const k of Object.keys(perms)) if (checked.errors.some((m) => m.startsWith(`permissions.${k}: not a permission`))) r.words.push(`${k}: ${JSON.stringify(perms[k])} (newer workshop)`)
    // Either side asking is enough: the entry is what the menu shows, tile.json is what runs.
    const ep = e.permissions ?? {}
    if ((perms.transcripts || ep.transcripts) && (perms.net?.length || ep.net?.length)) {
      r.person = true
      if (!reviewed) r.errors.push('asks for transcripts AND net: a conversation could leave the Mac. A maintainer reads the code and adds the "reviewed" label')
    }
    const before = baseById.get(e.id)
    if (!before) r.change = 'new'
    else if (before.commit !== e.commit) {
      const c = permissionChange(before.permissions ?? {}, perms)
      r.change = `${before.version} → ${e.version}` + (c.added.length ? `; now also: ${c.added.join(', ')}` : '') + (c.removed.length ? `; no longer: ${c.removed.join(', ')}` : '')
    }
    if (r.errors.length) r.status = 'fail'
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
for (const id of baseById.keys()) if (!seen.has(id)) results.push({ id, commit: '', status: 'removed', errors: [], warnings: [], words: [], change: 'removed from the index', person: false })

// The report.
const icon = { ok: '✅', waiting: '⏳', fail: '❌', removed: '➖' }
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const lines = [`## Tile index check`, '', `Checked with workshop's own rules (bridge ${BRIDGE_VERSION}).`, '', '| | Tile | Commit | Can | Change |', '|---|---|---|---|---|']
for (const r of results) lines.push(`| ${icon[r.status]} | ${cell(r.id)}${r.person ? ' **needs a person**' : ''} | \`${r.commit}\` | ${cell(r.words.join('; ') || '—')} | ${cell(r.change ?? '')} |`)
const notes = results.filter((r) => r.errors.length || r.warnings.length)
if (notes.length) {
  lines.push('')
  for (const r of notes) {
    lines.push(`### ${r.id}`)
    for (const e of r.errors) lines.push(`- error: ${e}`)
    for (const w of r.warnings) lines.push(`- warning: ${w}`)
  }
}
const report = lines.join('\n') + '\n'
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report)
console.log(report)
const failed = results.filter((r) => r.status === 'fail')
if (failed.length) {
  console.error(`${failed.length} failed: ${failed.map((r) => r.id).join(', ')}`)
  process.exit(1)
}
