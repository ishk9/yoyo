# yoyo — agent brief

> Package: @northlite/yoyo (v0.6.0, MIT). Human docs: https://northlite.dev/yoyo
> This brief also ships in the package: `node_modules/@northlite/yoyo/yoyo.md` always matches the installed version.
> You cannot press ⌥S. Use the `yoyo` CLI. It drives the yoyo toolbar in a browser tab and prints one JSON line per command.

## When to use it

- You changed CSS, markup, or a component, and you need proof of what changed on screen.
- You want to check that a refactor changed nothing visible.
- Do not use it for unit tests, API checks, or production pages. It is a dev tool.

## How it works

The CLI does not open a browser of its own by default. It talks to the yoyo toolbar, which runs inside a tab of the app. So the app must import yoyo, and a tab must be open:

- **The user's browser** (default): the user has the app open. You see what they see, and they see every freeze and compare.
- **Headless** (`yoyo open <url> --headless`): for agents and CI with no browser. It starts the Chrome, Edge, Brave or Chromium that is already installed. It does not need Playwright.

## Setup (once per project)

1. Install. Keep `--include=dev`: without it, a shell with `NODE_ENV=production` removes the project's other dev dependencies.

```sh
npm i -D @northlite/yoyo --include=dev
```

2. Load the toolbar in development. **The CLI needs this import**, because the CLI controls the toolbar.

```ts
// Next.js 15.3+: instrumentation-client.ts
if (process.env.NODE_ENV === 'development') import('@northlite/yoyo')

// Vite, Astro, any ESM app: top of the client entry
if (import.meta.env.DEV) import('@northlite/yoyo')
```

3. Start the dev server, or reuse the one already running.
4. Get a tab:
   - The user has the app open → nothing to do. Check with `npx yoyo status`.
   - No tab → `npx yoyo open http://localhost:3000/` opens one in the user's browser.
   - No browser at all (CI, remote agent) → `npx yoyo open http://localhost:3000/ --headless`.

## The loop

```sh
npx yoyo freeze --name before     # before you edit
# edit code, wait for hot reload
npx yoyo compare --against before # after you edit
```

1. Run `freeze` on the route you are about to touch, before the first edit.
2. Make the change. Wait for hot reload to finish.
3. Run `compare`. Read `same` and `changes`.
4. Check that every entry in `changes` is one you meant. Anything else is a side effect.
5. Decide: keep the change, adjust it, or revert it. Then run `npx yoyo off` and report what changed.

## Commands

| Command | Does | Prints |
|---|---|---|
| `yoyo open <url> [--headless]` | Opens the page and waits until its toolbar connects. | `{"opened":"http://localhost:3000/","headless":true}` |
| `yoyo freeze [--name <label>]` | Freezes the tab's page into a snapshot. Labels go A, B, C… unless named. | `{"frozen":"before","route":"/"}` |
| `yoyo compare [--against <label>] [--mode slider\|split]` | Turns compare on in the tab and diffs the live page with a snapshot (default: the selected one, usually the newest). | see below |
| `yoyo off` | Turns compare off. | `{"route":"/","compare":"off"}` |
| `yoyo list` | Lists snapshots for the tab's current route. | `{"route":"/","active":"A","snapshots":[{"label":"A","createdAt":1764000000000}]}` |
| `yoyo status` | Lists connected tabs. | `{"port":7357,"headless":false,"tabs":[{"url":"http://localhost:3000/","lastFocused":1764000000000}]}` |
| `yoyo stop` | Stops the background relay, and the headless browser if one runs. | `{"stopped":true}` |

Only `open` takes a URL. Every other command acts on a connected tab: by default the one the user focused last, or the one `open` opened. Use `--url <text>` to pick the tab whose URL contains `<text>`.

## Reading `compare`

```json
{"route":"/","against":"before","mode":"slider","same":false,"htmlIdentical":false,"total":2,
 "changes":[
  {"el":"main.mx-auto.flex > p.font-mono.text-sm","prop":"class","before":"text-zinc-500 dark:text-zinc-400","after":"text-blue-600"},
  {"el":"main.mx-auto.flex > p.font-mono.text-sm","prop":"color","before":"lab(65.6464 1.53497 -5.42429)","after":"lab(44.0605 29.0279 -86.0352)"}]}
```

- `same: true` → nothing visible differs. `changes` is empty.
- `htmlIdentical` → the captured HTML is byte-for-byte the same. It can be `false` while `same` is `true`. For example, Tailwind keeps a generated CSS rule after you revert a class.
- Each change has `el` (a short selector), `prop`, `before`, and `after`. `prop` is one of:
  - a computed style (`color`, `font-size`, `padding-top`, `width`, …),
  - `text` (the element's own text),
  - `class` (only the classes that changed), `href`, `alt`, `placeholder`, `aria-label`,
  - `element` (`after: "added"` or `"removed"`).
- A style that a child only inherits from its parent is reported once, on the parent.
- `total` counts every change. `changes` lists the first 60.
- Snapshots are per route and live in the browser (IndexedDB), the same ones the user sees in the toolbar.

## Errors

Errors print `{"error":"…"}` to stderr and exit with code 1. Common ones:

| error contains | Do this |
|---|---|
| `no browser tab … is connected` | Check that the dev server runs and the app imports yoyo. Then run `yoyo open <url>` (add `--headless` with no browser). |
| `takes no URL` | Remove the URL. Use `--url <text>` to pick a tab, or `yoyo open <url>` to open one. |
| `no Chromium-based browser found` | Install Chrome, Chromium, Edge or Brave, or set `YOYO_BROWSER` to its executable. |
| `no snapshot on … yet` | Run `yoyo freeze` first. |
| `no snapshot "X"` | Use a label from `yoyo list`. |
| `did not answer within 30s` | The tab is busy or hung. Reload it, or run `yoyo open <url>` again. |

## Limits

- Snapshots do not run JavaScript. Open menus and hover states stay as captured.
- Content inside shadow roots is not captured.
- Scroll-reveal content hidden by inline styles is captured as revealed.
- One headless page per relay. A second `open --headless` replaces it. Its snapshots last until `yoyo stop`, or until the relay stops after an hour with no commands.
