# Changelog

## 0.3.1

- Package moved to **`@northlite/yoyo`**. `@ishk9/yoyo` is deprecated and gets no further updates; switch with:

  ```sh
  npm uninstall @ishk9/yoyo && npm i -D @northlite/yoyo --include=dev
  ```

  and change the import to `import('@northlite/yoyo')`. No code changes.

## 0.3.0

### Changed

- Compare modes are down to **slider** and **split**. Onion and difference are commented out in the code and can come back later. ⌥M now switches between the two. A saved onion/difference preference falls back to slider.

### Fixed

- Snapshots taken at the top of a page with scroll-reveal animations (framer-motion `whileInView`, GSAP, IntersectionObserver hooks) were missing everything below the fold, because that content was still at an inline `opacity: 0`. The snapshot now shows it revealed.

### Docs

- Install command includes `--include=dev`, with a warning that a plain `npm i -D` under `NODE_ENV=production` removes your other dev dependencies.

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

- Rewritten README: quick start, macOS and Windows shortcut table, modes, toolbar, options, and a troubleshooting section that leads with `NODE_ENV=production`.

## 0.1.0

First release: freeze, hold-to-peek, slider / onion / difference / split compare, per-route snapshots in IndexedDB, Next.js and Vite setup.
