import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CLI = path.resolve('packages/yoyo/dist/cli.js')
const CSS = path.resolve('examples/next-app/app/page.module.css')
const ORIGINAL = fs.readFileSync(CSS, 'utf8')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoyo-cli-'))

const yoyo = (...args: string[]) =>
  JSON.parse(execFileSync('node', [CLI, ...args, '--dir', dir], { encoding: 'utf8' }))

test.afterEach(() => fs.writeFileSync(CSS, ORIGINAL))

test('cli: freeze, edit, compare', async ({ page, baseURL }) => {
  const url = `${baseURL}/`
  expect(yoyo('freeze', url)).toMatchObject({ frozen: 'A', route: '/' })
  expect(yoyo('compare', url)).toMatchObject({ against: 'A', same: true, changedPixels: 0 })

  fs.writeFileSync(CSS, ORIGINAL.replace('color: rgb(37, 99, 235);', 'color: rgb(220, 38, 38);'))
  await page.goto(url)
  await expect(page.getByTestId('heading')).toHaveCSS('color', 'rgb(220, 38, 38)', { timeout: 20_000 })

  const res = yoyo('compare', url, '--against', 'A')
  expect(res).toMatchObject({ same: false })
  expect(res.changedPixels).toBeGreaterThan(0)
  expect(fs.existsSync(res.image)).toBe(true)
  expect(yoyo('list', url).snapshots.map((s: { label: string }) => s.label)).toEqual(['A'])
})
