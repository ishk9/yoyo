#!/usr/bin/env node
// Headless yoyo for agents and scripts. Same capture() as the toolbar, run in its own Chromium;
// snapshots live on disk in ./.yoyo, not in the browser's IndexedDB. Every command prints one JSON line.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { Browser, Page } from 'playwright-core'
import type { Capture } from './snapshot'

const HELP = `yoyo — freeze a dev page, change code, compare.

Usage:
  yoyo freeze  <url> [--name <label>]           Save the page as a snapshot (A, B, C… unless named)
  yoyo compare <url> [--against <label>] [--out <png>]
                                                Capture the page now and compare it to a snapshot
                                                (default: the newest). Writes snapshot | live | diff PNG.
  yoyo list    <url>                            List snapshots for the url's route

Options:
  --width <px>   Viewport width (default 1280)
  --height <px>  Viewport height (default 800)
  --wait <ms>    Extra wait after load, for hydration and effects (default 500)
  --dir <path>   Snapshot folder (default ./.yoyo)

Output is one JSON line on stdout. Errors: JSON on stderr, exit code 1.
Needs Chrome, or Playwright's Chromium (npx playwright install chromium).`

interface Meta {
  label: string
  route: string
  url: string
  createdAt: number
  viewport: { w: number; h: number }
}

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    against: { type: 'string' },
    out: { type: 'string' },
    width: { type: 'string', default: '1280' },
    height: { type: 'string', default: '800' },
    wait: { type: 'string', default: '500' },
    dir: { type: 'string', default: '.yoyo' },
    help: { type: 'boolean', short: 'h' },
  },
})
const [cmd, rawUrl] = positionals

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))

async function main() {
  if (opt.help || !cmd) return console.log(HELP)
  if (!['freeze', 'compare', 'list'].includes(cmd)) fail(`unknown command "${cmd}". Run yoyo --help.`)
  if (!rawUrl) fail(`missing <url>. Example: yoyo ${cmd} http://localhost:3000/`)
  const url = new URL(rawUrl).href
  const route = new URL(url).pathname
  const dir = path.resolve(opt.dir!, slug(route))

  if (cmd === 'list') return out({ route, snapshots: list(dir).map(({ label, createdAt }) => ({ label, createdAt })) })

  const browser = await launch()
  try {
    const page = await browser.newPage({ viewport: { width: num('width'), height: num('height') } })
    if (cmd === 'freeze') return out(await freeze(page, url, route, dir))
    return out(await compare(page, url, route, dir))
  } finally {
    await browser.close()
  }
}

async function freeze(page: Page, url: string, route: string, dir: string) {
  const existing = list(dir)
  const label = opt.name ?? nextLabel(existing.map((m) => m.label))
  if (!/^[\w.-]+$/.test(label)) fail(`--name may use letters, digits, "_", "-" and "." only`)
  const cap = await grab(page, url)
  fs.mkdirSync(dir, { recursive: true })
  const meta: Meta = { label, route, url, createdAt: cap.createdAt, viewport: cap.viewport }
  fs.writeFileSync(path.join(dir, `${label}.html`), cap.html)
  fs.writeFileSync(path.join(dir, `${label}.json`), JSON.stringify(meta, null, 2))
  return { frozen: label, route, file: rel(path.join(dir, `${label}.html`)) }
}

async function compare(page: Page, url: string, route: string, dir: string) {
  const snaps = list(dir)
  if (!snaps.length) fail(`no snapshots for ${route}. Run: yoyo freeze ${url}`)
  const meta = opt.against ? snaps.find((m) => m.label === opt.against) : snaps.at(-1)
  if (!meta) fail(`no snapshot "${opt.against}" for ${route}. Have: ${snaps.map((m) => m.label).join(', ')}`)
  const before = fs.readFileSync(path.join(dir, `${meta!.label}.html`), 'utf8')
  const now = await grab(page, url)
  const same = now.html === before

  // Both sides are rendered from captures, so scroll-reveal content and JS-free rendering match exactly.
  const a = await render(page, url, before)
  const b = await render(page, url, now.html)
  const file = path.resolve(opt.out ?? path.join(dir, `compare-${meta!.label}.png`))
  const { changed } = await composite(page, a, b, meta!.label, file)
  return { route, against: meta!.label, same, changedPixels: changed, image: rel(file) }
}

