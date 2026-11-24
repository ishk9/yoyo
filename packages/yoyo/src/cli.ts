#!/usr/bin/env node
// yoyo CLI: drives the yoyo toolbar in the browser tab you already have open. No browser automation.
//
//   CLI ──POST /cmd──► relay (127.0.0.1:7357, background process) ──SSE──► toolbar in your tab
//   CLI ◄──JSON─────── relay ◄──POST /result── toolbar (ran freeze/compare/… in your tab)
//
// The first command starts the relay; it exits after an hour without commands. Every command prints one JSON line.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const HELP = `yoyo — freeze the page in your browser, change code, compare. Drives the yoyo toolbar
in the tab you have open (dev server running, yoyo imported), so it needs no extra browser.

Usage:
  yoyo open <url> [--headless]                  Open the page and wait for its toolbar to connect.
                                                --headless: no browser window, for agents and CI with
                                                no browser of their own (uses installed Chrome/Edge/Brave)
  yoyo freeze  [--name <label>]                 Freeze the tab's page into a snapshot (A, B, C… unless named)
  yoyo compare [--against <label>] [--mode slider|split]
                                                Show compare in the tab and print what changed vs the
                                                snapshot (default: the selected one, usually the newest)
  yoyo off                                      Turn compare off in the tab
  yoyo list                                     Snapshots for the tab's current route
  yoyo status                                   Tabs connected to the CLI
  yoyo stop                                     Stop the background relay

Options:
  --url <text>   Pick the tab whose URL contains <text> (default: the tab you focused last)
  --port <n>     Relay port (default 7357, or $YOYO_PORT). Must match init({ cli: <n> }) in the app.

Commands other than open take no URL: they act on a connected tab.

