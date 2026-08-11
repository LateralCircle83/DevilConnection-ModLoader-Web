# AGENTS.md

This is the sole agent-facing architecture and maintenance document for the repository. `README.md` is user-facing Chinese documentation; do not move internal implementation detail into it. Record meaningful completed changes in `HISTORY.md`.

## Objective

Maintain a static browser shell that runs a user-provided Devil Connection `app.asar` without extracting, rewriting, uploading, or redistributing game content.

The application has no build step, package manager, backend, Service Worker, or production Node.js dependency. `index.html` loads classic deferred scripts in dependency order. Modules publish only through `window.DCWeb`.

## Non-negotiable constraints

- Never unpack, rewrite, stage, or commit `*.asar` or `*.asar.unpacked` content.
- Treat local ASAR files as user-owned test fixtures. Read them only when the task requires an end-to-end launch test.
- Do not add game assets, extracted source, or copyrighted content to the repository.
- Keep archive access read-only and range-based. `AsarArchive` may parse the header and return `File.slice()` blobs; it must not own URL creation or runtime policy.
- Do not commit unless the user explicitly requests a commit.
- Preserve unrelated dirty-worktree changes.
- Keep the app usable from a plain static server. Do not introduce a required build tool or server API.
- Prefer existing ES5-style IIFE modules and repository conventions over a framework migration.

## Runtime architecture

```text
user app.asar
  -> AsarArchive
  -> LayeredVfs [base-game, future mod layers]
  -> AssetResolver + ObjectUrlRegistry + StyleProcessor
  -> GameDocument iframe bootstrap
  -> Browser Runtime + Electron/Tyrano adapters
  -> TYRANO.init
```

The shell and game run in separate realms:

- The host document owns file selection, session lifecycle, UI, the resolver, and Blob URL lifetime.
- The game runs in `iframe[srcdoc]` using the archive's rewritten `index.html`.
- The host publishes the active resolver only as the internal `window.__dcActiveResolver` bridge before iframe navigation.
- Inside the iframe, `window.api`, `window.process`, and `window.__dirname` emulate contracts used by the original Electron game.
- `window.DCWeb` is the only public shell namespace.

Do not reintroduce removed aliases: `window.DCAsar`, `window.DCVfsRuntime`, `window.DCCompat`, `window.__dcActiveArchive`, or iframe `window.__ASAR_VFS__`. Pass the resolver explicitly after bootstrap.

## Startup sequence

1. `index.html` loads modules in dependency order.
2. `app.js` constructs `ShellView` and `PlayerController`, binds events, and sets `data-dc-shell-ready="true"`.
3. The user selects an `app.asar`.
4. `AsarArchive.open(file)` parses and validates the Electron ASAR header.
5. `PlayerController` mounts the archive as `base-game` in `LayeredVfs`.
6. `DevilConnectionProfile.validate()` checks required paths and `package.json.name === "devil-connection"`.
7. `AssetResolver.prepareStyles()` rewrites CSS dependencies; the game profile prepares the APNG compatibility transform in memory.
8. `GameDocument.build()` parses archive `index.html`, injects the runtime/bootstrap, replaces `electron_latest.js`, and rewrites static resource attributes.
9. The resulting document is assigned to the game iframe through `srcdoc`.
10. Runtime interceptors route local fetch, XHR, Worker, DOM, CSS, markup, srcset, and jQuery resource requests through the active resolver.
11. `TyranoAdapter` waits for a user gesture and `api.storage.ready`, unlocks audio, then calls the original `TYRANO.init()`.
12. Tyrano loads `Config.tjs`, the KAG runtime, and the initial scenario through VFS-backed requests.

## Module ownership