/** Load the live page and run capture() in it. */
async function grab(page: Page, url: string): Promise<Capture> {
  await page.goto(url, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts?.ready)
  // ponytail: fixed settle time for hydration/effects; --wait raises it, a readiness hook if fixed waits flake
  await page.waitForTimeout(num('wait'))
  await page.addScriptTag({ path: fileURLToPath(new URL('./capture.global.js', import.meta.url)) })
  return page.evaluate(() => (window as any).yoyoCapture.capture())
}

/** Full-page PNG of captured HTML, served at the original url so fonts and relative assets load same-origin. */
async function render(page: Page, url: string, html: string): Promise<Buffer> {
  await page.route(url, (r) => r.fulfill({ body: html, contentType: 'text/html; charset=utf-8' }))
  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts?.ready)
    return await page.screenshot({ fullPage: true })
  } finally {
    await page.unroute(url)
  }
}

/** snapshot | live | diff side by side, diff pixels in magenta. Returns the count of changed pixels. */
async function composite(page: Page, a: Buffer, b: Buffer, label: string, file: string) {
  await page.setContent(`<body style="margin:0;background:#111;color:#eee;font:14px system-ui">
    <div id="row" style="display:inline-flex;gap:8px;padding:8px;align-items:flex-start"></div></body>`)
  const changed = await page.evaluate(
    async ([a, b, label]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((ok, no) => {
          const img = new Image()
          img.onload = () => ok(img)
          img.onerror = no
          img.src = src
        })
      const [ia, ib] = await Promise.all([load(a), load(b)])
      const w = Math.max(ia.width, ib.width)
      const h = Math.max(ia.height, ib.height)
      const pixels = (img: HTMLImageElement) => {
        const c = Object.assign(document.createElement('canvas'), { width: w, height: h })
        const ctx = c.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        return { c, d: ctx.getImageData(0, 0, w, h) }
      }
      const pa = pixels(ia)
      const pb = pixels(ib)
      const diff = Object.assign(document.createElement('canvas'), { width: w, height: h })
      const dctx = diff.getContext('2d')!
      const out = dctx.createImageData(w, h)
      let changed = 0
      for (let i = 0; i < out.data.length; i += 4) {
        const differs = pa.d.data[i] !== pb.d.data[i] || pa.d.data[i + 1] !== pb.d.data[i + 1] || pa.d.data[i + 2] !== pb.d.data[i + 2] || pa.d.data[i + 3] !== pb.d.data[i + 3]
        if (differs) changed++
        const grey = (pb.d.data[i] + pb.d.data[i + 1] + pb.d.data[i + 2]) / 12 + 170 // faded live page under the diff
        out.data.set(differs ? [255, 0, 255, 255] : [grey, grey, grey, 255], i)
      }
      dctx.putImageData(out, 0, 0)
      const row = document.getElementById('row')!
      for (const [title, c] of [[`${label} (frozen)`, pa.c], ['live', pb.c], [`diff: ${changed} px`, diff]] as const) {
        const col = document.createElement('div')
        col.textContent = title
        c.style.cssText = 'display:block;margin-top:4px;outline:1px solid #444'
        col.append(c)
        row.append(col)
      }
      return changed
    },
    [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`, label] as const,
  )
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await page.locator('#row').screenshot({ path: file })
  return { changed }
}

async function launch(): Promise<Browser> {
  let pw: typeof import('playwright-core')
  try {
    pw = await import('playwright-core')
  } catch {
    fail('playwright-core is missing. Run: npm i -D playwright-core --include=dev')
  }
  try {
    return await pw!.chromium.launch({ channel: 'chrome' })
  } catch {
    try {
      return await pw!.chromium.launch()
    } catch {
      fail('no browser found. Install Chrome, or run: npx playwright install chromium')
    }
  }
  throw new Error('unreachable')
}

function list(dir: string): Meta[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Meta)
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** A, B, … Z, AA, AB… — first one not taken. */
function nextLabel(taken: string[]) {
  for (let n = 0; ; n++) {
    let s = ''
    for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
    if (!taken.includes(s)) return s
  }
}

/** '/' → 'index', '/blog/post' → 'blog__post'. */
function slug(route: string) {
  return route.replace(/^\/+|\/+$/g, '').replace(/[^\w.-]+/g, '__') || 'index'
}

function num(key: 'width' | 'height' | 'wait') {
  const n = Number(opt[key])
  if (!Number.isFinite(n) || n < 0) fail(`--${key} must be a number`)
  return n
}

function rel(p: string) {
  return path.relative(process.cwd(), p) || p
}
function out(o: object) {
  console.log(JSON.stringify(o))
}
function fail(error: string): never {
  console.error(JSON.stringify({ error }))
  process.exit(1)
}
