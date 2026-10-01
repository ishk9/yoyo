import { capture, type SnapshotRecord } from './snapshot'
import * as store from './store'

type Action = 'freeze' | 'peek' | 'compare' | 'mode' | 'prev' | 'next'
type Mode = 'slider' | 'onion' | 'difference' | 'split'
type Shown = Mode | 'off' | 'peek'

export interface Options {
  /** `e.code` combos, e.g. `{ freeze: 'Alt+Shift+KeyF' }`. Modifiers: Alt, Shift, Ctrl, Meta. */
  keys?: Partial<Record<Action, string>>
  maxPerRoute?: number
}

const KEYS: Record<Action, string> = {
  freeze: 'Alt+Shift+KeyS',
  peek: 'Alt+Shift+KeyZ',
  compare: 'Alt+Shift+KeyD',
  mode: 'Alt+Shift+KeyM',
  prev: 'Alt+Shift+BracketLeft',
  next: 'Alt+Shift+BracketRight',
}
const MODES: Mode[] = ['slider', 'onion', 'difference', 'split']
const PREFS_KEY = 'yoyo:ui'

const CSS = `
* { box-sizing: border-box; }
.frozen, .live { position: fixed; top: 0; left: 0; width: 100%; height: 100%; border: 0; margin: 0; z-index: 2147483646; }
.frozen { visibility: hidden; pointer-events: none; }
.live, .seam, .amount { display: none; }
.stage:not([data-mode=off]) .frozen { visibility: visible; }
[data-mode=slider] .frozen { clip-path: inset(0 0 0 var(--v)); }
[data-mode=onion] .frozen { opacity: var(--o); }
[data-mode=difference] .frozen { mix-blend-mode: difference; }
[data-mode=split] .frozen { width: 50%; }
[data-mode=split] .live { display: block; left: 50%; width: 50%; border-left: 2px solid #f0f; }
[data-mode=slider] .seam { display: block; position: fixed; top: 0; bottom: 0; left: var(--v); width: 9px; margin-left: -4px;
  cursor: ew-resize; z-index: 2147483647; background: linear-gradient(90deg, transparent 4px, #f0f 4px 5px, transparent 5px); }
[data-mode=slider] .amount, [data-mode=onion] .amount { display: inline-block; }
.bar { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; gap: 4px; align-items: center;
  padding: 4px 6px; border-radius: 8px; background: #111; color: #eee; font: 12px/1.2 system-ui, sans-serif;
  box-shadow: 0 2px 12px rgba(0,0,0,.4); user-select: none; }
.bar.min .rest { display: none; }
.rest { display: flex; gap: 4px; align-items: center; }
button, select { all: unset; padding: 2px 6px; border-radius: 4px; cursor: pointer; background: #2a2a2a; }
button:hover, select:hover { background: #3a3a3a; }
button:focus-visible, select:focus-visible { outline: 2px solid #f0f; }
.grip { cursor: grab; padding: 0 2px; }
.chip.on { background: #f0f; color: #000; }
.chip i { font-style: normal; margin-left: 4px; opacity: .6; }
.amount { width: 80px; accent-color: #f0f; }
.toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647; padding: 6px 12px;
  border-radius: 6px; background: #111; color: #eee; font: 13px system-ui, sans-serif; pointer-events: none; }
`

const HTML = `
<div class="stage" data-mode="off">
  <iframe class="frozen" title="yoyo frozen snapshot" tabindex="-1" sandbox="allow-same-origin"></iframe>
  <iframe class="live" title="yoyo live page"></iframe>
  <div class="seam"></div>
  <div class="bar">
    <span class="grip" title="Drag">⠿</span>
    <span class="rest">
      <button class="freeze" title="Freeze snapshot">● Freeze</button>
      <span class="chips"></span>
      <select class="mode" title="Compare mode">
        <option value="off">off</option>${MODES.map((m) => `<option>${m}</option>`).join('')}
      </select>
      <input class="amount" type="range" min="0" max="100" aria-label="Slider / opacity">
    </span>
    <button class="min" title="Hide">–</button>
  </div>
  <div class="toast" hidden></div>
</div>`

