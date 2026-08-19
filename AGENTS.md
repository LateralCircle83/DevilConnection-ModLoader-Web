# AGENTS.md

This is the sole agent-facing architecture, invariant, and verification document for the repository. Keep documentation ownership strict: `README.md` is the user-facing Chinese guide and current support matrix; root `LICENSE` is the unmodified AGPL-3.0-only text for project-owned code; `docs/TODO.md` contains only unresolved work, deferred decisions, and rejected proposals; `docs/HISTORY.md` contains meaningful completed changes and investigation results; `docs/THIRD_PARTY_NOTICES.md` contains only upstream origins, copyright notices, and third-party license terms; `docs/ModsUsage.md` is a read-only upstream specification snapshot, not this project's compatibility promise. Do not duplicate implementation rules, test commands, completed work, or license text across those files. Cross-link to the owning document instead.

## Objective

Maintain a static browser shell that runs a user-provided Devil Connection `app.asar` without extracting, rewriting, uploading, or redistributing game content.

The application has no build step, installed package dependencies, backend, Service Worker, or production Node.js dependency. Root `package.json` provides the zero-install cross-platform `npm start` convenience command for the existing development server; it must not become a build or runtime requirement. `index.html` loads classic deferred scripts in dependency order. Modules publish only through `window.DCWeb`.

## Non-negotiable constraints

- Never unpack, rewrite, stage, or commit the game archive, arbitrary user-provided `*.asar`, or any `*.asar.unpacked` content. Curated packages directly under `recommended-mods/` are the sole exception and may be versioned when the maintainer has selected them for the bundled catalog.
- Treat all other local ASAR files as user-owned test fixtures. Read them only when the task requires an end-to-end launch test. Keep the root `/app.asar` ignored; curated packages belong directly under `recommended-mods/`.
- Do not add game assets, extracted source, or copyrighted content to the repository.
- Keep root `LICENSE` byte-for-byte equivalent to the official GNU AGPL version 3 text. Put scope and third-party exceptions in `README.md` and `docs/THIRD_PARTY_NOTICES.md`, never in the license text.
- Keep archive access read-only and range-based. `AsarArchive` may parse the header and return `File.slice()` blobs; it must not own URL creation or runtime policy.
- Do not commit unless the user explicitly requests a commit.
- Preserve unrelated dirty-worktree changes.
- Keep the app usable from a plain static server. Do not introduce a required build tool or server API.
- Keep `npm start` dependency-free and routed through `tools/static-server.js`; do not replace its file allowlist with a generic repository-wide server.
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
6. The selected game profile evaluates required, strictly matched in-memory transforms against that final layered resource view and returns per-patch status records. A strict mismatch skips that transform; it does not authorize a best-effort rewrite.
7. The host kernel prepares browser resource representations such as dependency-ordered CSS from the resulting active resource view.
8. `GameDocument.build()` parses the resulting archive `index.html`, injects the runtime/bootstrap, replaces `electron_latest.js`, and rewrites static resource attributes.
9. The resulting document is assigned to a non-interactive game iframe through `srcdoc` before the user starts the game.
10. Runtime interceptors route local fetch, XHR, Worker, DOM, CSS, markup, srcset, and jQuery resource requests through the prepared resolver.
11. `ModRuntime` installs the bounded DCML compatibility API immediately, then executes enabled `hook.js` files in UI order after `DOMContentLoaded` so `document.body` exists.
12. `TyranoAdapter` installs the bounded KAG preload scheduler, intercepts the automatic `TYRANO.init()` call, and reports readiness with the per-session launch token only after storage and `ModRuntime.ready` settle. Do not rely on strict `MessageEvent.source` identity for `srcdoc` messages.
13. The host start button becomes enabled only after that handshake. Its trusted click synchronously calls the already-loaded same-origin iframe, unlocks audio, and starts the original `TYRANO.init()` without another overlay.
14. Tyrano loads `Config.tjs`, the KAG runtime, and the initial scenario through VFS-backed requests.

Only the latest iframe navigation may retain a pending `load` callback. Superseded prepared sessions remain queued until the latest replacement document loads, then release together. Reloading an active session must rotate its launch ID and token, and every delayed reload continuation must confirm that both the session and reload generation are still current before replacing `srcdoc`.

