# AGENTS.md

This is the sole agent-facing architecture and maintenance document for the repository. `README.md` is user-facing Chinese documentation; do not move internal implementation detail into it. Planned work and patch decisions live in `TODO.md`; record meaningful completed changes in `HISTORY.md`.

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
user app.asar -> AsarArchive
user mod ASARs -> ModPackage -> ModPlan
  -> LayeredVfs [base-game, enabled mods in UI order]
  -> SessionPreparer
     -> DevilConnectionProfile required in-memory transforms
     -> Host kernel resource preparation
  -> GameDocument iframe bootstrap
  -> Browser Runtime + Electron/Tyrano adapters
  -> TYRANO.init
```

The shell and game run in separate realms:

- The host document owns file selection, session lifecycle, UI, the resolver, and Blob URL lifetime.
- The game runs in `iframe[srcdoc]` using the archive's rewritten `index.html`.
- The host publishes the active resolver, immutable launch-time mod plan, launch ID, and per-session launch token through internal `window.__dcActive*` bridges before iframe navigation.
- Inside the iframe, `window.api`, `window.process`, and `window.__dirname` emulate contracts used by the original Electron game.
- `window.DCWeb` is the only public shell namespace.

Do not reintroduce removed aliases: `window.DCAsar`, `window.DCVfsRuntime`, `window.DCCompat`, `window.__dcActiveArchive`, or iframe `window.__ASAR_VFS__`. Pass the resolver explicitly after bootstrap.

## Startup sequence

1. `index.html` loads modules in dependency order.
2. `js/shell/app.js` constructs the view, player, save manager, and their controllers, binds events, and sets `data-dc-shell-ready="true"`.
3. The controller first attempts to restore previously granted local file handles without prompting. Otherwise the user selects an `app.asar`; `PlayerController.loadCore()` parses it and validates the base archive in isolation.
4. The user optionally imports mod ASARs. `ModPackage` reads each archive index and metadata, while the manager owns enable state and ordering.
5. Loading the core or changing the mod list asks `SessionPreparer` to build a prepared session. `ModPlan.create()` freezes that revision and `LayeredVfs` is built as `[base-game, mod 1, mod 2, ...]`; later enabled mods override earlier layers.
6. The selected game profile runs required, strictly matched in-memory transforms against that final layered resource view and returns per-patch status records.
7. The host kernel prepares browser resource representations such as dependency-ordered CSS from the resulting active resource view.
8. `GameDocument.build()` parses the resulting archive `index.html`, injects the runtime/bootstrap, replaces `electron_latest.js`, and rewrites static resource attributes.
9. The resulting document is assigned to a non-interactive game iframe through `srcdoc` before the user starts the game.
10. Runtime interceptors route local fetch, XHR, Worker, DOM, CSS, markup, srcset, and jQuery resource requests through the prepared resolver.
11. `ModRuntime` installs the bounded DCML compatibility API immediately, then executes enabled `hook.js` files in UI order after `DOMContentLoaded` so `document.body` exists.
12. `TyranoAdapter` installs the bounded KAG preload scheduler, intercepts the automatic `TYRANO.init()` call, and reports readiness with the per-session launch token only after `ModRuntime.ready` settles. Do not rely on strict `MessageEvent.source` identity for `srcdoc` messages.
13. The host start button becomes enabled only after that handshake. Its trusted click synchronously calls the already-loaded same-origin iframe, unlocks audio, and starts the original `TYRANO.init()` without another overlay.
14. Tyrano loads `Config.tjs`, the KAG runtime, and the initial scenario through VFS-backed requests.

## Module ownership

The source tree has five top-level responsibility domains. Add files to the narrowest existing domain; do not recreate one-folder-per-primitive layout.

- `js/kernel/`: non-optional browser host infrastructure. It owns the namespace, resource paths, read-only ASAR access, layered VFS, object URLs, CSS preparation, resource rewriting, browser runtime, Electron/Tyrano adapters, IndexedDB save storage, and iframe document construction.
- `js/profiles/`: game-specific required compatibility. `profile-runner.js` executes declared patches, `devil-connection-apng.js` owns the APNG transform, and `devil-connection.js` owns game identity, title reading, and the patch list.
- `js/mods/`: DCML package, ordering, hook, and configuration compatibility. Later enabled VFS layers win, but hooks execute individually in UI order.
- `js/shell/`: manager UI and orchestration. `session-preparer.js` is the only launch-time crossing point; `player-controller.js` owns session lifetime; compatibility, save, source, and view modules own their corresponding manager behavior; `app.js` is composition only.
- `js/vendor/`: third-party libraries retained without application ownership.

Within `js/kernel/`, preserve the existing narrow contracts: `asar-archive.js` only exposes indexed byte ranges, `layered-vfs.js` only resolves ordered content, `asset-resolver.js` owns prepared resources and URL lifetime, and `tyrano-preload-scheduler.js` owns only the transient bounded KAG preload queue. It must not become a permanent media cache or a global fetch/XHR/Range interceptor. Adapters do not absorb game-version source transforms.

Keep behavior in the narrowest owning module. Do not create generic compatibility facades or duplicate module globals.

## Resource invariants

- Normalize every archive-like resource path through `DCWeb.ResourcePath`; do not implement path parsing ad hoc in consumers.
- Archive lookup ignores query strings and fragments. Generated object URLs retain the original fragment but intentionally drop cache-busting query strings.
- Absolute HTTP/file paths may intentionally resolve to archive entries when they contain anchored `data/` or `tyrano/` segments.
- `data:`, `blob:`, `javascript:`, `mailto:`, `tel:`, fragment-only, missing, and otherwise unsupported resources must pass through unchanged.
- `AssetResolver` owns generated URLs. Release the previous resolver only after replacement iframe navigation completes.
- Prepared in-memory resources are the active session view for `getBlob()`, `readText()`, and `getObjectUrl()`; consumers must not bypass the resolver to read an untransformed VFS entry.
- CSS files must be prepared dependency-first so nested `@import` and `url()` references never retain stale Blob URLs.
- Values crossing into the iframe realm may require realm-local `ArrayBuffer`, `Blob`, `Response`, or event objects.
- Any Node-like global shim used with `instanceof` must be callable. In particular, keep `ModRuntime`'s `Buffer` shim as a function; the game's OGG metadata library performs `buffer instanceof Buffer` even when no mods are enabled.
- The runtime must continue to support range requests used by media loaders.

## Save invariants

- Primary store: IndexedDB database `devil_connection_web_shell`, object store `saves`, schema version `1`.
- Fallback keys use the `dc-shell:` localStorage prefix.
- Keep the localStorage fallback and migration; it is active recovery behavior, not obsolete legacy support.
- Save reads are synchronous from the in-memory cache after `storage.ready` resolves.
- Failed IndexedDB flushes must preserve pending keys for retry and publish `data-dc-storage-error`.
- Before JSON serialization, restore known Blob URLs, including percent-encoded and double-encoded forms, to encoded logical ASAR paths.
- Never persist Blob URLs or VFS layer IDs. A later session must resolve saved logical paths against its current layers.
- Mod-origin Blob URLs use the same registry and restoration path as base-game URLs. Saves deliberately do not bind or persist a mod selection.
- Browser storage is origin-specific. Do not imply that saves automatically follow hostname or port changes.
- Manager ZIP exchange is restricted to original-compatible keys: `DevilConnection_*` plus `NEO`. Each key maps to `encodeURIComponent(key) + '.sav'`, and file contents remain in their existing Tyrano representation.
- Validate the whole ZIP and decode every target save before mutation. Accept raw JSON, URI encoding, legacy `escape`, and LZString representations, then normalize imported values to UTF-8 `encodeURIComponent(JSON)` storage. Imports update all included keys in one IndexedDB transaction and preserve keys absent from the archive.
- Fully navigate away from any prepared iframe before import or clear so its `pagehide` flush cannot restore stale values, then build a fresh prepared session.
- Clear removes only original-compatible save keys. Keep `file:*` compatibility data, mod config, and remembered local file handles in their separate ownership domains.

## Local source persistence

- Persist only `FileSystemFileHandle` objects plus mod order/enabled state in the dedicated `devil_connection_web_sources` IndexedDB database. Never copy ASAR `Blob`, `File`, `ArrayBuffer`, headers, or extracted entries into browser storage.
- Automatic restoration may only use handles whose read permission is already `granted`. A `prompt` state must remain behind the user-initiated restore button because permission requests require a user gesture.
- File picker and handle persistence are progressive enhancement. Preserve hidden file inputs as the fallback when File System Access API or IndexedDB is unavailable.
- A manual fallback selection has no reusable handle and must clear the remembered source set rather than retaining stale handles.
- Persist changes after core selection and mod add/remove/reorder/toggle operations. Config values remain independent in `ModConfigStore`.

## Mod boundary

- Mods are additional read-only `AsarArchive` sources with stable `mod:<id>` layer IDs. Never modify the base archive or fork resource lookup outside `LayeredVfs`.
- UI order is semantic: packages load top-to-bottom and later enabled layers win. Reordering must update the displayed list without mutating an active session.
- Launch plans are immutable for a running iframe. Exit before changing the effective mod set.
- Hooks execute individually in package order; never read a merged `hook.js`, because that would execute only the last override.
- Hooks may create body-level controls. Preserve the `DOMContentLoaded` execution boundary and keep the host ready handshake dependent on `ModRuntime.ready`.
- Synchronous hook reads come from `ModPackage`'s text cache. Binary resources continue through `AssetResolver` and shared runtime interceptors.
- Config binding follows the ASAR file bare name after removing an optional numeric load-order prefix, and the upstream `plugins/config/<bareName>.json` contract. Manager edits, `ModLoader`, `electronAPI`, `require('fs')`, and `window.api` must share `ModConfigStore`; do not invent a Web-only mod config API.
- `config.schema.json` is manager-owned metadata. Render supported fields with DOM APIs, apply defaults only in the form, and persist small config JSON through the upstream-compatible `mod_config_<bareName>` localStorage key rather than the save database.
- Keep compatibility bounded. Do not add arbitrary filesystem writes, remote catalog loading, base-ASAR mutation, or full-archive buffers.
- Hook code is trusted renderer code. Preserve the visible trust warning and do not imply sandbox isolation.

## Patch placement policy

Treat patching as three responsibility layers, not as three ordinary VFS override layers:

1. **Host kernel** owns browser-required infrastructure independent of one game source version: archive access, VFS, resource rewriting, browser/Electron/Tyrano contracts, storage, startup, and lifecycle cleanup. Keep this stable and non-optional.
2. **Game compatibility profile** owns minimal, version-gated in-memory transformations required to preserve original behavior in a browser. It runs against the final resource selected by the base-plus-mod VFS. A required transform must declare its target, strict source signature, expected match count, failure behavior, and tests. Never copy a complete game or Tyrano source file into the repository.
3. **Mods** own optional performance policies, experience changes, features, and content-specific corrections. Preserve user control and later-wins ordering; do not promote an optional optimization into the non-disableable profile.

Because profile transforms see the final mod-overlaid resource, they may constrain a mod that replaces the same path. Only genuine browser requirements belong there. Prefer adapter-level interception when a stable runtime contract exists; use source transformation only when the behavior cannot be corrected at a narrower boundary.

`SessionPreparer` enforces the launch-time crossing order: immutable base-plus-mod VFS, required profile transforms, host browser-resource preparation, then `GameDocument`. Do not reproduce this sequence in `PlayerController`, a profile, or a mod module. Runtime host adapters remain non-optional after iframe bootstrap; mod hooks remain ordered user extensions rather than part of profile preparation.

`ProfileRunner` is deliberately small and declarative. Every patch entry must provide an ID, target, required flag, strict signatures with expected counts, failure policy, and transform. It publishes serializable status records and aborts the prepared session when a required target is absent, unsupported, or fails. Keep patch transforms in their own profile files; do not turn the runner into a general plugin API or allow manager-side patch toggles for required compatibility.

The compatibility manager page is an observer, not an executor. It displays the report produced during session preparation and may export metadata-only JSON containing the profile, patch states, game version, and enabled mod identities. It must never export local file paths, handles, archive bytes, extracted content, or hook source. Consult `TODO.md` for accepted, conditional, deferred, and rejected candidates from the old-project audit.

## UI invariants

- The game iframe fills the viewport; shell controls overlay it rather than reserving layout space.
- The manager document title is `DevilConnection Modloader web`. The active player title comes from the final layered VFS `data/system/Config.tjs` `System.title`, so an enabled mod override may intentionally change it; closing the session restores the manager title.
- The manager has separate core-load and start commands. Start must stay disabled until isolated base-game validation and the prepared iframe handshake both succeed.
- Mod controls must communicate top-to-bottom load order and later-wins precedence; build imported metadata with DOM APIs, never manifest `innerHTML`.
- The compatibility page must describe required transforms without presenting disable controls. A failed required transform automatically opens that page and leaves Start disabled.
- The top-left player menu trigger must remain keyboard accessible and visible against arbitrary game scenes.
- The full-screen menu must retain Escape/close behavior, focus containment, focus restoration, and mobile single-column layout.
- Keep fixed controls stable in size and account for safe-area insets.
- Do not expose implementation instructions or debug descriptions as normal in-app copy.

## Verification

Run after relevant changes:

```powershell
node tests\url-edge-cases.test.js
node tests\mod-loader.test.js
node tests\mod-config.test.js
node tests\mod-config-controller.test.js
node tests\game-profile.test.js
node tests\browser-save-store.test.js
node tests\save-manager.test.js
node tests\save-manager-controller.test.js
node tests\local-source-store.test.js
node tests\source-restore-controller.test.js
node tests\profile-runner.test.js
node tests\session-preparer.test.js
node tests\compatibility-controller.test.js
node tests\tyrano-preload-scheduler.test.js
node tests\start-gate.test.js
node tests\player-controller.test.js
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
- Selecting a valid archive prepares the iframe and enables the host start button only after its authenticated ready message; the click reaches the prepared game directly without a second overlay.
- The initial `system/plugin.ks` audio preload must leave `lwaitload`, report zero VFS XHR failures, and reach the title scenario with and without a hook mod.
- Imported standard and legacy-header mod ASARs render, reorder, toggle, and override resources in later-wins order.
- Static and dynamic images, CSS backgrounds, audio, video, APNG, and scenario loads resolve.
- Saving, refreshing, and loading does not request stale Blob URLs.
- Reload and close release or replace session URLs at the correct time.
- Player menu has no clipping/overflow and restores focus correctly.

Before any requested commit, inspect staged paths and confirm that no ASAR or extracted game content is included.
