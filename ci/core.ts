// What the check borrows from workshop itself, bundled by esbuild from a checkout of
// DoshaLabs/workshop at core/ (see .github/workflows/check.yml). Nothing here is a copy: the index
// is checked with the same code that reads it, installs from it and loads the tiles in the app.

export { checkEntry } from '../core/src/shared/tile-index'
export { BRIDGE_VERSION } from '../core/src/shared/manifest'
export { permissionWords, permissionChange } from '../core/src/shared/permissions'
export { checkTileFolder } from '../core/src/main/tile-check'
export { fetchCommit } from '../core/src/main/install'
export { default as semver } from '../core/node_modules/semver/index.js'
