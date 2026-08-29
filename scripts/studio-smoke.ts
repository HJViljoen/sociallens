// Dev-only check for the Report Studio (Reports & Exports Stage 2, T4).
//   node --env-file=.env.local --import tsx scripts/studio-smoke.ts --out scratch/studio
// Signs in as the demo account, starts a report from the Leadership starter,
// edits it in the Studio (untick a tile, framing line), adds Competitive with a
// selection from that page's Export menu, builds the PDF, and screenshots each
// step. Creates real rows for the demo tenant — a report, a snapshot, an
// artifact — which it deletes at the end unless --keep.

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { withBrowser } from '../lib/render/chromium'
import { createAdminClient } from '../lib/supabase-admin'

const args = process.argv.slice(2)
const flag = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt }
const has = (name: string) => args.includes(`--${name}`)
const out = flag('out', 'scratch/studio')
const base = flag('base', process.env.RENDER_BASE_URL ?? 'http://localhost:3000')
const email = process.env.SHOT_EMAIL ?? 'demo@verbatimintel.com'
const password = process.env.SHOT_PASSWORD ?? process.env.DEMO_PASSWORD ?? ''

async function cleanup(reportId: string) {
  const admin = createAdminClient()
  const { data: snaps } = await admin.from('report_snapshots').select('id').eq('report_id', reportId)
  for (const s of (snaps ?? []) as { id: string }[]) {
    const { data: arts } = await admin.from('artifacts').select('storage_path').eq('snapshot_id', s.id)
    const paths = ((arts ?? []) as { storage_path: string }[]).map((a) => a.storage_path)
    if (paths.length) await admin.storage.from('artifacts').remove(paths)
    await admin.from('report_snapshots').delete().eq('id', s.id)
  }
  await admin.from('reports').delete().eq('id', reportId)
  await admin.from('report_templates').delete().eq('name', 'Smoke template')
  console.log(`cleaned up ${reportId}`)
}

