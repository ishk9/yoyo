import { isWaitingToReveal, PRE_REVEAL } from './snapshot'

export interface Change {
  el: string
  prop: string
  before: string
  after: string
}

// Computed styles an agent cares about when judging a UI change. Longhands only: shorthands read back empty.
const PROPS = [
  'display', 'position', 'visibility', 'opacity', 'z-index',
  'width', 'height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'color', 'background-color', 'background-image',
  'border-top-width', 'border-top-style', 'border-top-color', 'border-top-left-radius',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-decoration-line', 'text-transform',
  'flex-direction', 'justify-content', 'align-items', 'gap', 'grid-template-columns',
  'box-shadow', 'transform', 'filter',
]
const SKIP = new Set(['SCRIPT', 'NOSCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'YOYO-ROOT', 'NEXTJS-PORTAL'])

/**
 * What differs between the frozen snapshot (`before`) and the live page (`after`), element by element.
 * Children are paired greedily by tag + class, so one inserted element doesn't shift every sibling after it.
 */
export function diff(before: Document, after: Document, max = 60): { changes: Change[]; total: number } {
  const changes: Change[] = []
  let total = 0
  const add = (c: Change) => {
    total++
    if (changes.length < max) changes.push(c)
  }
  const winA = before.defaultView!
  const winB = after.defaultView!

  function walk(a: Element, b: Element) {
    const el = describe(b)
    const ta = ownText(a)
    const tb = ownText(b)
    if (ta !== tb) add({ el, prop: 'text', before: ta, after: tb })
    const sa = winA.getComputedStyle(a)
    const sb = winB.getComputedStyle(b)
    // live content still waiting for a scroll-reveal; the snapshot shows it revealed (see capture)
    const waiting = isWaitingToReveal(b, winB)
    for (const p of PROPS) {
      if (waiting && PRE_REVEAL.includes(p)) continue
      const va = sa.getPropertyValue(p)
      const vb = sb.getPropertyValue(p)
      if (va !== vb) add({ el, prop: p, before: va, after: vb })
    }

    const ca = kids(a)
    const cb = kids(b)
    let i = 0
    for (const child of cb) {
      const j = ca.findIndex((c, k) => k >= i && sig(c) === sig(child))
      if (j < 0) {
        add({ el: describe(child), prop: 'element', before: '', after: 'added' })
        continue
      }
      for (const gone of ca.slice(i, j)) add({ el: describe(gone, b), prop: 'element', before: 'present', after: 'removed' })
      walk(ca[j], child)
      i = j + 1
    }
    for (const gone of ca.slice(i)) add({ el: describe(gone, b), prop: 'element', before: 'present', after: 'removed' })
  }

  walk(before.body, after.body)
  return { changes, total }
}

function kids(el: Element) {
  return [...el.children].filter((c) => !SKIP.has(c.tagName))
}

// capture() saves a canvas as an img with the same attributes, so pair them up
function sig(el: Element) {
  return `${el.tagName === 'CANVAS' ? 'IMG' : el.tagName}.${el.getAttribute('class') ?? ''}`
}

function ownText(el: Element) {
  let t = ''
  for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent
  t = t.replace(/\s+/g, ' ').trim()
  return t.length > 80 ? `${t.slice(0, 77)}...` : t
}

/** 'main > div.card > h1.heading'. A removed node is named under its live parent. */
function describe(el: Element, liveParent?: Element): string {
  const parts: string[] = []
  let node: Element | null = el
  for (let depth = 0; node && node.tagName !== 'BODY' && node.tagName !== 'HTML' && depth < 3; depth++) {
    parts.unshift(one(node))
    node = depth === 0 && liveParent ? liveParent : node.parentElement
  }
  return parts.join(' > ') || el.tagName.toLowerCase()
}

function one(el: Element) {
  const id = el.id ? `#${el.id}` : ''
  const test = el.getAttribute('data-testid')
  const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join('')
  return `${el.tagName.toLowerCase()}${id}${cls}${test ? `[data-testid=${test}]` : ''}`
}
