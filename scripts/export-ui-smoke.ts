// Drive the export-in-place controls in a real browser: hover a tile, open its
// menu, screenshot it; open the page-bar menu; run one tile export through the
// UI and confirm the "downloading" state. Dev-only check for T10.
//   node --env-file=.env.local --import tsx scripts/export-ui-smoke.ts --out scratch/ui

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { withBrowser } from '../lib/render/chromium'

const args = process.argv.slice(2)
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const out = flag('out', 'scratch/ui')
const base = flag('base', process.env.RENDER_BASE_URL ?? 'http://localhost:3000')
const email = process.env.SHOT_EMAIL ?? 'demo@verbatimintel.com'
const password = process.env.SHOT_PASSWORD ?? process.env.DEMO_PASSWORD ?? ''

async function main() {
  mkdirSync(out, { recursive: true })
  await withBrowser(async (page) => {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await page.goto(`${base}/login`, { waitUntil: 'networkidle0' })
    await page.type('input[name="email"]', email)
    await page.type('input[name="password"]', password)
    await page.click('button[type="submit"]')
    await page.waitForFunction(() => location.pathname.startsWith('/dashboard'), { timeout: 60000 })
    await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle0' })

    // 1. Hover the sentiment tile → the control appears; click it → menu.
    const tile = await page.$('[data-tile][data-col="5"][data-row="1"]')
    if (!tile) throw new Error('no sentiment tile')
    await tile.hover()
    await new Promise((r) => setTimeout(r, 200))
    writeFileSync(join(out, '1-hover.png'), await tile.screenshot({ type: 'png' }))
    await page.click('[data-tile][data-col="5"][data-row="1"] button[aria-label="Export this tile"]')
    await page.waitForSelector('[role="dialog"][aria-label="Export"]')
    writeFileSync(join(out, '2-tile-menu.png'), await page.screenshot({ type: 'png', clip: { x: 900, y: 180, width: 540, height: 260 } }))
    await page.keyboard.press('Escape')

    // 2. Page-bar menu.
    await page.click('header ~ * button[aria-haspopup="dialog"], button:has(svg) >> nth=0').catch(() => null)
    const bar = await page.$('xpath/.//button[contains(., "Export")]')
    if (!bar) throw new Error('no page Export button')
    await bar.click()
    await page.waitForSelector('[role="dialog"][aria-label="Export"]')
    writeFileSync(join(out, '3-page-menu.png'), await page.screenshot({ type: 'png', clip: { x: 900, y: 20, width: 540, height: 420 } }))

    // 3. Run "This page" through the UI and wait for the done state.
    const item = await page.$('xpath/.//div[@role="dialog"]//button[contains(., "This page")]')
    if (!item) throw new Error('no "This page" item')
    await item.click()
    await page.waitForFunction(() => /downloading|Couldn/.test(document.querySelector('[role="dialog"]')?.textContent ?? ''), { timeout: 120000 })
    const text = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '')
    writeFileSync(join(out, '4-done.png'), await page.screenshot({ type: 'png', clip: { x: 900, y: 20, width: 540, height: 160 } }))
    console.log(`dialog: ${text.trim()}`)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
