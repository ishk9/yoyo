# Changelog

## 0.2.0

Simpler compare flow, based on first real-world use.

### Breaking

- Shortcuts are now ⌥ + key (Alt + key), no Shift: ⌥S freeze, ⌥C compare, ⌥M mode, ⌥[ / ⌥] previous / next.
- Hold-to-peek (⌥⇧Z) is gone. ⌥C toggles compare on and off and replaces it. The `peek` key option was removed.

### Changed

- Turning compare on starts the slider (and onion opacity) at 50%, every time.
- A label at the top shows what you're comparing, e.g. `◀ live | A (frozen) ▶`. It warns when the selected snapshot matches the live page, so an identical comparison no longer looks broken.
- Toolbar defaults to bottom-center (bottom-right collides with chat widgets) and remembers where you drag it.
- Focus on a checkbox, select or the toolbar's own slider no longer blocks shortcuts; only text entry does.
- Toasts and tooltips show shortcuts the way your OS writes them (⌥C on macOS, Alt+C elsewhere).

### Fixed

- Snapshots strip `autofocus`, which made the sandboxed snapshot frame log "Blocked autofocusing" console errors.

### Docs

- Install command now includes `--include=dev`, with a warning that a plain `npm i -D` under `NODE_ENV=production` removes your other dev dependencies.
- Rewritten README: quick start, macOS and Windows shortcut table, modes, toolbar, options, and a troubleshooting section that leads with `NODE_ENV=production`.

## 0.1.0

First release: freeze, hold-to-peek, slider / onion / difference / split compare, per-route snapshots in IndexedDB, Next.js and Vite setup.
