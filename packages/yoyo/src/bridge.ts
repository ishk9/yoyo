// Links this tab to the `yoyo` CLI. The CLI runs a tiny relay on 127.0.0.1; the tab listens on an
// EventSource, runs each command here (in the user's own browser) and posts the JSON result back.
type Api = Record<string, (args: any) => unknown>

export function connect(api: Api, port: number) {
  const base = `http://127.0.0.1:${port}`
  const tab = Math.random().toString(36).slice(2)
  let delay = 1000
  let live = false
  // When the user last focused this tab. Sent on every (re)connect: a tab reconnecting to a new relay
  // must not jump ahead of the tab the user is actually working in.
  let focusedAt = document.hasFocus() ? Date.now() : 0
  // text/plain keeps these simple CORS requests: no preflight
  const post = (p: string, body: object) => fetch(base + p, { method: 'POST', body: JSON.stringify(body) }).catch(() => {})

  function open() {
    const es = new EventSource(`${base}/events?tab=${tab}&focused=${focusedAt}&loaded=${Math.round(performance.timeOrigin)}&url=${encodeURIComponent(location.href)}`)
    es.onopen = () => {
      live = true
      delay = 1000
    }
    es.onmessage = async (e) => {
      const { id, cmd, args } = JSON.parse(e.data)
      let res: object
      try {
        if (!Object.hasOwn(api, cmd)) throw new Error(`unknown command "${cmd}"`)
        res = { id, ok: true, data: await api[cmd](args ?? {}) }
      } catch (err) {
        res = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      post('/result', { ...res, tab, url: location.href })
    }
    // ponytail: while no relay runs, each retry logs one connection error in the console; backoff caps at 10s.
    // init({ cli: false }) turns the link off.
    es.onerror = () => {
      es.close()
      live = false
      setTimeout(open, delay)
      delay = Math.min(delay * 2, 10_000)
    }
  }

  // the tab the user last looked at is the CLI's default target
  addEventListener('focus', () => {
    focusedAt = Date.now()
    if (live) post('/seen', { tab, url: location.href })
  })
  open()
}
