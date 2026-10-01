import { expect, test, type Page } from '@playwright/test'
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const APP = path.resolve('examples/next-app')
const CSS = path.join(APP, 'app/page.module.css')
const NEXT = path.join(APP, 'node_modules/next/dist/bin/next')
const ORIGINAL = fs.readFileSync(CSS, 'utf8')
const BLUE = 'rgb(37, 99, 235)'
const RED = 'rgb(220, 38, 38)'

const ui = (p: Page) => p.locator('yoyo-root')
const frozen = (p: Page) => p.frameLocator('yoyo-root iframe.frozen')
const mode = (p: Page) => ui(p).locator('.stage').getAttribute('data-mode')

async function open(p: Page, url = '/') {
  await p.goto(url)
  if (url === '/') {
    // the previous test's CSS restore may still be compiling, and webpack doesn't always push
    // the reload to a page opened mid-build; reload until we're past it
    await expect(async () => {
      const color = await p
        .getByTestId('heading')
        .evaluate((h) => getComputedStyle(h).color, null, { timeout: 3_000 })
        .catch(() => 'missing') // dev server answered with an error page
      if (color !== BLUE) await p.reload()
      await expect(p.getByTestId('heading')).toHaveCSS('color', BLUE, { timeout: 3_000 })
    }).toPass({ timeout: 30_000 })
  }
  await expect(ui(p)).toBeAttached()
  if (url !== '/') return
  // hydrated: the canvas is painted in an effect
  await expect
    .poll(() => p.locator('canvas').evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, 1, 1).data[3]))
    .toBe(255)
}

async function freeze(p: Page, label: string) {
  await p.keyboard.press('Alt+Shift+KeyS')
  await expect(ui(p).locator('.chip.on')).toHaveText(`${label}×`)
}

/** Rewrite the CSS Module and wait until HMR has applied it. */
async function editCss(p: Page, extra: string) {
  fs.writeFileSync(CSS, ORIGINAL.replace(`color: ${BLUE};`, `color: ${RED};\n  ${extra}`))
  await expect(p.getByTestId('heading')).toHaveCSS('color', RED, { timeout: 20_000 })
  // webpack full-reloads on CSS Module edits (Turbopack hot-swaps); wait for yoyo to come back
  await p.waitForLoadState('load')
  await expect(ui(p).locator('.chip.on')).toBeVisible()
  await expect(frozen(p).getByTestId('heading')).toBeAttached()
}

async function setMode(p: Page, m: string, amount?: number) {
  await ui(p).locator('select.mode').selectOption(m)
  if (amount != null) await ui(p).locator('.amount').fill(String(amount))
  await expect(ui(p).locator('.toast')).toBeHidden()
  await expect(frozen(p).getByTestId('heading')).toBeAttached()
}

type Clip = { x: number; y: number; width: number; height: number }

/** RGBA bytes of a viewport region, decoded in the page from a screenshot. */
async function rgba(p: Page, clip: Clip) {
  const png = (await p.screenshot({ clip })).toString('base64')
  return p.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return Array.from(ctx.getImageData(0, 0, img.width, img.height).data)
  }, png)
}

/** Share of near-black pixels in a viewport region. */
async function darkRatio(p: Page, clip: Clip) {
  const d = await rgba(p, clip)
  let dark = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] < 16 && d[i + 1] < 16 && d[i + 2] < 16) dark++
  return dark / (d.length / 4)
}

const pixel = async (p: Page, x: number, y: number) => (await rgba(p, { x, y, width: 1, height: 1 })).slice(0, 3)
const frozenY = (p: Page) => ui(p).locator('iframe.frozen').evaluate((f: HTMLIFrameElement) => f.contentWindow!.scrollY)

const isRed = ([r, g, b]: number[]) => r > 180 && g < 80 && b < 80

let errors: string[]
test.beforeEach(({ page }) => {
  errors = []
  page.on('pageerror', (e) => {
    // webpack dev sometimes reads its own manifest mid-write while recompiling; that's Next's server, not us
    if (!e.stack?.includes('/next/dist/server/')) errors.push(e.message)
  })
})
test.afterEach(() => {
  fs.writeFileSync(CSS, ORIGINAL)
  expect(errors).toEqual([])
})