async function main() {
  if (flag('cleanup', '')) return cleanup(flag('cleanup', ''))
  if (!password) throw new Error('SHOT_PASSWORD or DEMO_PASSWORD is required')
  mkdirSync(out, { recursive: true })
  let reportId = ''
  await withBrowser(async (page) => {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    const shot = async (name: string) => writeFileSync(join(out, `${name}.png`), await page.screenshot({ type: 'png' }))
    await page.goto(`${base}/login`, { waitUntil: 'networkidle0' })
    await page.type('input[type="email"]', email)
    await page.type('input[type="password"]', password)
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.keyboard.press('Enter')])

    // 1. New report from the Leadership starter → lands in the Studio.
    await page.goto(`${base}/dashboard/reports/new`, { waitUntil: 'networkidle0' })
    await shot('1-new')
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 90_000 }),
      page.click('button[name="template"][value="leadership_one_pager"]'),
    ])
    reportId = page.url().split('/studio/')[1]?.split('?')[0] ?? ''
    if (!reportId) throw new Error(`not in the Studio: ${page.url()}`)
    // The Studio streams in behind its loading skeleton (loaders + preview).
    const outlineReady = () => page.waitForSelector('fieldset input[type="checkbox"]', { timeout: 120_000 })
    await outlineReady()
    await page.evaluate(() => document.fonts.ready)
    await shot('2-studio')

    // 2. Untick a tile, add a framing line; the preview refreshes.
    const boxes = await page.$$('fieldset input[type="checkbox"]')
    if (!boxes.length) throw new Error('no tile checkboxes in the outline')
    await boxes[boxes.length - 1].click()
    await page.waitForFunction(() => !document.body.innerText.includes('Saving…'), { timeout: 60_000 })
    await page.type('input[placeholder^="Why this section"]', 'For the Monday leadership call — where we stand and the one thing to decide.')
    await page.keyboard.press('Tab')
    await page.waitForFunction(() => !document.body.innerText.includes('Saving…'), { timeout: 60_000 })
    await new Promise((r) => setTimeout(r, 1500))
    await shot('3-edited')

    // 2b. Save the arrangement as a template; the picker lists it.
    const [tplBtn] = await page.$$('xpath/.//button[contains(., "as a template")]')
    if (!tplBtn) throw new Error('no "Save as template" control')
    await tplBtn.click()
    await page.type('input[placeholder="Template name"]', 'Smoke template')
    const [tplSave] = await page.$$('xpath/.//button[text()="Save"]')
    await tplSave!.click()
    await page.waitForFunction(() => document.body.innerText.includes('Saved as a template'), { timeout: 30_000 })
    await page.goto(`${base}/dashboard/reports/new`, { waitUntil: 'networkidle0' })
    const listed = await page.evaluate(() => document.body.innerText.includes('Smoke template'))
    console.log(`template listed in the picker: ${listed}`)
    await page.goto(`${base}/dashboard/reports/studio/${reportId}`, { waitUntil: 'networkidle0' })
    await outlineReady()

    // 3. Add Competitive with a selection from its Export menu.
    await page.goto(`${base}/dashboard/competitive`, { waitUntil: 'networkidle0' })
    const vs = await page.evaluate(() => { const a = document.querySelector('a[href*="vs="]') as HTMLAnchorElement | null; return a?.href ?? null })
    if (vs) await page.goto(vs, { waitUntil: 'networkidle0' })
    const exportBtn = await page.$('button[data-print-hide][aria-haspopup="dialog"]')
    if (!exportBtn) throw new Error('no page Export button')
    await exportBtn.click()
    await page.waitForSelector('[role="dialog"][aria-label="Export"]')
    await shot('4-export-menu')
    const [addBtn] = await page.$$('xpath/.//div[@role="dialog"]//button[contains(., "Add to a report")]')
    if (!addBtn) throw new Error('no "Add to a report…" item')
    await addBtn.click()
    await page.waitForFunction(() => document.body.innerText.includes('New report from this page'), { timeout: 30_000 })
    const [draftBtn] = await page.$$('xpath/.//div[@role="dialog"]//button[contains(., "Leadership one-pager")]')
    if (!draftBtn) throw new Error('the draft is not offered')
    await draftBtn.click()
    await page.waitForFunction(() => document.body.innerText.includes('Added to'), { timeout: 30_000 })
    await shot('5-added')

    // 4. Back in the Studio: three-section deck; build the PDF.
    await page.goto(`${base}/dashboard/reports/studio/${reportId}`, { waitUntil: 'networkidle0' })
    await outlineReady()
    await page.evaluate(() => document.fonts.ready)
    await shot('6-studio-3-sections')
    const [buildBtn] = await page.$$('xpath/.//button[contains(., "Build PDF")]')
    if (!buildBtn) throw new Error('no Build PDF button')
    // The signed-URL download would navigate the tab away from the app; abort
    // that one request so the page (and its "downloading" line) stays.
    await page.setRequestInterception(true)
    page.on('request', (r) => (r.url().includes('/storage/v1/object/sign/') ? r.abort() : r.continue()))
    await buildBtn.click()
    await page.waitForFunction(() => /downloading|Couldn/.test(document.body.innerText), { timeout: 240_000 })
    await shot('7-built')
    const line = await page.evaluate(() => (document.body.innerText.includes('Your PDF is downloading') ? 'Your PDF is downloading' : document.body.innerText.match(/Couldn[^\n]*/)?.[0] ?? '(no result line)'))
    console.log(`build: ${line}`)

    // 5. The Reports page lists it with its build.
    await page.goto(`${base}/dashboard/reports?item=${reportId}`, { waitUntil: 'networkidle0' })
    await shot('8-reports')
    const detail = await page.evaluate(() => document.body.innerText.match(/built [^\n]*/)?.[0] ?? '(no build listed)')
    console.log(`reports page: ${detail}`)
  })
  console.log(`report ${reportId}${has('keep') ? ' (kept)' : ''} → ${out}/`)
  if (!has('keep') && reportId) await cleanup(reportId)
}

main().catch((e) => { console.error(e); process.exit(1) })
