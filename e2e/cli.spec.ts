// The browser here stands in for the user's own browser: the CLI never opens one, it drives this tab.
import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const CLI = path.resolve('packages/yoyo/dist/cli.js')
const CSS = path.resolve('examples/next-app/app/page.module.css')
const ORIGINAL = fs.readFileSync(CSS, 'utf8')
const run = promisify(execFile)

async function yoyo(...args: string[]) {
  const { stdout } = await run('node', [CLI, ...args])
  return JSON.parse(stdout)
}
async function yoyoFails(...args: string[]) {
  const err = await run('node', [CLI, ...args]).then(() => null, (e) => e)
  expect(err?.code).toBe(1)
  return JSON.parse(err.stderr).error as string
}

test.afterEach(() => fs.writeFileSync(CSS, ORIGINAL))
test.afterAll(() => run('node', [CLI, 'stop']).catch(() => {}))

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
