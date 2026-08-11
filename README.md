# Devil Connection Web Shell

A static, read-only browser shell for a user-provided `app.asar` from Devil Connection.

The repository contains no game data. The selected archive is parsed locally and remains unchanged. Assets are exposed to TyranoScript as temporary Blob URLs backed by byte ranges of the selected file.

## Run

Open `index.html` in a modern browser and select the `app.asar` from your installed copy of the game. A regular HTTP static host also works; HTTPS, Service Worker, Node.js, and uploads are not required.

Current scope:

- Original `app.asar` only
- Read-only ASAR parsing
- IndexedDB-backed browser storage for saves
- Browser replacements for Electron and Steam calls
- No Mod ASAR overlay yet

## Privacy

The shell does not upload the selected archive. It creates temporary in-browser object URLs for requested files and revokes them when the game is closed.

## Test

Run the URL, save serialization, CSS dependency, and responsive resource edge cases with:

```console
node tests/url-edge-cases.test.js
```

## Repository hygiene

All `*.asar` files are ignored by Git. Do not commit game archives or extracted game assets.
