# Architecture

The shell uses classic deferred scripts so it works both from `file://` and from a plain static HTTP server. All modules publish through `window.DCWeb`; load order in `index.html` is dependency order.

## Resource pipeline

```text
app.asar -> AsarArchive -> LayeredVfs -> AssetResolver -> browser runtime
                                ^
                                +-- future mod layers
```

- `core/` owns shared path and MIME rules. It has no game or browser-runtime policy.
- `archive/` reads the Electron ASAR header and byte ranges. It never creates Blob URLs and never changes game code.
- `vfs/` resolves a logical path across ordered content layers. Later layers override earlier layers. The current player mounts only `base-game`.
- `assets/` owns temporary Blob URLs, CSS dependency rewriting, and restoring Blob URLs to logical paths before saves are serialized.
- `runtime/` redirects browser fetch, XHR, Worker, DOM, CSS, and jQuery resource requests into the asset resolver.

## Compatibility and persistence

- `storage/` owns the IndexedDB save store and the existing localStorage fallback/migration.
- `compat/browser-api.js` provides the Electron-style `window.api` surface expected by the game.
- `compat/tyrano-save-adapter.js` owns Tyrano save encoding and Blob URL restoration.
- `compat/tyrano-adapter.js` owns Tyrano startup, audio unlock, and browser-specific tag behavior.
- `compat/compat.js` is a small public facade. `window.DCCompat` remains as a legacy alias.

## Game and shell

- `game/devil-connection-profile.js` contains game identity checks and the version-specific APNG compatibility transform.
- `game/game-document.js` builds the iframe entry document and rewrites its static resource references.
- `player/player-controller.js` owns mount, reload, close, and resource lifetime.
- `ui/shell-view.js` owns DOM reads and presentation state.
- `app.js` only composes the view, controller, and game profile.

## Mod boundary

A future mod loader should produce archive-like sources and append them to `LayeredVfs` with stable layer IDs. It must not modify `AsarArchive`, the storage adapter, or DOM interceptors. Saves store logical ASAR paths rather than Blob URLs or layer IDs, so the active layer set resolves them when a save is loaded.

## Compatibility globals

The following globals remain stable for game scripts and existing diagnostics:

- `window.DCAsar`
- `window.DCVfsRuntime`
- `window.DCCompat`
- iframe `window.__ASAR_VFS__`
- host `window.__dcActiveArchive` (legacy alias of `__dcActiveResolver`)

When the full host script chain has initialized, the document root carries `data-dc-shell-ready="true"` for lightweight diagnostics.
