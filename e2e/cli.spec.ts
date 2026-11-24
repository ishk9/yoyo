// The browser here stands in for the user's own browser: the CLI never opens one, it drives this tab.
import { chromium, expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const CLI = path.resolve('packages/yoyo/dist/cli.js')
const CSS = path.resolve('examples/next-app/app/page.module.css')
const ORIGINAL = fs.readFileSync(CSS, 'utf8')
const PAGE = path.resolve('examples/next-app/app/page.tsx')
const PAGE_ORIGINAL = fs.readFileSync(PAGE, 'utf8')
const run = promisify(execFile)

// Every command names the test server's tab, so a yoyo tab in your own browser never receives test commands.
const HOST = 'localhost:3100'
const pin = (args: string[]) => (['open', 'stop'].includes(args[0]) || args.includes('--url') ? args : [...args, '--url', HOST])

async function yoyo(...args: string[]) {
  const { stdout } = await run('node', [CLI, ...pin(args)], { env: { ...process.env, YOYO_BROWSER: chromium.executablePath() } })
  return JSON.parse(stdout)
}
async function yoyoFails(...args: string[]) {
  const err = await run('node', [CLI, ...pin(args)]).then(() => null, (e) => e)
  expect(err?.code).toBe(1)
  return JSON.parse(err.stderr).error as string
}

test.afterEach(async () => {
  fs.writeFileSync(CSS, ORIGINAL)
  fs.writeFileSync(PAGE, PAGE_ORIGINAL)
  await run('node', [CLI, 'stop']).catch(() => {}) // each test starts with a fresh relay
})

test('cli drives the open tab: freeze, edit, compare, off', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('yoyo-root')).toBeAttached()

  const frozen = await yoyo('freeze', '--name', 'base')
  expect(frozen).toEqual({ frozen: 'base', route: '/' })
  // the tab itself shows the new snapshot
  await expect(page.locator('yoyo-root .chip.on')).toHaveText('base×')

  const unchanged = await yoyo('compare')
  expect(unchanged).toMatchObject({ against: 'base', same: true, total: 0, changes: [] })

  fs.writeFileSync(CSS, ORIGINAL.replace('color: rgb(37, 99, 235);', 'color: rgb(220, 38, 38);'))
  await expect(page.getByTestId('heading')).toHaveCSS('color', 'rgb(220, 38, 38)', { timeout: 20_000 })
  await page.waitForLoadState('load') // webpack may full-reload on CSS Module edits

  const changed = await yoyo('compare', '--against', 'base', '--mode', 'split')
  expect(changed).toMatchObject({ against: 'base', mode: 'split', same: false })
  expect(changed.changes).toContainEqual(
    expect.objectContaining({ prop: 'color', before: 'rgb(37, 99, 235)', after: 'rgb(220, 38, 38)' }),
  )
  expect(changed.changes.every((c: { el: string }) => c.el.includes('heading'))).toBe(true)
  // compare is on, in split mode, in the user's tab
  await expect(page.locator('yoyo-root .stage')).toHaveAttribute('data-mode', 'split')

  expect(await yoyo('list')).toMatchObject({ route: '/', active: 'base', snapshots: [{ label: 'base' }] })
  expect(await yoyo('status')).toMatchObject({ tabs: [{ url: expect.stringContaining('localhost') }] })
  await yoyo('off')
  await expect(page.locator('yoyo-root .stage')).toHaveAttribute('data-mode', 'off')

  expect(await yoyoFails('compare', '--against', 'nope')).toContain('no snapshot "nope"')
  expect(await yoyoFails('compare', '--mode', 'onion')).toContain('--mode must be one of')
  expect(await yoyoFails('freeze', '--url', 'no-such-tab')).toContain('no browser tab with "no-such-tab"')
})

test('a Tailwind class edit reads as a class + style change; reverting it reads as same', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('yoyo-root')).toBeAttached()
  await yoyo('freeze', '--name', 'base')
  const p = page.locator('main > p').first()
  const zinc = await p.evaluate((el) => getComputedStyle(el).color)

  fs.writeFileSync(PAGE, PAGE_ORIGINAL.replace('text-zinc-500 dark:text-zinc-400', 'text-blue-600'))
  // the class lands before Tailwind's CSS for it; wait for the colour itself
  await expect(p).not.toHaveCSS('color', zinc, { timeout: 20_000 })
  const edited = await yoyo('compare', '--against', 'base')
  expect(edited.same).toBe(false)
  expect(edited.changes).toContainEqual(expect.objectContaining({ prop: 'class', before: 'text-zinc-500 dark:text-zinc-400', after: 'text-blue-600' }))
  expect(edited.changes).toContainEqual(expect.objectContaining({ prop: 'color' }))
  // exactly the edit: no added/removed pair, no inherited or border-colour echoes
  expect(edited.changes.map((c: { prop: string }) => c.prop)).toEqual(['class', 'color'])

  // Tailwind keeps the generated text-blue-600 rule after the revert, so the HTML still differs
  fs.writeFileSync(PAGE, PAGE_ORIGINAL)
  await expect(p).toHaveCSS('color', zinc, { timeout: 20_000 })
  const reverted = await yoyo('compare', '--against', 'base')
  expect(reverted).toMatchObject({ same: true, total: 0, changes: [] })
})

test('a leftover URL argument explains what changed', async () => {
  const err = await yoyoFails('freeze', 'http://localhost:3000/')
  expect(err).toContain('takes no URL')
  expect(err).toContain('--url')
  expect(err).toContain('yoyo open http://localhost:3000/')
})

test('open --headless: no browser of your own, same commands', async ({ baseURL }) => {
  const opened = await yoyo('open', `${baseURL}/`, '--headless')
  expect(opened).toMatchObject({ opened: `${baseURL}/`, headless: true })
  expect(await yoyo('status')).toMatchObject({ headless: true, tabs: [{ url: `${baseURL}/` }] })

  await yoyo('freeze', '--name', 'hl')
  fs.writeFileSync(CSS, ORIGINAL.replace('color: rgb(37, 99, 235);', 'color: rgb(220, 38, 38);'))
  await expect
    .poll(async () => (await yoyo('compare', '--against', 'hl')).same, { timeout: 20_000 })
    .toBe(false)
  const res = await yoyo('compare', '--against', 'hl')
  expect(res.changes).toContainEqual(expect.objectContaining({ prop: 'color', after: 'rgb(220, 38, 38)' }))

  await yoyo('stop')
  // stopping the relay closes the headless browser too
  await expect
    .poll(async () => (await run('pgrep', ['-f', 'headless=new.*user-data-dir=[^ ]*yoyo-headless-']).catch(() => ({ stdout: '' }))).stdout.trim())
    .toBe('')
})