test.describe('freeze + peek (R1, R3)', () => {
  test('shortcut freezes into chip A and IndexedDB', async ({ page }) => {
    await open(page)
    await page.keyboard.press('Alt+Shift+KeyS')
    await expect(ui(page).locator('.toast')).toHaveText('Frozen A')
    await expect(ui(page).locator('.chip')).toHaveText(['A×'])
    const count = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const req = indexedDB.open('yoyo')
          req.onsuccess = () => {
            const c = req.result.transaction('snaps').objectStore('snaps').count()
            c.onsuccess = () => resolve(c.result)
          }
        }),
    )
    expect(count).toBe(1)
  })

  test('ignored while typing in an input', async ({ page }) => {
    await open(page)
    await page.getByTestId('name').focus()
    await page.keyboard.press('Alt+Shift+KeyS')
    await page.waitForTimeout(300)
    await expect(ui(page).locator('.chip')).toHaveCount(0)
  })

  test('hold to peek shows the frozen render after HMR; release returns to live', async ({ page }) => {
    await open(page)
    await freeze(page, 'A')
    await editCss(page, '')
    await page.keyboard.down('Alt')
    await page.keyboard.down('Shift')
    await page.keyboard.down('KeyZ')
    expect(await mode(page)).toBe('peek')
    await expect(frozen(page).getByTestId('heading')).toHaveCSS('color', BLUE)
    await page.keyboard.up('KeyZ')
    expect(await mode(page)).toBe('off')
    await page.keyboard.up('Shift')
    await page.keyboard.up('Alt')
  })

  test('window blur ends a peek', async ({ page }) => {
    await open(page)
    await freeze(page, 'A')
    await page.keyboard.down('Alt')
    await page.keyboard.down('Shift')
    await page.keyboard.down('KeyZ')
    expect(await mode(page)).toBe('peek')
    await page.evaluate(() => dispatchEvent(new Event('blur')))
    expect(await mode(page)).toBe('off')
    await page.keyboard.up('KeyZ')
    await page.keyboard.up('Shift')
    await page.keyboard.up('Alt')
  })

  test('client-side navigation keeps the toolbar and swaps chips per route', async ({ page }) => {
    await open(page)
    await freeze(page, 'A')
    await page.getByRole('link', { name: 'About' }).click()
    await page.waitForURL('**/about')
    await expect(ui(page)).toBeAttached()
    await expect(ui(page).locator('.chip')).toHaveCount(0)
    await page.goBack()
    await expect(ui(page).locator('.chip')).toHaveText(['A×'])
  })
})

test.describe('store (R5)', () => {
  test('snapshots survive a full reload, newest active', async ({ page }) => {
    await open(page)
    await freeze(page, 'A')
    await freeze(page, 'B')
    await open(page, '/about')
    await freeze(page, 'A')
    await open(page)
    await expect(ui(page).locator('.chip')).toHaveText(['A×', 'B×'])
    await expect(ui(page).locator('.chip.on')).toHaveText('B×')
  })

  test('caps at 10 per route, evicting the oldest', async ({ page }) => {
    await open(page)
    for (const l of 'ABCDEFGHIJK') await freeze(page, l)
    await expect(ui(page).locator('.chip')).toHaveCount(10)
    await expect(ui(page).locator('.chip').first()).toHaveText('B×')
  })

  test('labels are never reused after delete', async ({ page }) => {
    await open(page)
    for (const l of 'ABC') await freeze(page, l)
    await ui(page).locator('.chip', { hasText: 'B' }).locator('i').click()
    await expect(ui(page).locator('.chip')).toHaveText(['A×', 'C×'])
    await freeze(page, 'D')
  })

  test('prev/next cycle the active snapshot', async ({ page }) => {
    await open(page)
    for (const l of 'AB') await freeze(page, l)
    await page.keyboard.press('Alt+Shift+BracketLeft')
    await expect(ui(page).locator('.chip.on')).toHaveText('A×')
    await page.keyboard.press('Alt+Shift+BracketRight')
    await expect(ui(page).locator('.chip.on')).toHaveText('B×')
  })
})

