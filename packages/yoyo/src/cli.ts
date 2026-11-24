#!/usr/bin/env node
// yoyo CLI: drives the yoyo toolbar in the browser tab you already have open. No browser automation.
//
//   CLI ──POST /cmd──► relay (127.0.0.1:7357, background process) ──SSE──► toolbar in your tab
//   CLI ◄──JSON─────── relay ◄──POST /result── toolbar (ran freeze/compare/… in your tab)
//
// The first command starts the relay; it exits after an hour without commands. Every command prints one JSON line.
import { spawn } from 'node:child_process'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const HELP = `yoyo — freeze the page in your browser, change code, compare. Drives the yoyo toolbar
in the tab you have open (dev server running, yoyo imported), so it needs no extra browser.

Usage:
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

Output is one JSON line on stdout. Errors: {"error": …} on stderr, exit code 1.`

const TAB_WAIT_MS = 15_000 // a tab retries the relay with backoff up to 10s, so give it one full round
const ANSWER_MS = 30_000
const IDLE_MS = 60 * 60_000

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    against: { type: 'string' },
    mode: { type: 'string' },
    url: { type: 'string' },
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
  if (!['freeze', 'compare', 'off', 'list', 'status', 'stop'].includes(cmd)) fail(`unknown command "${cmd}". Run yoyo --help.`)

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
  seen: number
  res: ServerResponse
}

function relay() {
  const tabs = new Map<string, Tab>()
  const pending = new Map<string, (r: object) => void>()
  const tabWaiters = new Set<() => void>()
  let idle: ReturnType<typeof setTimeout>
  const bump = () => {
    clearTimeout(idle)
    idle = setTimeout(() => process.exit(0), IDLE_MS)
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
        reply(res, 200, { ok: true, data: { stopped: true } })
        return setTimeout(() => process.exit(0), 50)
      }
      if (cmd === 'status')
        return reply(res, 200, { ok: true, data: { port, tabs: sorted(url).map((t) => ({ url: t.url, lastFocused: t.seen })) } })
      const tab = sorted(url)[0] ?? (await waitForTab(url))
      if (!tab)
        return reply(res, 200, {
          ok: false,
          error: `no browser tab${url ? ` with "${url}" in its URL` : ''} is connected. Open your app in the browser with the dev server running and yoyo imported (the toolbar shows at the bottom). Then run the command again.`,
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
      tabs.set(id, { url: u.searchParams.get('url') ?? '', seen: Date.now(), res })
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

  function waitForTab(url?: string) {
    return new Promise<Tab | undefined>((ok) => {
      const check = () => {
        const t = sorted(url)[0]
        if (!t) return
        done(t)
      }
      const done = (t?: Tab) => {
        clearTimeout(timer)
        tabWaiters.delete(check)
        ok(t)
      }
      const timer = setTimeout(() => done(), TAB_WAIT_MS)
      tabWaiters.add(check)
    })
  }
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
