# Changelog

## 0.5.0

### Changed

- **The `yoyo` CLI now drives the browser tab you have open**, through the yoyo toolbar. It no longer opens a headless browser, and `playwright-core` is gone: the package has no dependencies. Snapshots are the same ones you see in the toolbar.
- `yoyo compare` now prints `same` and a list of changed elements (text, added or removed elements, computed styles) instead of writing a PNG.
- New commands: `yoyo off`, `yoyo status`, `yoyo stop`. `--url` picks a tab; the URL argument is gone.
- New option `init({ cli })`: the relay port, or `false` to turn the CLI link off.

## 0.4.0

### Added

- **`yoyo` CLI** for AI agents and scripts: `yoyo freeze <url>`, `yoyo compare <url>`, `yoyo list <url>`. It loads the page in headless Chromium, uses the same capture as the toolbar, and saves snapshots to `./.yoyo`. `compare` writes a snapshot | live | diff PNG and prints JSON with `same` and `changedPixels`. Needs `playwright-core` (optional peer dependency) and Chrome or Playwright's Chromium. See the README section "CLI (for agents and scripts)".

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

- Install command now includes `--include=dev`, with a warning that a plain `npm i -D` under `NODE_ENV=production` removes your other dev dependencies.
- Rewritten README: quick start, macOS and Windows shortcut table, modes, toolbar, options, and a troubleshooting section that leads with `NODE_ENV=production`.

## 0.1.0

First release: freeze, hold-to-peek, slider / onion / difference / split compare, per-route snapshots in IndexedDB, Next.js and Vite setup.