Output is one JSON line on stdout. Errors: {"error": …} on stderr, exit code 1.`

const TAB_WAIT_MS = 15_000 // a tab retries the relay with backoff up to 10s, so give it one full round
const ANSWER_MS = 30_000
const OPEN_WAIT_MS = 60_000 // first page load on a dev server compiles the route
const IDLE_MS = 60 * 60_000

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    against: { type: 'string' },
    mode: { type: 'string' },
    url: { type: 'string' },
    headless: { type: 'boolean' },
    port: { type: 'string', default: process.env.YOYO_PORT || '7357' },
    help: { type: 'boolean', short: 'h' },
  },
})
const [cmd] = positionals
const port = Number(opt.port)

if (cmd === '__relay') relay()
else main().catch((e) => fail(e instanceof Error ? e.message : String(e)))

async function main() {
  if (opt.help || !cmd) return console.log(HELP)
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('--port must be a port number')
  const args: Record<string, string> = {}
  if (cmd === 'freeze' && opt.name != null) args.name = opt.name
  if (cmd === 'compare' && opt.against != null) args.against = opt.against
  if (cmd === 'compare' && opt.mode != null) args.mode = opt.mode
  if (!['open', 'freeze', 'compare', 'off', 'list', 'status', 'stop'].includes(cmd)) fail(`unknown command "${cmd}". Run yoyo --help.`)
  const extra = positionals[1]
  if (cmd === 'open') {
    if (!extra || !/^https?:\/\//.test(extra)) fail('usage: yoyo open <http(s) url> [--headless]')
    args.target = new URL(extra).href
    if (opt.headless) args.headless = 'true'
  } else if (extra) {
    fail(
      `yoyo ${cmd} takes no URL (removed in 0.5.0): it acts on a browser tab that has the yoyo toolbar. ` +
        `To pick a tab use --url <text>. To open one, run: yoyo open ${extra}` +
        (extra.startsWith('http') ? ` (add --headless if there is no browser)` : ''),
    )
  }

  let res = await send({ cmd, args, url: opt.url }).catch(() => null)
  if (!res) {
    if (cmd === 'stop') return out({ stopped: false, reason: 'relay was not running' })
    startRelay()
    res = await retry(() => send({ cmd, args, url: opt.url }))
  }
  if (!res.ok) fail(res.error)
  out(res.data)
}

/** POST a command to the relay. Rejects when no relay listens. */
function send(body: object): Promise<{ ok: boolean; data?: object; error?: string }> {
  return new Promise((ok, no) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/cmd', method: 'POST' }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (text += c))
      res.on('end', () => {
        try {
          ok(JSON.parse(text))
        } catch {
          no(new Error(`port ${port} answered, but not as the yoyo relay. Pick another with --port.`))
        }
      })
    })
    req.on('error', no)
    req.end(JSON.stringify(body))
  })
}

function startRelay() {
  const self = fileURLToPath(import.meta.url)
  spawn(process.execPath, [self, '__relay', '--port', String(port)], { detached: true, stdio: 'ignore' }).unref()
}

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i >= 30) throw e
      await new Promise((ok) => setTimeout(ok, 100))
    }
  }
}

// ---- relay: background process between CLI calls and browser tabs ----

interface Tab {
  url: string
  loaded: number // when the page loaded (performance.timeOrigin): stays the same across reconnects
  seen: number // last focused (as reported by the tab), or opened by `yoyo open`
  res: ServerResponse
}

function relay() {
  const tabs = new Map<string, Tab>()
  const pending = new Map<string, (r: object) => void>()
  const tabWaiters = new Set<() => void>()
  let headless: ChildProcess | undefined
  let profile: string | undefined
  /** Stop the headless browser and wait for it, so its profile can be deleted and `yoyo stop` means stopped. */
  const closeHeadless = async () => {
    const proc = headless
    const dir = profile
    headless = profile = undefined
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise((ok) => proc.once('exit', ok))
      proc.kill()
      await Promise.race([exited, new Promise((ok) => setTimeout(ok, 5000))])
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  }
  const shutdown = () => closeHeadless().finally(() => process.exit(0))
  process.on('exit', () => headless?.kill('SIGKILL')) // last resort if we exit some other way
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, shutdown)
  let idle: ReturnType<typeof setTimeout>
  const bump = () => {
    clearTimeout(idle)
    idle = setTimeout(shutdown, IDLE_MS)
  }
  bump()

  const server = http.createServer((req, res) =>
    handle(req, res).catch((e) => reply(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) })),
  )

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url ?? '/', 'http://relay')
    // DNS rebinding: only answer requests addressed to loopback
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) return reply(res, 403, { error: 'bad host' })
    const origin = req.headers.origin

    if (u.pathname === '/cmd') {
      // Browsers always send Origin on POST, so this blocks web pages from driving your tabs.
      if (origin || req.method !== 'POST') return reply(res, 403, { error: 'CLI only' })
      bump()
      const { cmd, args, url } = JSON.parse((await body(req)) || '{}')
      if (cmd === 'stop') {
        await closeHeadless()
        reply(res, 200, { ok: true, data: { stopped: true } })
        return setTimeout(() => process.exit(0), 50)
      }
      if (cmd === 'status')
        return reply(res, 200, {
          ok: true,
          data: { port, headless: !!headless && headless.exitCode === null, tabs: sorted(url).map((t) => ({ url: t.url, lastFocused: t.seen })) },
        })
      if (cmd === 'open') {
        const start = Date.now()
        if (args.headless) {
          const exe = findBrowser()
          if (!exe)
            return reply(res, 200, {
              ok: false,
              error: 'no Chromium-based browser found for --headless. Install Google Chrome, Chromium, Edge or Brave, or set YOYO_BROWSER to its executable.',
            })
          await closeHeadless()
          // A fresh profile each time: a shared one is locked by any Chrome still running from an earlier relay,
          // and Chrome then hands the URL to that instance and exits. Snapshots live as long as this page.
          // ponytail: one headless page per relay; a second open replaces it.
          profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yoyo-headless-'))
          headless = spawn(
            exe,
            ['--headless=new', `--user-data-dir=${profile}`, '--window-size=1280,800', '--no-first-run', '--no-default-browser-check',
              // a window nobody looks at counts as backgrounded: timers and frames throttle and hot reload stalls
              '--disable-breakpad', '--disable-crash-reporter',
              '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
              ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), args.target],
            { stdio: 'ignore' },
          )
        } else openInBrowser(args.target)
        // Only a page of that app that loaded after now. Other yoyo tabs reconnect to a fresh relay at the same
        // moment, but they keep their old load time.
        const tab = await waitForTab(new URL(args.target).origin, start, OPEN_WAIT_MS)
        if (!tab)
          return reply(res, 200, {
            ok: false,
            error: `opened ${args.target}, but no yoyo toolbar connected within ${OPEN_WAIT_MS / 1000}s. Check that the dev server is running and that the app imports @northlite/yoyo in development.`,
          })
        tab.seen = Date.now() // the page we just opened is the default target from now on
        return reply(res, 200, { ok: true, data: { opened: tab.url, headless: !!args.headless } })
      }
      const tab = sorted(url)[0] ?? (await waitForTab(url))
      if (!tab)
        return reply(res, 200, {
          ok: false,
          error: `no browser tab${url ? ` with "${url}" in its URL` : ''} is connected. Open your app in the browser with the dev server running and yoyo imported (the toolbar shows at the bottom), or run: yoyo open <url> (add --headless if there is no browser). Then run the command again.`,
        })
      const id = Math.random().toString(36).slice(2)
      const result = await new Promise<object>((ok) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          ok({ ok: false, error: `the tab (${tab.url}) did not answer within ${ANSWER_MS / 1000}s` })
        }, ANSWER_MS)
        pending.set(id, (r) => {
          clearTimeout(timer)
          ok(r)
        })
        tab.res.write(`data: ${JSON.stringify({ id, cmd, args })}\n\n`)
      })
      return reply(res, 200, result)
    }

    // Browser endpoints: only pages served from this machine or the local network.
    if (!origin || !localOrigin(origin)) return reply(res, 403, { error: 'origin not allowed' })
    res.setHeader('Access-Control-Allow-Origin', origin)

    if (u.pathname === '/events' && req.method === 'GET') {
      const id = u.searchParams.get('tab') ?? ''
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
      res.write(': connected\n\n')
      tabs.set(id, { url: u.searchParams.get('url') ?? '', loaded: Number(u.searchParams.get('loaded')) || 0, seen: Number(u.searchParams.get('focused')) || 0, res })
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
      req.on('close', () => {
        clearInterval(ping)
        if (tabs.get(id)?.res === res) tabs.delete(id)
      })
      for (const w of tabWaiters) w()
      return
    }
    if (req.method === 'POST' && (u.pathname === '/seen' || u.pathname === '/result')) {
      const msg = JSON.parse((await body(req)) || '{}')
      const tab = tabs.get(msg.tab)
      if (tab) {
        tab.url = msg.url ?? tab.url
        if (u.pathname === '/seen') tab.seen = Date.now()
      }
      if (u.pathname === '/result') {
        pending.get(msg.id)?.(msg.ok ? { ok: true, data: msg.data } : { ok: false, error: msg.error })
        pending.delete(msg.id)
      }
      return reply(res, 204)
    }
    reply(res, 404, { error: 'not found' })
  }
  server.on('error', () => process.exit(1)) // port taken, e.g. by a relay another CLI call just started
  server.listen(port, '127.0.0.1')

  function sorted(url?: string) {
    return [...tabs.values()].filter((t) => !url || t.url.includes(url)).sort((a, b) => b.seen - a.seen)
  }

  /** First tab matching `url` whose page loaded at or after `loadedAfter`. */
  function waitForTab(url?: string, loadedAfter = 0, ms = TAB_WAIT_MS) {
    return new Promise<Tab | undefined>((ok) => {
      const check = () => {
        const t = sorted(url).find((t) => t.loaded >= loadedAfter)
        if (!t) return
        done(t)
      }
      const done = (t?: Tab) => {
        clearTimeout(timer)
        tabWaiters.delete(check)
        ok(t)
      }
      const timer = setTimeout(() => done(), ms)
      tabWaiters.add(check)
      check()
    })
  }
}

function openInBrowser(url: string) {
  const [bin, ...pre] =
    process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', '""'] : ['xdg-open']
  spawn(bin, [...pre, url], { stdio: 'ignore', detached: true }).unref()
}

/** $YOYO_BROWSER, then common install paths, then Chromium-family names on PATH. */
function findBrowser(): string | undefined {
  if (process.env.YOYO_BROWSER) return process.env.YOYO_BROWSER
  const home = os.homedir()
  const dirs = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
  const known: Record<string, string[]> = {
    darwin: [
      'Google Chrome.app/Contents/MacOS/Google Chrome',
      'Chromium.app/Contents/MacOS/Chromium',
      'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'Brave Browser.app/Contents/MacOS/Brave Browser',
    ].flatMap((p) => [`/Applications/${p}`, `${home}/Applications/${p}`]),
    win32: dirs.flatMap((d) => [
      `${d}\\Google\\Chrome\\Application\\chrome.exe`,
      `${d}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${d}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    ]),
  }
  const hit = (known[process.platform] ?? []).find((p) => fs.existsSync(p))
  if (hit) return hit
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter))
    for (const n of names) if (fs.existsSync(path.join(dir, n))) return path.join(dir, n)
}

/** localhost, loopback, *.localhost, *.local and private LAN addresses. */
function localOrigin(origin: string) {
  let host: string
  try {
    host = new URL(origin).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return false
  }
  return (
    host === 'localhost' ||
    host === '::1' ||
    /\.(localhost|local)$/.test(host) ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
}

function body(req: IncomingMessage) {
  return new Promise<string>((ok) => {
    let text = ''
    req.setEncoding('utf8')
    req.on('data', (c) => (text += c))
    req.on('end', () => ok(text))
  })
}

function reply(res: ServerResponse, status: number, json?: object) {
  res.writeHead(status, json ? { 'Content-Type': 'application/json' } : {})
  res.end(json ? JSON.stringify(json) : undefined)
}

function out(o: object | undefined) {
  console.log(JSON.stringify(o ?? {}))
}

function fail(error = 'unknown error'): never {
  console.error(JSON.stringify({ error }))
  process.exit(1)
}
