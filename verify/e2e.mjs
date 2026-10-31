/**
 * Real-browser check plus the storefront screenshots.
 *
 * Drives an already-running `dsh web` that has this plugin installed, over the
 * browser-trust token the launcher prints. It checks the three things a bundle
 * can silently get wrong — the client bundle loads, the `@`-less mouse path
 * appends to the draft instead of replacing it, and the panel lists the shared
 * library and the project library — then writes the screenshots the plugin
 * catalog shows.
 *
 * Usage:
 *   DSH_WEB_URL="http://127.0.0.1:PORT/?token=…" node verify/e2e.mjs
 *   CHROME_PATH=/path/to/chrome node verify/e2e.mjs
 *
 * Screenshots land in assets/; pass SHOTS_DIR to write them elsewhere.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const PKG = join(here, '..')
const SHOTS = process.env.SHOTS_DIR ?? join(PKG, 'assets')

/** The URL the launcher printed, or the one the caller supplied. */
function resolveUrl() {
  if (process.env.DSH_WEB_URL) return process.env.DSH_WEB_URL
  throw new Error('set DSH_WEB_URL to the http://…/?token=… URL printed by `dsh web`')
}

/** The system Chrome, unless CHROME_PATH names another binary. */
function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
  for (const candidate of candidates) {
    try {
      execFileSync('test', ['-x', candidate])
      return candidate
    } catch { /* try the next one */ }
  }
  throw new Error('no Chrome found — set CHROME_PATH to a Chromium-based browser')
}

const failures = []
const notes = []
/** @param condition - the assertion. @param message - what was asserted. */
function check(condition, message) {
  if (condition) notes.push('ok: ' + message)
  else failures.push(message)
}

const browser = await chromium.launch({ executablePath: resolveChrome(), headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', deviceScaleFactor: 2 })
const pageErrors = []
page.on('pageerror', error => pageErrors.push('pageerror: ' + error.message))
page.on('console', message => { if (message.type() === 'error') pageErrors.push('console: ' + message.text()) })

try {
  await page.goto(resolveUrl(), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  // First-run dialogs: the provider setup sheet, then the preview notice. They
  // arrive asynchronously, so keep dismissing until the composer is usable.
  const trigger = page.getByRole('button', { name: '常用提示词' })

  /** Dismiss whatever first-run sheet is up until the composer is usable. */
  async function settle() {
    for (let attempt = 0; attempt < 20; attempt++) {
      for (const name of ['稍后配置', '继续', '我知道了']) {
        const button = page.getByRole('button', { name, exact: true })
        if (await button.count()) {
          await button.first().click({ timeout: 2000 }).catch(() => {})
          await page.waitForTimeout(400)
        }
      }
      if (await trigger.count()) return true
      await page.waitForTimeout(400)
    }
    return false
  }

  /** Open the panel and wait for its list. */
  async function openPanel() {
    const opened = await settle()
    if (!opened) return false
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await trigger.first().click({ timeout: 2000 })
      } catch { /* the mask may still be animating out */ }
      await page.waitForTimeout(700)
      if ((await page.locator('body').innerText()).includes('全部分组')) return true
    }
    return false
  }

  check(await settle(), 'the composer tool row carries the 常用提示词 button')

  // Append, not replace: type a half-written request first.
  const editor = page.locator('[contenteditable="true"]').first()
  await editor.click()
  await page.keyboard.type('帮我评审这份需求')
  await page.waitForTimeout(300)
  const draftBefore = await editor.innerText()

  check(await openPanel(), 'clicking the button opens the panel')
  const firstOpen = await page.locator('body').innerText()

  check(firstOpen.includes('我的工作背景'), 'the shared library lists its entries')
  check(firstOpen.includes('这个项目的技术栈'), 'the project library lists its entries')
  check(firstOpen.includes('全部分组'), 'the group filter is offered')
  check((await page.getByRole('button', { name: '新建一条' }).count()) === 1, 'the create button is offered')

  const entry = page.locator('.qp-row', { hasText: '我的工作背景' }).first()
  // The modal is mid-animation right after opening; the row's keyboard path is
  // both more stable here and the path a keyboard user takes.
  await entry.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  const draftAfter = await editor.innerText()
  check(draftAfter.includes('帮我评审这份需求'), 'inserting keeps the text already in the draft')
  check(draftAfter.includes('我负责把模糊需求拆成可落地的结构'), 'inserting appends the prompt body')

  // The storefront shots: the composer row, then the open panel.
  mkdirSync(SHOTS, { recursive: true })
  const editorBox = await editor.boundingBox()
  if (editorBox !== null) {
    const clip = {
      x: Math.max(0, editorBox.x - 260),
      y: Math.max(0, editorBox.y - 40),
      width: Math.min(1440, editorBox.width + 520),
      height: Math.min(900, editorBox.height + 120),
    }
    await page.screenshot({ path: join(SHOTS, 'screenshot-1-composer.png'), clip })
  }

  await openPanel()
  await page.screenshot({ path: join(SHOTS, 'screenshot-2-panel.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  check(pageErrors.length === 0, 'no page errors while driving the panel')
  for (const error of pageErrors) notes.push('page error: ' + error)
} finally {
  await browser.close()
}

for (const note of notes) console.log(note)
if (failures.length === 0) {
  console.log('\ne2e: OK (' + notes.length + ' checks passed)')
  process.exit(0)
}
console.error('\ne2e: ' + failures.length + ' failure(s)')
for (const failure of failures) console.error('  ✗ ' + failure)
process.exit(1)