export function mountUI(opts: Options) {
  const keys = { ...KEYS, ...opts.keys }
  const host = document.createElement('yoyo-root')
  // display:contents keeps the host from forming a stacking context, so difference mode can blend with the page.
  host.style.cssText = 'all: initial; display: contents;'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>${CSS}</style>${HTML}`
  const $ = <T extends HTMLElement>(sel: string) => shadow.querySelector(sel) as T
  const stage = $('.stage')
  const frame = $<HTMLIFrameElement>('.frozen')
  const live = $<HTMLIFrameElement>('.live')
  const bar = $('.bar')
  const chips = $('.chips')
  const modeSelect = $<HTMLSelectElement>('.mode')
  const amount = $<HTMLInputElement>('.amount')
  const toastEl = $('.toast')

  const prefs: { mode: Mode; v: number; comparing: boolean; active: Record<string, string> } = {
    mode: 'slider',
    v: 50,
    // comparing + active snapshot per route are persisted: webpack full-reloads on CSS Module edits
    comparing: false,
    active: {},
    ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'),
  }
  let route = location.pathname
  let snaps: SnapshotRecord[] = [] // newest first
  let activeId: string | undefined
  let loaded: string | undefined
  let peeking = false
  let toastTimer: ReturnType<typeof setTimeout>
  let savedPrefs = ''

  const active = () => snaps.find((s) => s.id === activeId)
  const oldestFirst = () => [...snaps].reverse()

  function toast(msg: string) {
    toastEl.textContent = msg
    toastEl.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toastEl.hidden = true), 1200)
  }

  const shown = () => stage.dataset.mode as Shown
  const isOverlay = () => shown() !== 'off' && shown() !== 'split'

  function paint() {
    const comparing: Shown = prefs.comparing && active() ? prefs.mode : 'off'
    stage.dataset.mode = peeking ? 'peek' : comparing
    stage.style.setProperty('--v', `${prefs.v}%`)
    stage.style.setProperty('--o', String(prefs.v / 100))
    modeSelect.value = comparing
    amount.value = String(prefs.v)
    if (shown() === 'split' && live.dataset.route !== location.href) {
      live.dataset.route = live.src = location.href
    }
    if (isOverlay()) mirror(window, frame.contentWindow)
    const saved = JSON.stringify(prefs)
    if (saved !== savedPrefs) localStorage.setItem(PREFS_KEY, (savedPrefs = saved))
  }

  function render() {
    chips.replaceChildren(
      ...oldestFirst().map((s) => {
        const chip = document.createElement('button')
        chip.className = s.id === activeId ? 'chip on' : 'chip'
        chip.title = 'Click: select · Double-click: rename'
        chip.textContent = s.label
        const del = document.createElement('i')
        del.textContent = '×'
        del.title = 'Delete'
        chip.append(del)
        chip.onclick = async (e) => {
          if (e.target === del) {
            await store.remove(s.id)
            return refresh()
          }
          activeId = s.id
          render()
        }
        chip.ondblclick = async () => {
          const label = prompt('Rename snapshot', s.label)?.trim()
          if (!label) return
          await store.rename(s.id, label)
          refresh()
        }
        return chip
      }),
    )
    const rec = active()
    if (rec) prefs.active[route] = rec.id
    else delete prefs.active[route]
    if (rec?.id !== loaded) {
      loaded = rec?.id
      frame.srcdoc = rec?.html ?? ''
    }
    if (!rec) peeking = false
    paint()
  }

  async function refresh() {
    route = location.pathname
    snaps = await store.list(route)
    activeId = prefs.active[route]
    if (!active()) activeId = snaps[0]?.id
    render()
  }

  async function freeze() {
    await document.fonts?.ready
    const rec = await store.save(capture(), opts.maxPerRoute)
    prefs.active[rec.route] = rec.id
    await refresh()
    toast(`Frozen ${rec.label}`)
  }

  function needSnapshot() {
    if (active()) return true
    toast(`No snapshot yet: ${keys.freeze}`)
    return false
  }

  function step(dir: 1 | -1) {
    const ordered = oldestFirst()
    if (!ordered.length) return
    const i = ordered.findIndex((s) => s.id === activeId)
    activeId = ordered[(i + dir + ordered.length) % ordered.length].id
    render()
    toast(active()!.label)
  }

  // Scroll sync. Overlay modes: page → frozen. Split: frozen ↔ live iframe, skipping the echo we cause.
  const echoes = new WeakSet<Window>()
  function mirror(from: Window | null, to: Window | null) {
    if (!from || !to) return
    if (echoes.delete(from)) return
    const { scrollX, scrollY } = to
    to.scrollTo({ left: from.scrollX, top: from.scrollY, behavior: 'instant' })
    if (to.scrollX !== scrollX || to.scrollY !== scrollY) echoes.add(to)
  }
  addEventListener('scroll', () => isOverlay() && mirror(window, frame.contentWindow), { passive: true })
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument
    const rec = active()
    if (!doc || !rec) return
    for (const [i, [top, left]] of Object.entries(rec.scroll.containers)) {
      doc.querySelector(`[data-yoyo-scroll="${i}"]`)?.scrollTo({ top, left, behavior: 'instant' })
    }
    const src = shown() === 'split' ? live.contentWindow : window
    mirror(src, frame.contentWindow)
    const win = frame.contentWindow!
    // outside split nobody consumes the echo flag, so clear it here or split's first scroll is swallowed
    win.addEventListener('scroll', () => (shown() === 'split' ? mirror(win, live.contentWindow) : echoes.delete(win)), { passive: true })
  })
  live.addEventListener('load', () => {
    mirror(window, live.contentWindow) // open split where the page already is
    live.contentWindow?.addEventListener('scroll', () => mirror(live.contentWindow, frame.contentWindow), { passive: true })
  })

  const actions: Record<Action, () => unknown> = {
    freeze,
    peek: () => {
      if (!needSnapshot()) return
      peeking = true
      paint()
    },
    compare: () => {
      if (!prefs.comparing && !needSnapshot()) return
      prefs.comparing = !prefs.comparing
      paint()
    },
    mode: () => {
      if (!needSnapshot()) return
      if (prefs.comparing) prefs.mode = MODES[(MODES.indexOf(prefs.mode) + 1) % MODES.length]
      prefs.comparing = true
      paint()
      toast(prefs.mode)
    },
    prev: () => step(-1),
    next: () => step(1),
  }

  const combos = (Object.keys(keys) as Action[]).map((a) => [a, parse(keys[a])] as const)
  const peekCombo = parse(keys.peek)
  function stopPeek() {
    if (!peeking) return
    peeking = false
    paint()
  }

  addEventListener(
    'keydown',
    (e) => {
      if (isEditable(e)) return
      const action = combos.find(([, c]) => matches(e, c))?.[0]
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat) actions[action]()
    },
    true,
  )
  addEventListener(
    'keyup',
    (e) => {
      if (peeking && (e.code === peekCombo.code || !modsHeld(e, peekCombo.mods))) stopPeek()
    },
    true,
  )
  addEventListener('blur', stopPeek) // Cmd+Tab mid-peek never delivers keyup

  $('.freeze').onclick = freeze
  $('.min').onclick = () => bar.classList.toggle('min')
  modeSelect.onchange = () => {
    if (modeSelect.value === 'off') prefs.comparing = false
    else if (needSnapshot()) {
      prefs.mode = modeSelect.value as Mode
      prefs.comparing = true
    }
    paint()
  }
  amount.oninput = () => {
    prefs.v = Number(amount.value)
    paint()
  }
  drag($('.seam'), (x) => {
    prefs.v = Math.round(Math.min(100, Math.max(0, (x / innerWidth) * 100)))
    paint()
  })
  const grip = $('.grip')
  drag(grip, (x, y) => {
    bar.style.left = `${Math.max(0, x - grip.offsetLeft - 6)}px`
    bar.style.top = `${Math.max(0, y - 12)}px`
    bar.style.right = bar.style.bottom = 'auto'
  })

  // Re-attach if the app wipes body children; also our cue for client-side route changes.
  document.body.append(host)
  new MutationObserver(() => {
    if (!host.isConnected) document.body.append(host)
    if (location.pathname !== route) refresh()
  }).observe(document.documentElement, { childList: true, subtree: true })
  addEventListener('popstate', () => location.pathname !== route && refresh())

  refresh()
}

function parse(combo: string) {
  const parts = combo.split('+')
  return { code: parts.pop()!, mods: parts }
}

function modsHeld(e: KeyboardEvent, mods: string[]) {
  const state: Record<string, boolean> = { Alt: e.altKey, Shift: e.shiftKey, Ctrl: e.ctrlKey, Meta: e.metaKey }
  return Object.keys(state).every((m) => state[m] === mods.includes(m))
}

function matches(e: KeyboardEvent, combo: { code: string; mods: string[] }) {
  return e.code === combo.code && modsHeld(e, combo.mods)
}

function isEditable(e: Event) {
  const t = e.composedPath()[0]
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
}

function drag(el: HTMLElement, move: (x: number, y: number) => void) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('lostpointercapture', () => el.removeEventListener('pointermove', onMove), { once: true })
  })
}