## Module ownership

The source tree has five top-level responsibility domains. Add files to the narrowest existing domain; do not recreate one-folder-per-primitive layout.

- `js/kernel/`: non-optional browser host infrastructure. It owns the namespace, resource paths, read-only ASAR access, layered VFS, object URLs, CSS preparation, resource rewriting, decoded-image/playable-video readiness, bounded fragmented-MP4 recovery, last-resort progressive-MP4 visual recovery, bounded iframe console monitoring, browser runtime, Electron/Tyrano adapters, IndexedDB save storage, and iframe document construction.
- `js/profiles/`: game-specific required compatibility. `profile-runner.js` executes declared text or bounded binary patches, `devil-connection-apng.js` owns the APNG transform, `devil-connection-silent-videos.js` owns the exact-version silent-track transforms, `devil-connection-remodal.js` owns the exact-version Remodal layout transform, `devil-connection-collection-scroll.js` owns the exact-version collection touch-scroll boundary, `devil-connection-foreground-movies.js` owns the exact-version foreground movie input locks, `devil-connection-audio-ogg.js` owns the exact-version Safari/WebKit OGG format gate, and `devil-connection.js` owns game identity, title reading, and the patch list.
- `js/mods/`: DCML package, ordering, hook, and configuration compatibility. Later enabled VFS layers win, but hooks execute individually in UI order.
- `js/shell/`: manager UI and orchestration. `session-preparer.js` is the only launch-time crossing point; `player-controller.js` owns session lifetime; `player-runtime-controls.js` owns whitelisted synthetic keys and diagnostics snapshot access; compatibility, save, source, recommended-mod catalog, and view modules own their corresponding manager behavior; `app.js` is composition only.
- `js/vendor/`: third-party libraries retained without application ownership.

Within `js/kernel/`, preserve the existing narrow contracts: `asar-archive.js` only exposes indexed byte ranges, `layered-vfs.js` only resolves ordered content, and `asset-resolver.js` owns prepared resources and URL lifetime. `resource-readiness.js` owns bounded decode/playability waits and telemetry but must not change video visibility; `media-source-fallback.js` owns strict fragmented-MP4 inspection and one-buffer append but must not create URLs or decide retry policy. `mp4-visual-fallback.js` owns range-based progressive-MP4 structure inspection and construction of an equal-length video-only Blob, but likewise must not create URLs, retry elements, or decide policy. `tyrano-preload-scheduler.js` owns only the transient bounded KAG preload queue. `tyrano-jump-guard.js` owns only the asynchronous jump critical section: it sets `is_strong_stop` before the current jump implementation runs and leaves `nextOrderWithLabel()` responsible for clearing it. `tyrano-touch-guard.js` owns event-layer advance deduplication: after KAG init it removes the duplicate `tap` advance binding from the body-level `.layer_event_click` clone so the game's set-based tap polyfill delivers exactly one `nextOrder()` per touchend while letterbox taps still reach the in-game handler through the set trigger. It may apply the game's own final `$.event.tap` semantics early (no `preventDefault` or touchstart `stopPropagation`) so the event layer binds the intended behavior from the start and the game's tap_effect ripple fires on dialogue taps; it must not introduce Web-only tap behavior, add global click/touch deduplication, or alter glink/button/clickable/edit bindings. `tyrano-bg-guard.js` owns latest-wins ordering for background application: it stamps each `[bg]`/`[bg2]` request with a monotonic sequence number and drops stale preload callbacks at delivery so the base-layer background always matches the last requested storage; the `[movie_with_bg]` late background write participates in the same slot and is corrected when a newer request supersedes it. `tyrano-chara-guard.js` owns latest-wins ordering for character application: it stamps `[chara_show]`/`[chara_mod]` requests per character name with separate show/mod counters and drops stale preload callbacks so the newest pose wins while a pending show still lands (a newer mod must not cancel the element creation). Neither guard may reorder other preloads, mutate the applied CSS/DOM itself, or alter the game's wait/crossfade semantics. None may become a permanent media cache or a global fetch/XHR/Range interceptor. Adapters do not absorb game-version source transforms.

