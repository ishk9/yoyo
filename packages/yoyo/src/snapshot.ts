export interface Capture {
  route: string
  createdAt: number
  html: string
  viewport: { w: number; h: number }
  scroll: { x: number; y: number; containers: Record<string, [top: number, left: number]> }
}

export interface SnapshotRecord extends Capture {
  id: string
  label: string
}

const STRIP = 'script, noscript, yoyo-root, nextjs-portal'

/** Freeze the current render into a self-contained HTML string. No JS survives. */
export function capture(doc: Document = document): Capture {
  const win = doc.defaultView!
  const root = doc.documentElement
  const clone = root.cloneNode(true) as HTMLElement
  // cloneNode keeps tree order, so index i in both lists is the same node
  const src = [root, ...root.querySelectorAll('*')]
  const dst = [clone, ...clone.querySelectorAll('*')]
  const twin = new Map<Element, Element>()
  const containers: Capture['scroll']['containers'] = {}

  src.forEach((el, i) => {
    const c = dst[i]
    twin.set(el, c)
    switch (el.tagName) {
      case 'INPUT': {
        const input = el as HTMLInputElement
        if (input.type === 'checkbox' || input.type === 'radio') c.toggleAttribute('checked', input.checked)
        else if (input.type !== 'password' && input.type !== 'file') c.setAttribute('value', input.value)
        break
      }
      case 'TEXTAREA':
        c.textContent = (el as HTMLTextAreaElement).value
        break
      case 'OPTION':
        c.toggleAttribute('selected', (el as HTMLOptionElement).selected)
        break
      case 'IMG': {
        const img = el as HTMLImageElement
        const url = img.currentSrc || img.src
        if (url) c.setAttribute('src', url)
        for (const a of ['srcset', 'sizes', 'loading', 'decoding']) c.removeAttribute(a)
        break
      }
      case 'CANVAS':
        try {
          const img = doc.createElement('img')
          for (const a of el.attributes) img.setAttribute(a.name, a.value)
          img.src = (el as HTMLCanvasElement).toDataURL()
          c.replaceWith(img)
        } catch {} // tainted canvas: leave it blank
        break
    }
    if (el !== root && el !== doc.body && (el.scrollTop || el.scrollLeft)) {
      c.setAttribute('data-yoyo-scroll', String(i))
      containers[i] = [el.scrollTop, el.scrollLeft]
    }
  })

  // Swap each stylesheet's node for its live rules, in place, so cascade order holds.
  const keep = new Set<Element>()
  for (const sheet of doc.styleSheets) {
    const node = sheet.ownerNode && twin.get(sheet.ownerNode as Element)
    if (!node) continue
    if (sheet.disabled) {
      node.remove()
      continue
    }
    const css = serialize(sheet, sheet.href ?? doc.baseURI)
    if (css === null) {
      if (sheet.href) node.setAttribute('href', sheet.href) // cross-origin: keep the link, absolute
      keep.add(node)
      continue
    }
    const style = doc.createElement('style')
    if (sheet.media.mediaText) style.setAttribute('media', sheet.media.mediaText)
    style.textContent = css
    node.replaceWith(style)
  }

  const head = clone.querySelector('head')!
  for (const sheet of doc.adoptedStyleSheets ?? []) {
    const style = doc.createElement('style')
    style.textContent = serialize(sheet, doc.baseURI) ?? ''
    head.append(style)
  }

  clone.querySelectorAll(STRIP).forEach((el) => el.remove())
  // A stylesheet link not in styleSheets is still loading: the live page doesn't render it yet,
  // and keeping it would fetch whatever CSS is current when the snapshot is viewed.
  clone.querySelectorAll('link[rel~=stylesheet]').forEach((el) => keep.has(el) || el.remove())
  const base = doc.createElement('base')
  base.href = doc.baseURI
  head.prepend(base)

  return {
    route: win.location.pathname,
    createdAt: Date.now(),
    html: (doc.compatMode === 'CSS1Compat' ? '<!DOCTYPE html>' : '') + clone.outerHTML,
    viewport: { w: win.innerWidth, h: win.innerHeight },
    scroll: { x: win.scrollX, y: win.scrollY, containers },
  }
}

/** Rules as text with url()s made absolute; null when the sheet is cross-origin. */
function serialize(sheet: CSSStyleSheet, base: string): string | null {
  let rules: CSSRuleList
  try {
    rules = sheet.cssRules
  } catch {
    return null
  }
  let imports = ''
  let body = ''
  for (const rule of rules) {
    if (rule.type !== 3) {
      body += rewriteUrls(rule.cssText, base) + '\n'
      continue
    }
    const imp = rule as CSSImportRule
    const inner = imp.styleSheet && serialize(imp.styleSheet, imp.styleSheet.href ?? base)
    if (inner == null) {
      imports += rewriteUrls(rule.cssText, base) + '\n' // @import must stay on top
      continue
    }
    let text = inner
    if (imp.media.mediaText) text = `@media ${imp.media.mediaText} {\n${text}}`
    const layer = (imp as CSSImportRule & { layerName?: string | null }).layerName
    if (layer != null) text = `@layer ${layer} {\n${text}}`
    body += text + '\n'
  }
  return imports + body
}

export function rewriteUrls(css: string, base: string): string {
  return css.replace(/url\((['"]?)(.*?)\1\)/g, (m, q, u: string) => {
    if (!u || u.startsWith('data:') || u.startsWith('#')) return m
    try {
      return `url(${q}${new URL(u, base).href}${q})`
    } catch {
      return m
    }
  })
}
