# yoyo

Freeze the page you're working on, keep editing, flip back to compare.

Press **⌥S** and the current page is saved as a snapshot. Keep coding; hot reload updates the live page while the snapshot stays exactly as it was. Press **⌥C** to compare the two with a slider or side by side. No undo, no screenshots, no second dev server.

Dev only. Nothing ships to production.

> Previously published as `@ishk9/yoyo`, which is now deprecated. Same code, new name.

- [Install](#install)
- [Quick start](#quick-start)
- [Shortcuts](#shortcuts)
- [Compare modes](#compare-modes)
- [Toolbar](#toolbar)
- [Options](#options)
- [Troubleshooting](#troubleshooting)
- [How it works](#how-it-works)
- [Limits](#limits)

## Install

```sh
npm i -D @northlite/yoyo --include=dev
# or
pnpm add -D @northlite/yoyo
```

> **Keep `--include=dev`.** If your shell has `NODE_ENV=production` set, a plain `npm i -D …` installs in production mode and **removes every other dev dependency** in your project (Tailwind, TypeScript, ESLint…). The flag makes npm keep them no matter what `NODE_ENV` says. Already hit this? Run `npm install --include=dev` to put them back. To make it the default for a project, add `include=dev` to its `.npmrc`. See [Troubleshooting](#toolbar-not-showing-check-node_env).

Then load it in development only.

### Next.js (15.3+)

Create `instrumentation-client.ts` in the project root (or in `src/` if you use one):

```ts
if (process.env.NODE_ENV === 'development') import('@northlite/yoyo')
```

No config change needed. In production builds the condition is constant-folded and yoyo is dropped from the bundle entirely.

### Vite (React, Vue, Svelte, Solid…), Astro, anything ESM

At the top of your client entry (e.g. `src/main.ts`):

```ts
if (import.meta.env.DEV) import('@northlite/yoyo')
```

### Plain HTML

```html
<script type="module" src="/node_modules/@northlite/yoyo/dist/index.js"></script>
```

Point `src` at wherever your dev server serves `dist/index.js`, and only add the tag in development.

## Quick start

1. Run your dev server and open a page. A small toolbar appears at the bottom-center.
2. Press **⌥S** (Alt+S). A toast says `Frozen A`.
3. Change some CSS or markup and save. The page hot-reloads.
4. Press **⌥C**. A slider splits the screen at 50%: live on the left, snapshot A on the right. A label at the top tells you what you're looking at.
5. Drag the slider, or press **⌥M** to switch mode. Press **⌥C** again to turn compare off.

Compare always uses the selected snapshot (highlighted chip), which is the last one you froze unless you pick another. If you freeze and compare straight away, the label says **"A matches the live page"**: there's nothing to compare yet, so make a change or pick an older snapshot with **⌥[**.

Typical loop for trying variants: freeze → change → compare → like it? freeze again (B) → change → compare against B → ⌥[ to go back to A.

## Shortcuts

| macOS | Windows / Linux | Action |
|---|---|---|
| ⌥S | Alt+S | Freeze the page into a new snapshot (A, B, C…) |
| ⌥C | Alt+C | Compare on / off (starts at slider 50%) |
| ⌥M | Alt+M | Switch compare mode: slider ↔ split |
| ⌥[ | Alt+[ | Previous snapshot |
| ⌥] | Alt+] | Next snapshot |

- Shortcuts are ignored while you're typing in a text field, textarea or contenteditable.
- They match the physical key (`KeyboardEvent.code`), so they work on any keyboard layout, and ⌥ won't type `ß` or `ç` on macOS.
- Taken by another app (Raycast, Arc, a window manager)? Use the toolbar, or [change them](#options).

## Compare modes

Two modes for now. Onion skin and difference blend exist in the code but are switched off while the core flow settles.

| Mode | What you see | Good for |
|---|---|---|
| **slider** | Live left of the seam, snapshot right. Drag the seam or the toolbar range. | Before/after of a layout or color |
| **split** | Snapshot left, live right, side by side. The live pane is a real copy of your app with its own hot reload; scrolling either pane scrolls both. | Comparing whole sections |

The slider goes back to the middle every time you turn compare on or change mode. Your chosen mode is remembered.

In every mode the snapshot follows your scroll position, and inner scroll areas are restored to where they were when you froze.

## Toolbar

```
⠿  ● Freeze  A× B× C×  [slider ▾]  ━━●━━  –
```

- **⠿** drag to move. The position is remembered across reloads. Default is bottom-center, away from chat widgets that usually sit bottom-right.
- **● Freeze**: same as ⌥S.
- **Chips**: one per snapshot on this route. Click to select, double-click to rename, **×** to delete.
- **Mode select**: `compare: off` or a mode.
- **Range**: slider position.
- **–** collapses the toolbar to just the handle.

Snapshots are kept **per route** in your browser's IndexedDB (10 per route, oldest dropped) and survive reloads and dev-server restarts. Nothing leaves your machine.

## Options

A bare import uses the defaults. To configure, call `init` yourself:

```ts
// Next.js: instrumentation-client.ts
if (process.env.NODE_ENV === 'development') {
  import('@northlite/yoyo').then(({ init }) =>
    init({
      keys: { freeze: 'Alt+KeyF', compare: 'Alt+KeyX' },
      maxPerRoute: 20,
    }),
  )
}
```

| Option | Type | Default | |
|---|---|---|---|
| `keys` | `Partial<Record<'freeze' \| 'compare' \| 'mode' \| 'prev' \| 'next', string>>` | see [Shortcuts](#shortcuts) | `KeyboardEvent.code` joined with `+`. Modifiers: `Alt` (⌥), `Shift`, `Ctrl`, `Meta` (⌘). Examples: `'Alt+KeyF'`, `'Ctrl+Shift+Digit1'`, `'Alt+BracketLeft'`. |
| `maxPerRoute` | `number` | `10` | Snapshots kept per route. |

`init` is safe to call more than once; only the first call counts.

Also exported: `capture()`, which returns the snapshot record for the current page (`{ html, route, viewport, scroll, createdAt }`) if you want to build on it.

## Troubleshooting

### Toolbar not showing? Check `NODE_ENV`

The most common cause. If your shell exports `NODE_ENV=production` (some dotfiles and Docker images do):

- `npm install` runs in production mode: it skips dev dependencies, and `npm i -D <pkg>` **removes the ones you already have**. Use `npm install --include=dev` to restore them, or put `include=dev` in the project's `.npmrc`.
- `process.env.NODE_ENV === 'development'` is false, so the import never runs, even under `next dev`.
- Next's webpack dev server can also fail on CSS with `Module parse failed: Unexpected character '@'`.

Check and fix:

```sh
echo $NODE_ENV        # should print nothing or "development"
unset NODE_ENV        # this shell only; remove the export from ~/.zshrc / ~/.bashrc to fix for good
npm run dev
```

### Other cases

- **App runs inside an iframe** (VS Code Simple Browser, StackBlitz, CodeSandbox preview): yoyo doesn't start inside iframes, so it can't nest itself in split mode. Open the dev URL in a normal browser tab.
- **Shortcut does nothing**: another app may own it, or focus is in a text field. Use the toolbar or remap with `keys`.
- **Comparison looks identical**: read the label. If it says "matches the live page", the selected snapshot was taken after your change. Pick an older one with ⌥[ or click its chip.
- **Toolbar is in the way**: drag it by ⠿, or collapse it with –.
- **HMR stops after a client-side navigation** in some Next 16 versions (vercel/next.js#98699). That's Next; a reload fixes it.

## How it works

Freezing clones the DOM and serializes the live CSS from the browser's own stylesheet objects (including rules inserted by CSS-in-JS, constructed stylesheets and `@import`s), with relative URLs made absolute. Form values, canvas pixels, image sources and scroll positions are copied in. Scripts are removed.

The snapshot is shown in a sandboxed, same-origin `<iframe srcdoc>` sized to your viewport, so later hot reloads can't touch it. The toolbar lives in a Shadow DOM root, so its styles never leak into your app or into snapshots.

## Limits

- Snapshots don't run JavaScript. Hover and focus styles still work; an open dropdown stays as it was captured.
- Content inside shadow roots (web components) isn't captured.
- Cross-origin stylesheets (Google Fonts CSS, CDNs) are linked rather than copied, so a change on their side would show up in old snapshots.
- Very large pages (thousands of nodes) make bigger snapshots and a slower freeze.
- Scroll-reveal animations: content below the fold that's still hidden by an inline style (framer-motion `whileInView`, GSAP, IntersectionObserver hooks) is shown in its revealed state. Class-based reveals (AOS) and other CSS-hidden content are captured as they are.

## Develop

```sh
pnpm install
pnpm test                  # unit tests (vitest + jsdom)
pnpm dev:example           # build yoyo, run examples/next-app
pnpm e2e                   # Playwright against next dev (Turbopack) + production build check
BUNDLER=webpack pnpm e2e   # same against next dev --webpack
```

## License

MIT