`tyrano-video-unlock.js` owns autoplay-policy recovery for managed movie videos: when a `[movie]`/`[movie_with_bg]` element's `play()` rejects with `NotAllowedError`, it immediately replays muted to preserve the authored visual timeline, then restores the game's intended mute state and sound at the first in-iframe pointer or key gesture; it must not change video visibility, alter skip/wait semantics, or touch unmanaged media.

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
- Console monitoring is limited to iframe-main-world `warn`, `error`, uncaught errors, and unhandled rejections. Keep at most 160 serialized entries of at most 2400 characters, retain no original argument references, preserve native console calls, and do not attempt to capture extension isolated worlds, browser internals, or Worker console output.
- Synthetic player input is a Shell feature, not a Game Profile transform. Dispatch only declared keys using the iframe realm's `KeyboardEvent`, provide legacy `keyCode`/`which`, and release every held key on menu close, host blur, reload, exit, or teardown. Never represent these untrusted events as browser user activation.
- The runtime must continue to support range requests used by media loaders.
- Never globally hide managed images for readiness. The Tyrano adapter may delay the stable `image` tag boundary until its source preload and `decode()` complete, but the original tag must retain ownership of node insertion, `display`, `visibility`, `opacity`, transition timing, waits, and scenario progression. Video readiness may delay an existing preload callback and publish telemetry, but must not change visual state; the game's own `movie_with_bg` timing remains authoritative.
- If a managed MP4/M4V fails with `MEDIA_ERR_SRC_NOT_SUPPORTED`, Browser Runtime may request one bounded `MediaSource` representation from `AssetResolver` and retry that element once. The fallback must require `ftyp/moov/mvex/moof`, derive AVC/AAC codecs from `avcC/esds`, pass `MediaSource.isTypeSupported()`, stay at or below 16 MiB, time out append after 15 seconds, and release its `SourceBuffer`, `MediaSource`, bytes, and transient URL on source change or session release.
- If the MediaSource representation is unavailable or fails, Browser Runtime may make one final visual-only attempt only for a managed progressive MP4/M4V with `ftyp/moov/mdat`, no `mvex/moof`, exactly one H.264 track, and exactly one AAC track. Inspect top-level boxes by bounded slices, cap `moov` reads at 4 MiB, preserve all byte positions by replacing only the audio `trak` type in a composite Blob, and never read or copy the full file merely to recover it. Emit one `console.warn` containing the logical path, VFS layer, codecs, and original failure; release the transient URL on failure, source change, or session release. Do not apply this degradation before a real code-4 failure or to external/unmanaged media.

## Save invariants

- Primary store: IndexedDB database `devil_connection_web_shell`, object store `saves`, schema version `1`.
- Fallback keys use the `dc-shell:` localStorage prefix.
- The reserved `dc-shell:__dc_pending_v1__` write-ahead journal is recovery metadata, not a save entry. Exclude it from reads and exports; replay it over stale IndexedDB data, and clear only the exact journal revision covered by a successful transaction.
- Keep the localStorage fallback and migration; it is active recovery behavior, not obsolete legacy support.
- Save reads are synchronous from the in-memory cache after `storage.ready` resolves.
- Failed IndexedDB flushes must preserve pending keys for retry and publish `data-dc-storage-error`.
- A game document's save store captures its owning document and, on `pagehide`, flushes the write-ahead journal before explicitly closing its IndexedDB connection. Teardown must be idempotent and must still close the connection after a failed flush.
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

- Treat the imported `docs/ModsUsage.md` snapshot as the DCML/Rebuild package-format reference. Its upstream source is recorded in `docs/THIRD_PARTY_NOTICES.md`; do not edit it to describe Web-only behavior. `README.md` owns the user-facing Web compatibility matrix and must be updated when behavior changes.
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

## Recommended mod catalog

