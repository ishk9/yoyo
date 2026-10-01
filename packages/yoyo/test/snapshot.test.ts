// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { capture, rewriteUrls } from '../src/snapshot'

afterEach(() => {
  document.documentElement.className = ''
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const fakeSheets = (sheets: object[]) =>
  vi.spyOn(document, 'styleSheets', 'get').mockReturnValue(sheets as unknown as StyleSheetList)

describe('capture', () => {
  it('keeps style rules and drops scripts', () => {
    document.head.innerHTML = '<style>h1 { color: red; }</style><script>1</script>'
    document.body.innerHTML = '<h1>hi</h1><script>2</script><noscript>x</noscript>'
    const { html } = capture()
    expect(html).toContain('color: red')
    expect(html).not.toMatch(/<script|<noscript/)
  })

  it('reads insertRule-only sheets (empty textContent)', () => {
    const style = document.createElement('style')
    document.head.append(style)
    style.sheet!.insertRule('.speedy { color: blue; }')
    expect(style.textContent).toBe('')
    expect(capture().html).toMatch(/<style>\.speedy \{\s*color: blue;\s*\}/)
  })

  it('freezes form state as attributes', () => {
    document.body.innerHTML = `
      <input id="t"><input id="c" type="checkbox"><input id="p" type="password">
      <select id="s"><option>a</option><option>b</option><option>c</option></select>
      <textarea id="a"></textarea>`
    ;(document.getElementById('t') as HTMLInputElement).value = 'hello'
    ;(document.getElementById('c') as HTMLInputElement).checked = true
    ;(document.getElementById('p') as HTMLInputElement).value = 'secret'
    ;(document.getElementById('s') as HTMLSelectElement).selectedIndex = 1
    ;(document.getElementById('a') as HTMLTextAreaElement).value = 'notes'
    const { html } = capture()
    expect(html).toContain('<input id="t" value="hello">')
    expect(html).toContain('<input id="c" type="checkbox" checked="">')
    expect(html).toContain('<option selected="">b</option>')
    expect(html).toContain('<textarea id="a">notes</textarea>')
    expect(html).not.toContain('secret')
  })

  it('rewrites url() against the sheet href, leaves data: alone', () => {
    fakeSheets([
      {
        href: 'http://localhost:3000/css/x.css',
        ownerNode: document.head.appendChild(document.createElement('link')),
        disabled: false,
        media: { mediaText: '' },
        cssRules: [{ type: 1, cssText: 'a { background: url("../img/a.png"), url(data:image/png;base64,AA); }' }],
      },
    ])
    const { html } = capture()
    expect(html).toContain('url("http://localhost:3000/img/a.png")')
    expect(html).toContain('url(data:image/png;base64,AA)')
    expect(html).not.toContain('<link')
  })

  it('keeps cross-origin links absolute and does not throw', () => {
    const link = document.head.appendChild(document.createElement('link'))
    link.rel = 'stylesheet'
    link.setAttribute('href', '//fonts.example.com/css')
    fakeSheets([
      {
        href: 'https://fonts.example.com/css',
        ownerNode: link,
        disabled: false,
        media: { mediaText: '' },
        get cssRules(): never {
          throw new DOMException('blocked', 'SecurityError')
        },
      },
    ])
    expect(capture().html).toContain('<link rel="stylesheet" href="https://fonts.example.com/css">')
  })

  it('drops stylesheet links that have not loaded yet', () => {
    document.head.innerHTML = '<link rel="stylesheet" href="/pending.css">'
    fakeSheets([])
    expect(capture().html).not.toContain('pending.css')
  })

  it('inlines readable @import and keeps unreadable ones on top', () => {
    fakeSheets([
      {
        href: 'http://localhost:3000/a.css',
        ownerNode: document.head.appendChild(document.createElement('style')),
        disabled: false,
        media: { mediaText: '' },
        cssRules: [
          {
            type: 3,
            cssText: '@import url("https://cdn.example.com/x.css");',
            media: { mediaText: '' },
            get styleSheet() {
              return { href: 'https://cdn.example.com/x.css', get cssRules(): never { throw new Error() } }
            },
          },
          {
            type: 3,
            cssText: '@import url("sub/b.css") print;',
            media: { mediaText: 'print' },
            styleSheet: {
              href: 'http://localhost:3000/sub/b.css',
              cssRules: [{ type: 1, cssText: 'b { background: url(c.png); }' }],
            },
          },
          { type: 1, cssText: 'i { color: red; }' },
        ],
      },
    ])
    const css = capture().html.match(/<style>([\s\S]*?)<\/style>/)![1]
    expect(css.indexOf('@import url("https://cdn.example.com/x.css")')).toBe(0)
    expect(css).toContain('@media print {\nb { background: url(http://localhost:3000/sub/c.png); }')
    expect(css).toContain('i { color: red; }')
  })

  it('strips tool UI and the Next dev overlay', () => {
    document.body.innerHTML = '<yoyo-root></yoyo-root><nextjs-portal></nextjs-portal><p>app</p>'
    const { html } = capture()
    expect(html).not.toMatch(/yoyo-root|nextjs-portal/)
    expect(html).toContain('<p>app</p>')
  })

  it('preserves the dark class on <html>', () => {
    document.documentElement.className = 'dark'
    expect(capture().html).toMatch(/^<!DOCTYPE html><html class="dark">/)
  })

  it('turns canvas into an img data URL', () => {
    document.body.innerHTML = '<canvas class="c" width="10" height="10"></canvas>'
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,QQ')
    expect(capture().html).toContain('<img class="c" width="10" height="10" src="data:image/png;base64,QQ">')
  })

  it('pins img to its resolved src and records scroll containers', () => {
    document.body.innerHTML = '<img src="/a.png" srcset="/a2.png 2x" loading="lazy"><div id="s"></div>'
    const div = document.getElementById('s')!
    div.scrollTop = 120
    div.scrollLeft = 30
    const { html, scroll } = capture()
    expect(html).toContain('<img src="http://localhost:3000/a.png">')
    const idx = html.match(/data-yoyo-scroll="(\d+)"/)![1]
    expect(scroll.containers[idx]).toEqual([120, 30])
  })

  it('adds a <base> so relative URLs resolve inside srcdoc', () => {
    expect(capture().html).toContain('<head><base href="http://localhost:3000/">')
  })
})

describe('rewriteUrls', () => {
  it('handles quotes, fragments and absolute urls', () => {
    const base = 'http://x.test/css/a.css'
    expect(rewriteUrls("url('f.woff2')", base)).toBe("url('http://x.test/css/f.woff2')")
    expect(rewriteUrls('url(#clip)', base)).toBe('url(#clip)')
    expect(rewriteUrls('url(https://cdn.test/a.png)', base)).toBe('url(https://cdn.test/a.png)')
  })
})
