# yoyo

Freeze the page you're working on, keep editing, flip back to compare.

Press a shortcut and the current route is saved as a DOM + CSS snapshot. Keep coding; HMR updates the live page while the snapshot stays put. Hold a key to peek at the old version, or lay the two over each other with a slider, onion skin, difference blend or side-by-side split. No undo, no second dev server.

Dev only. Nothing ships to production.

## Install

```sh
pnpm add -D yoyo
```

### Next.js (15.3+)

```ts
// instrumentation-client.ts
if (process.env.NODE_ENV === 'development') import('yoyo')
```

The condition is constant-folded in production builds, so the chunk is dropped.

### Vite / Astro / anything with ESM

```ts
if (import.meta.env.DEV) import('yoyo')
```

### Plain HTML

```html
<script type="module" src="/node_modules/yoyo/dist/index.js"></script>
```

Point `src` at wherever your dev server serves `dist/index.js`, and only add the tag in development.

## Use

| Keys | Action |
|---|---|
| `Alt+Shift+S` | Freeze → new snapshot (A, B, C…) |
| `Alt+Shift+Z` (hold) | Peek at the frozen version; release for live |
| `Alt+Shift+D` | Compare on/off |
| `Alt+Shift+M` | Next compare mode |
| `Alt+Shift+[` / `]` | Previous / next snapshot |

Shortcuts are ignored while you're typing in an input. The toolbar (bottom right, draggable) has the same actions: click a chip to select it, double-click to rename, `×` to delete.

Compare modes:

- **slider**: live left of the seam, frozen right. Drag the seam or use the range input.
- **onion**: frozen on top at adjustable opacity.
- **difference**: identical pixels go black, so only changes light up.
- **split**: frozen left, live right in an iframe that gets its own HMR. Scroll is linked.

Snapshots are kept per route in IndexedDB (10 per route, oldest dropped) and survive reloads.

## Options

```ts
import('yoyo').then(({ init }) =>
  init({
    keys: { freeze: 'Alt+Shift+KeyF' }, // KeyboardEvent.code; modifiers Alt, Shift, Ctrl, Meta
    maxPerRoute: 20,
  }),
)
```

A bare import uses the defaults. Keys match `e.code`, so they work the same on every keyboard layout and Option doesn't turn letters into symbols on macOS.

## Limits

- Snapshots don't run JS. Hover and focus styles still work; an open dropdown stays as it was captured.
- Content inside shadow roots (web components) isn't captured.
- Cross-origin stylesheets (Google Fonts CSS, CDNs) are linked rather than copied, so a change on their side will show up in old snapshots.

## Troubleshooting

- **Nothing happens on the shortcut.** Another app (Raycast, Arc, a window manager) may own it. Use the toolbar's Freeze button or remap with `init({ keys })`.
- **Webpack dev: `Module parse failed: Unexpected character '@'` in CSS.** Your shell exports `NODE_ENV=production`. Unset it for `next dev`.
- **HMR stops after a client-side navigation** in some Next 16 versions (vercel/next.js#98699). That's Next, not yoyo; a reload fixes it.

## Develop

```sh
pnpm install
pnpm test                  # serializer unit tests (vitest + jsdom)
pnpm dev:example           # build yoyo, run examples/next-app
pnpm e2e                   # Playwright against next dev (Turbopack) + prod build check
BUNDLER=webpack pnpm e2e   # same against next dev --webpack
```