- `recommended-mods/catalog.json` is the sole runtime index. It uses schema version `1`; every entry requires only `id`, `name`, and `file`. Description, version, author, and byte size are optional display metadata.
- `file` is either a direct ASCII basename ending in `.asar` or an HTTPS URL on the explicit `github.com` / `raw.githubusercontent.com` allowlist whose final path segment is such a basename. Reject credentials, query strings, fragments, other hosts, subdirectories for local files, absolute local paths, and traversal.
- The catalog controller may fetch only the same-origin static catalog and must build display content with DOM APIs. Downloads use a normal link; external packages open separately with `noopener noreferrer`. Neither path may read the package into browser memory, auto-import it, enable it, persist it, or alter the active mod plan.
- The development server may expose only `recommended-mods/catalog.json` and strictly matched direct child packages that are present in the current catalog. Unlisted candidates must remain unreachable. Keep every other ASAR path blocked, including the root game fixture and `.asar.unpacked` paths, and send curated packages as attachments.
- “Recommended” means that the maintainer has confirmed the package works well enough to distribute with this project; it does not remove the existing trusted-code warning.
- Every published catalog entry must resolve either to one direct file under `recommended-mods/` or to one allowed GitHub HTTPS package URL. Keep `/app.asar` ignored, keep unlisted local candidates unreachable through the development server, and do not use a generated catalog or directory-listing API at runtime.

## Patch placement policy

Treat patching as three responsibility layers, not as three ordinary VFS override layers:

1. **Host kernel** owns browser-required infrastructure independent of one game source version: archive access, VFS, resource rewriting, browser/Electron/Tyrano contracts, storage, startup, and lifecycle cleanup. Keep this stable and non-optional.
2. **Game compatibility profile** owns minimal, version-gated in-memory transformations required to preserve original behavior in a browser. It runs against the final resource selected by the base-plus-mod VFS. A required transform must declare its target, strict source signature, expected match count, failure behavior, and tests. Never copy a complete game or Tyrano source file into the repository.
3. **Mods** own optional performance policies, experience changes, features, and content-specific corrections. Preserve user control and later-wins ordering; do not promote an optional optimization into the non-disableable profile.

Because profile transforms see the final mod-overlaid resource, they may constrain a mod that replaces the same path. Only genuine browser requirements belong there. Strict signatures gate whether a transform may run, not whether the user may launch an otherwise valid archive. Current game patches use `warn-and-continue`: a missing, unreadable, signature-unknown, or transform-failed target does not produce a transformed resource, marks the report as `warning`, and keeps launch available. A content-specific media patch may instead explicitly delegate a signature-unknown `mod` source to an existing Host runtime recovery. Prefer adapter-level interception when a stable runtime contract exists; use source transformation only when the behavior cannot be corrected at a narrower boundary.

Resource readiness and both MP4 recovery paths are Host kernel responsibilities because they repair browser input/presentation contracts independently of one Devil Connection source signature. Do not duplicate them in a profile or expose them as optional mod policy. The `kiri2.mp4` and `effect.mp4` silent-track transforms are still content-specific and remain strict, version-gated profile patches applied before playback. Browser Runtime must not proactively generalize those transforms: its visual-only path is permitted solely after native code 4 and a preserving MediaSource attempt cannot recover the managed resource. Keep game-specific scene order, transition backgrounds, and `movie_with_bg` display timing out of the Host kernel.

The asynchronous Tyrano jump guard is likewise a Host kernel responsibility because it closes the engine-wide interval between a committed `jump` and its delayed `nextOrderWithLabel()` callback. Install it against the current KAG jump tag during adapter setup and ensure it again after mod hooks settle immediately before `TYRANO.init()`, so a later hook replacement is still guarded. Preserve the original jump function, timer, parameters, return value, and `nextOrderWithLabel()` release path; restore the prior strong-stop state if the wrapped start throws synchronously. Do not globally deduplicate touch/click events, rewrite `$.fn.click` / `$.fn.tap`, cancel the timer, add scenario labels, or suppress ordinary post-jump input.

The Tyrano background application order guard is likewise a Host kernel responsibility because it closes the engine-wide gap between concurrent `[bg]`/`[bg2]` preloads and their out-of-order callbacks. Install it against the current background tags during adapter setup and ensure it again after mod hooks settle immediately before `TYRANO.init()`. Preserve the original tag starts, wait and crossfade semantics, and all non-background preloads; do not serialize loads globally, rewrite the game's CSS application, or drop blocking `wait=true` callbacks.