- `js/core/namespace.js`: creates `window.DCWeb` only.
- `js/core/resource-path.js`: canonical path parsing, URL suffix handling, encoding, CSS-relative resolution, and MIME lookup.
- `js/archive/asar-archive.js`: ASAR header/index parsing and read-only byte-range access.
- `js/vfs/layered-vfs.js`: ordered content resolution. Later layers override earlier layers.
- `js/assets/object-url-registry.js`: Blob URL creation, reverse mapping, encoded URL restoration, and revocation.
- `js/assets/style-processor.js`: recursive CSS dependency preparation and URL rewriting.
- `js/assets/asset-resolver.js`: facade joining VFS, prepared text, style processing, and URL lifetime.
- `js/runtime/resource-rewriter.js`: pure CSS, markup, and srcset rewriting helpers.
- `js/runtime/browser-runtime.js`: iframe fetch/XHR/Worker/DOM/CSS/jQuery interception and cross-realm binary copying.
- `js/storage/browser-save-store.js`: IndexedDB cache, queued writes, fallback, and migration.
- `js/compat/browser-api.js`: minimal Electron preload-compatible `window.api`.
- `js/compat/tyrano-save-adapter.js`: Tyrano save encoding and Blob URL restoration before serialization.
- `js/compat/tyrano-adapter.js`: Tyrano browser patches, storage-gated startup, audio unlock, and runtime telemetry.
- `js/game/devil-connection-profile.js`: game identity requirements and version-specific in-memory patches.
- `js/game/game-document.js`: iframe document construction and static entry rewriting.
- `js/player/player-controller.js`: mount/reload/close orchestration and session resource lifetime.
- `js/ui/shell-view.js`: host DOM, full-screen player menu, focus behavior, and presentation state.
- `js/app.js`: composition only; do not place feature logic here.

Keep behavior in the narrowest owning module. Do not create generic compatibility facades or duplicate module globals.

## Resource invariants

- Normalize every archive-like resource path through `DCWeb.ResourcePath`; do not implement path parsing ad hoc in consumers.
- Archive lookup ignores query strings and fragments. Generated object URLs retain the original fragment but intentionally drop cache-busting query strings.
- Absolute HTTP/file paths may intentionally resolve to archive entries when they contain anchored `data/` or `tyrano/` segments.
- `data:`, `blob:`, `javascript:`, `mailto:`, `tel:`, fragment-only, missing, and otherwise unsupported resources must pass through unchanged.
- `AssetResolver` owns generated URLs. Release the previous resolver only after replacement iframe navigation completes.
- CSS files must be prepared dependency-first so nested `@import` and `url()` references never retain stale Blob URLs.
- Values crossing into the iframe realm may require realm-local `ArrayBuffer`, `Blob`, `Response`, or event objects.
- The runtime must continue to support range requests used by media loaders.

## Save invariants

- Primary store: IndexedDB database `devil_connection_web_shell`, object store `saves`, schema version `1`.
- Fallback keys use the `dc-shell:` localStorage prefix.
- Keep the localStorage fallback and migration; it is active recovery behavior, not obsolete legacy support.
- Save reads are synchronous from the in-memory cache after `storage.ready` resolves.
- Failed IndexedDB flushes must preserve pending keys for retry and publish `data-dc-storage-error`.
- Before JSON serialization, restore known Blob URLs, including percent-encoded and double-encoded forms, to encoded logical ASAR paths.
- Never persist Blob URLs or VFS layer IDs. A later session must resolve saved logical paths against its current layers.
- Browser storage is origin-specific. Do not imply that saves automatically follow hostname or port changes.

## Future mod boundary

Mod support must be implemented as additional archive-like sources in `LayeredVfs`, with stable layer IDs and explicit ordering. Later layers override earlier ones. Do not modify the base ASAR, fork the save format, or add mod-specific branches to `AsarArchive`, runtime interceptors, or storage.

Mod code/config execution needs an explicit trust model and belongs in dedicated modules. The current player mounts only `base-game`.

## UI invariants

- The game iframe fills the viewport; shell controls overlay it rather than reserving layout space.
- The top-left player menu trigger must remain keyboard accessible and visible against arbitrary game scenes.
- The full-screen menu must retain Escape/close behavior, focus containment, focus restoration, and mobile single-column layout.
- Keep fixed controls stable in size and account for safe-area insets.
- Do not expose implementation instructions or debug descriptions as normal in-app copy.

## Verification

Run after relevant changes:

```powershell
node tests\url-edge-cases.test.js
Get-ChildItem js -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
git diff --check
git status --short
```

For browser-facing changes, serve the repository and verify at desktop and mobile widths:

```powershell
.\start_server.bat
```

Minimum browser checks:

- Host root has `data-dc-shell-ready="true"` with no console initialization errors.
- Selecting a valid archive reaches the Tyrano click-to-start overlay.
- Static and dynamic images, CSS backgrounds, audio, video, APNG, and scenario loads resolve.
- Saving, refreshing, and loading does not request stale Blob URLs.
- Reload and close release or replace session URLs at the correct time.
- Player menu has no clipping/overflow and restores focus correctly.

Before any requested commit, inspect staged paths and confirm that no ASAR or extracted game content is included.