test.describe('compare modes (R4)', () => {
  const top = { x: 0, y: 0, width: 1000, height: 600 } // clear of the toolbar and Next dev badge

  test('difference with no change is near-black', async ({ page }) => {
    await open(page)
    await freeze(page, 'A')
    await setMode(page, 'difference')
    await expect.poll(() => darkRatio(page, top)).toBeGreaterThan(0.99)
  })

  test('difference lights up only what changed', async ({ page }) => {
    await open(page)
    await freeze(page, 'A')
    await editCss(page, `background: ${RED};`)
    await setMode(page, 'difference')
    const box = (await page.getByTestId('heading').boundingBox())!
    await expect.poll(() => darkRatio(page, { x: box.x, y: box.y, width: box.width, height: box.height })).toBeLessThan(0.1)
    await expect.poll(() => darkRatio(page, { x: 0, y: box.y + box.height + 10, width: 1000, height: 300 })).toBeGreaterThan(0.99)
  })

  test('slider at 30% shows live left of the seam, frozen right', async ({ page }) => {
    await open(page)
    await freeze(page, 'A')
    await editCss(page, `background: ${RED};`)
    await setMode(page, 'slider', 30)
    const box = (await page.getByTestId('heading').boundingBox())!
    const y = Math.round(box.y + box.height / 2)
    await expect.poll(async () => isRed(await pixel(page, 200, y))).toBe(true)
    await expect.poll(async () => isRed(await pixel(page, 700, y))).toBe(false)
  })

  test('onion at 0 is live, at 100 is frozen', async ({ page }) => {
    await open(page)
    await freeze(page, 'A')
    await editCss(page, `background: ${RED};`)
    const box = (await page.getByTestId('heading').boundingBox())!
    const y = Math.round(box.y + box.height / 2)
    await setMode(page, 'onion', 0)
    await expect.poll(async () => isRed(await pixel(page, 700, y))).toBe(true)
    await setMode(page, 'onion', 100)
    await expect.poll(async () => isRed(await pixel(page, 700, y))).toBe(false)
  })

  test('frozen frame follows page scroll', async ({ page }) => {
    await open(page)
    await freeze(page, 'A')
    await setMode(page, 'onion', 50)
    await page.mouse.wheel(0, 800)
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(800)
    await expect.poll(() => frozenY(page)).toBeGreaterThanOrEqual(799)
    expect(await frozenY(page)).toBeLessThanOrEqual(801)
  })

  test('frozen page shorter than live clamps without errors', async ({ page }) => {
    await open(page)
    await freeze(page, 'A')
    await editCss(page, 'margin-bottom: 3000px;')
    await setMode(page, 'onion', 50)
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    const [live, frz] = await Promise.all([
      page.evaluate(() => scrollY),
      frozenY(page),
    ])
    expect(frz).toBeLessThan(live)
  })

  test('split: right pane hot-reloads, left stays frozen, scroll linked', async ({ page }) => {
    await open(page)
    await freeze(page, 'A')
    await setMode(page, 'split')
    const livePane = page.frameLocator('yoyo-root iframe.live')
    await expect(livePane.getByTestId('heading')).toBeVisible({ timeout: 20_000 })
    // the iframe copy must not boot its own yoyo (KTD9)
    await expect(livePane.locator('yoyo-root')).toHaveCount(0)
    await editCss(page, '')
    await expect(livePane.getByTestId('heading')).toHaveCSS('color', RED)
    await expect(frozen(page).getByTestId('heading')).toHaveCSS('color', BLUE)
    // scroll link attaches on the pane's load event
    await expect
      .poll(() => ui(page).locator('iframe.live').evaluate((f: HTMLIFrameElement) => f.contentDocument!.readyState))
      .toBe('complete')
    await livePane.locator('html').evaluate(() => scrollTo(0, 400))
    await expect
      .poll(() => frozenY(page))
      .toBe(400)
  })
})

test.describe('production (R6)', () => {
  test.skip(!!process.env.BUNDLER, 'prod check runs once')
  test.setTimeout(240_000)

  test('next build ships no yoyo code and no toolbar', async ({ page }) => {
    const distDir = '.next-prod-check'
    const env = { ...process.env, NEXT_DIST_DIR: distDir }
    execSync(`"${process.execPath}" ${NEXT} build`, { cwd: APP, env, stdio: 'ignore' })
    expect(fs.readdirSync(path.join(APP, distDir, 'static/chunks')).length).toBeGreaterThan(0)
    const chunks = execSync(`grep -rlE "yoyo-root|__yoyo" ${distDir}/static || true`, { cwd: APP }).toString()
    expect(chunks).toBe('')
    // spawn node directly: killing a pnpm wrapper leaves next start holding the port
    const server = spawn(process.execPath, [NEXT, 'start', '-p', '3199'], { cwd: APP, env })
    try {
      await expect(async () => {
        await page.goto('http://localhost:3199/')
      }).toPass({ timeout: 30_000 })
      await page.waitForTimeout(500)
      await expect(page.locator('yoyo-root')).toHaveCount(0)
    } finally {
      server.kill()
      fs.rmSync(path.join(APP, distDir), { recursive: true, force: true })
    }
  })
})