The Tyrano character application order guard is likewise a Host kernel responsibility because it closes the same out-of-order preload gap for `[chara_show]`/`[chara_mod]` on shared character layers. It tracks show and mod requests per character name with separate counters so the newest pose wins while a pending show still creates the element (a newer mod must not cancel it); the same install/reinstall rules as the background guard apply. It must not alter the game's wait/crossfade semantics or any non-character preload.

The Tyrano movie autoplay unlock is likewise a Host kernel responsibility because autoplay policy is a browser input contract independent of game source version. Install it against the current `movie`/`movie_with_bg` tags during adapter setup and ensure it again after mod hooks settle immediately before `TYRANO.init()`; the `movie_with_bg` plugin registers during boot, so its tag assignment is wrapped at registration time. Preserve the original tag starts and `play()` promises; only a `NotAllowedError` from a managed movie element triggers the immediate muted replay and first-gesture sound restore, and the game's own `mute` request is restored as-is. Do not wrap `HTMLMediaElement.prototype.play`, change video visibility, cancel timers, or suppress ordinary post-jump input.

The original Remodal markup and 700px dialog coordinate width are likewise game-version-specific. `devil-connection-remodal.js` may strictly match the final `index.html` and inject a bounded runtime scaler before `</body>` so dialogs follow Tyrano's current `base_scale` and the mobile visual viewport. It must not patch `libs.js`, replace `$.alert` / `$.confirm`, or become a generic Host Remodal adapter. Unknown `index.html` sources remain unchanged and produce a compatibility warning rather than inheriting an unverified layout assumption.

`SessionPreparer` enforces the launch-time crossing order: immutable base-plus-mod VFS, required profile transforms, host browser-resource preparation, then `GameDocument`. Do not reproduce this sequence in `PlayerController`, a profile, or a mod module. Runtime host adapters remain non-optional after iframe bootstrap; mod hooks remain ordered user extensions rather than part of profile preparation.

`ProfileRunner` is deliberately small and declarative. Every patch entry must provide an ID, target, required flag, strict signatures, failure policy, and transform. Text patches use exact source strings with expected counts. Binary patches must declare a positive read limit plus exact size and SHA-256 signatures, and may return only an `ArrayBuffer` or typed array. `warn-and-continue` records an `unverified` or `failed` patch, does not prepare a replacement resource, marks the report non-compatible but launchable, and continues checking later patches. `abort-session` remains available only when continuing cannot produce a valid session. Invalid patch declarations, base-game identity failure, and later session construction failure are not softened. The narrow `unsupportedMod: 'delegate-to-runtime'` policy may skip only a signature-unknown final source whose VFS kind is `mod`; exact mod matches still transform. Keep patch transforms in their own profile files; do not turn the runner into a general plugin API or allow manager-side patch toggles for required compatibility.

The compatibility manager page is an observer, not an executor. It displays the report produced during session preparation and may export metadata-only JSON containing the profile, patch states, game version, and enabled mod identities. It must never export local file paths, handles, archive bytes, extracted content, or hook source. Consult `docs/TODO.md` only for unresolved, evidence-gated, deferred, and rejected work.

## UI invariants

- The game iframe fills the viewport; shell controls overlay it rather than reserving layout space.
- The manager document title is `DevilConnection Modloader web`. The active player title comes from the final layered VFS `data/system/Config.tjs` `System.title`, so an enabled mod override may intentionally change it; closing the session restores the manager title.
- The manager has separate core-load and start commands. Start must stay disabled until isolated base-game validation and the prepared iframe handshake both succeed.
- Mod controls must communicate top-to-bottom load order and later-wins precedence; build imported metadata with DOM APIs, never manifest `innerHTML`.
- The compatibility page must describe required transforms without presenting disable controls. A `warn-and-continue` result selects that page, displays that the transform was not executed, and keeps Start available after the normal iframe readiness handshake. An `abort-session` failure still opens the page and leaves Start disabled.
- The top-left player menu trigger must remain keyboard accessible and visible against arbitrary game scenes.
- The Mods page keeps local load-order management and recommended downloads as two keyboard-accessible modes inside the existing page. The mobile switch remains two equal columns; recommended items and download commands must not overflow narrow viewports.
- The floating player menu must retain backdrop/Escape/close behavior, focus containment, focus restoration, bounded desktop sizing, and mobile single-column scrolling without becoming an opaque full-viewport page.
- Keep fixed controls stable in size and account for safe-area insets.
- Do not expose implementation instructions or debug descriptions as normal in-app copy.

