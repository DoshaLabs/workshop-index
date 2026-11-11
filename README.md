# workshop-index

The list of tiles anyone can install in [workshop](https://github.com/DoshaLabs/workshop), from
the Marketplace tab of the `+` menu at the foot of the tile column. Workshop reads `tiles.json`
from this repo's main branch:

```
https://raw.githubusercontent.com/DoshaLabs/workshop-index/main/tiles.json
```

A tile is not uploaded here. It lives in its author's own git repo; the index names the repo and
pins one commit, and install fetches exactly that commit. Moving the pin is how a tile updates.

## Submit a tile

1. Build the tile in its own public GitHub repo. Start from workshop's `+` menu, "Build a new
   tile", or from `template/` in the workshop repo. The built page must be committed (`dist/`):
   nothing is ever built on a user's Mac.
2. Run `workshop tile check .` in the tile's folder until it says `ok`.
3. Push, and copy the full commit id (`git rev-parse HEAD`).
4. Open a pull request here that adds one entry to `tiles.json`:

```json
{
  "id": "focus-timer",
  "name": "Focus timer",
  "author": "your-github-name",
  "hint": "One line, as in tile.json",
  "repo": "https://github.com/you/workshop-focus-timer",
  "commit": "the full 40-character commit id",
  "version": "0.1.0",
  "permissions": { "storage": true, "notify": true },
  "category": "tools"
}
```

`id`, `version` and `permissions` must be exactly what `tile.json` says at that commit.
`category` is one of `tools`, `notes`, `sessions`, `media`, `games`, `emulators`, `fun`, `other`.

To release a new version, open a pull request that moves `commit` and `version`. If the new
version asks for more, workshop asks its users again before it updates.

## What the check does

Every pull request runs `.github/workflows/check.yml`. It checks every entry with workshop's own
code, taken from the workshop repo's main branch (`ci/core.ts`), not a copy of its rules:

- the entry, with the same rules workshop uses to read the index;
- the pinned commit, fetched the way workshop installs it: one commit, no hooks, no submodules,
  no LFS, symlinks as plain files, and `.git` deleted;
- the folder, with `workshop tile check` as a tile from outside: no backend, the page and icon
  inside the folder;
- that the page and every file it names are in the commit (nothing is built on install), and that
  the entry matches `tile.json`.

The check's summary lists what each tile can do in plain words, and for an update what it now
also asks for.

A tile that asks for both `transcripts` and `net` could send a conversation off the Mac. The
check fails for it until a maintainer has read the code and added the `reviewed` label.

A tile written for a newer workshop than the main branch (its `"workshop"` range starts above
it) is listed as waiting: workshop shows it and installs it once the app has caught up.

Not accepted, ever: games, ROMs, disc images or BIOS files. An emulator tile may be listed; it
must ship with none of them.

## Who reviews what

The check is advice for the maintainers, who merge. A pull request that changes `ci/` or
`.github/` is read line by line, since the check runs from the pull request itself.

## Licence

MIT. Each tile has its own licence, in its own repo.