## Verification

Run after relevant changes:

```powershell
node tests\url-edge-cases.test.js
node tests\media-source-fallback.test.js
node tests\mp4-visual-fallback.test.js
node tests\resource-readiness.test.js
node tests\remodal-profile.test.js
node tests\recommended-mods.test.js
node tests\mod-loader.test.js
node tests\mod-config.test.js
node tests\mod-config-controller.test.js
node tests\game-profile.test.js
node tests\kiri-video.test.js
node tests\foreground-movies-profile.test.js
node tests\audio-ogg-profile.test.js
node tests\browser-save-store.test.js
node tests\save-manager.test.js
node tests\save-manager-controller.test.js
node tests\local-source-store.test.js
node tests\source-restore-controller.test.js
node tests\profile-runner.test.js
node tests\session-preparer.test.js
node tests\compatibility-controller.test.js
node tests\collection-scroll-profile.test.js
node tests\title-loop-profile.test.js
node tests\debug-tools.test.js
node tests\tyrano-preload-scheduler.test.js
node tests\start-gate.test.js
node tests\player-controller.test.js
node tests\console-monitor.test.js
node tests\player-runtime-controls.test.js
node tests\player-tools-view.test.js
node tests\tyrano-jump-guard.test.js
node tests\tyrano-touch-guard.test.js
node tests\tyrano-bg-guard.test.js
node tests\tyrano-chara-guard.test.js
node tests\tyrano-video-unlock.test.js
node tests\devil-connection-tap-repeat.test.js
node tests\input-advance-tool.test.js
Get-ChildItem js -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
git diff --check
git status --short
```

For browser-facing changes, serve the repository and verify at desktop and mobile widths:

```powershell
.\start_server.bat
```

For Android media triage, `/tools/media-compatibility.html` may read a user-selected base ASAR plus optional mod ASARs and test the final layered video view one file at a time. It must remain a development-only tool, must not persist or extract selected content, and must release each direct Blob URL, transient MSE URL, or transient visual-only URL before advancing. Use `?selftest=1` to exercise one generated playable video and one generated invalid MP4 without selecting game content.

For touch-advance triage, `/tools/input-advance.html` must remain a standalone bounded reproduction that reads no ASAR or save data and records only events delivered to its own probe. A `touchend` contributes one tap advancement and an actually delivered `click` contributes one separate advancement; never hard-code a duplicate result. Its protected mode must use the same `TyranoJumpGuard` module as the game adapter, while the unprotected mode retains the original 1ms jump boundary for comparison.

Minimum browser checks:

- Host root has `data-dc-shell-ready="true"` with no console initialization errors.
- Selecting a valid archive prepares the iframe and enables the host start button only after its authenticated ready message; the click reaches the prepared game directly without a second overlay.
- The initial `system/plugin.ks` audio preload must leave `lwaitload`, report zero VFS XHR failures, and reach the title scenario with and without a hook mod.
- Imported standard and legacy-header mod ASARs render, reorder, toggle, and override resources in later-wins order.
- Static and dynamic images, CSS backgrounds, audio, video, APNG, and scenario loads resolve.
- Tyrano `image` tags begin their original insertion and transition only after preload/decode, without a global image visibility rule. Video readiness does not override game visibility. A code-4 failure first tries supported fragmented MP4 through MSE; an eligible progressive H.264/AAC resource may then retry once without audio and must warn. Exact `kiri2.mp4` and `effect.mp4` profile transforms expose their unchanged H.264 pictures without waiting for a first failure.
- Saving, refreshing, and loading does not request stale Blob URLs.
- Reload and close release or replace session URLs at the correct time.
- Player menu has no clipping/overflow and restores focus correctly; virtual keys emit balanced down/up events, and the console viewer remains bounded and scrollable.
- Character and ending collection lists retain native vertical touch scrolling without disabling Tyrano's page-level gesture guard.

Before any requested commit, inspect staged paths and confirm that no root game archive, unlisted ASAR, or extracted game content is included. Versioned recommended packages must be direct local entries in `recommended-mods/catalog.json`; external entries must not retain duplicate tracked binaries.
