// Dev-only check for the Studio page (Reports & Exports Stage 3, reshaped 2026-08-30).
//   node --env-file=.env.local --import tsx scripts/studio-smoke.ts --out scratch/studio [--base http://localhost:3000] [--keep]
// Signs in as the demo account and walks: Studio (reports down the left, the
// picked one on the right) · New report → a template → the editor (free-text
// "written for", Build PDF) · back in the Studio: Edit, builds, share · the
// report's sending (save a list, Send me a test, Preview the email) · Reports
// (Sent · Built) · Settings/Team copy · no export chrome on any dashboard
// page · no em dash in any of that copy. Creates real rows for the demo
// tenant, which it deletes at the end unless --keep.

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Page } from 'puppeteer-core'
import { withBrowser } from '../lib/render/chromium'
import { createAdminClient } from '../lib/supabase-admin'

const args = process.argv.slice(2)
const flag = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt }
const has = (name: string) => args.includes(`--${name}`)
const out = flag('out', 'scratch/studio')
const base = flag('base', process.env.RENDER_BASE_URL ?? 'http://localhost:3000')
const email = process.env.SHOT_EMAIL ?? 'demo@verbatimintel.com'
const password = process.env.SHOT_PASSWORD ?? process.env.DEMO_PASSWORD ?? ''
const DEMO = 'de300055-0000-4000-8000-000000000001'

const checks: { name: string; ok: boolean; note?: string }[] = []
const check = (name: string, ok: boolean, note?: string) => { checks.push({ name, ok, note }); console.log(`${ok ? '✓' : '✗'} ${name}${note ? ` (${note})` : ''}`) }
const text = (page: Page) => page.evaluate(() => document.body.innerText)
const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms))

async function cleanup(since: string, reportId: string | null) {
  const admin = createAdminClient()
  const { data: snaps } = await admin.from('report_snapshots').select('id').eq('client_id', DEMO).gte('created_at', since)
  for (const s of (snaps ?? []) as { id: string }[]) {
    const { data: arts } = await admin.from('artifacts').select('storage_path').eq('snapshot_id', s.id)
    const paths = ((arts ?? []) as { storage_path: string }[]).map((a) => a.storage_path)
    if (paths.length) await admin.storage.from('artifacts').remove(paths)
    await admin.from('report_snapshots').delete().eq('id', s.id)
  }
  if (reportId) {
    await admin.from('report_schedules').delete().eq('report_id', reportId).eq('client_id', DEMO)
    await admin.from('reports').delete().eq('id', reportId).eq('client_id', DEMO)
  }
  await admin.from('report_sends').delete().eq('client_id', DEMO).gte('claimed_at', since)
  console.log(`cleaned up rows since ${since}${reportId ? ` and report ${reportId}` : ''}`)
}

async function main() {
  if (!password) throw new Error('SHOT_PASSWORD or DEMO_PASSWORD is required')
  mkdirSync(out, { recursive: true })
  const since = new Date().toISOString()
  let reportId: string | null = null

  try {
    await withBrowser(async (page) => {
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
      const shot = async (name: string) => writeFileSync(join(out, `${name}.png`), await page.screenshot({ type: 'png' }))
      const goto = (path: string) => page.goto(`${base}${path}`, { waitUntil: 'networkidle0', timeout: 120_000 })
      // The demo tenant is named "Össur — Demo", and its seeded pre-Stage-3 subjects carry the old
      // dash: both are data, not our copy.
      const noDash = (label: string, raw: string) => { const t = raw.replace(/Össur — Demo/gi, '').replace(/ÖSSUR — DEMO/g, '').replace(/^\s*— .*$/gm, ''); check(`no em dash: ${label}`, !t.includes('—'), t.includes('—') ? t.split('\n').find((l) => l.includes('—'))?.slice(0, 80) : undefined) }
      await goto('/login')
      await page.type('input[type="email"]', email)
      await page.type('input[type="password"]', password)
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.keyboard.press('Enter')])

      // 1. The Studio: reports left, the picked one right
      await goto('/dashboard/studio')
      await shot('1-studio')
      const t1 = await text(page)
      check('sidebar has Studio', await page.$('a[href="/dashboard/studio"]') != null)
      check('Weekly digest listed with Edit and sending on the right', t1.includes('Weekly digest') && t1.includes('Edit') && /Sending/i.test(t1))
      check('no rail of groups on the Studio', !t1.includes('Who gets what') && !t1.includes('All templates'))
      noDash('studio', t1)

      // 2. New report → template → the editor
      await goto('/dashboard/studio/new')
      const t2 = await text(page)
      check('New report offers the templates and Custom', ['Weekly digest', 'Leadership one-pager', 'Custom'].every((n) => t2.includes(n)))
      noDash('new report', t2)
      const [useBtn] = await page.$$('xpath/.//button[@name="template"][@value="leadership_one_pager"]')
      if (!useBtn) throw new Error('no template button')
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120_000 }), useBtn.click()])
      reportId = page.url().split('/studio/edit/')[1]?.split('?')[0] ?? null
      check('a template lands in the editor', Boolean(reportId), page.url())
      await page.waitForSelector('fieldset input[type="checkbox"]', { timeout: 120_000 })
      await page.evaluate(() => document.fonts.ready)
      await shot('2-editor')
      const t2b = await text(page)
      check('preview header is just Preview', !t2b.includes('as it prints'))
      noDash('editor', t2b)
      const who = await page.$('input[list="written-for-suggestions"]')
      if (!who) throw new Error('no written-for input')
      await who.evaluate((el) => (el as HTMLInputElement).select())
      await who.type('The Nordic sales team')
      await page.keyboard.press('Tab')
      await page.waitForFunction(() => !document.body.innerText.includes('Saving…'), { timeout: 60_000 })
      await settle(1500)
      const [buildBtn] = await page.$$('xpath/.//button[contains(., "Build PDF")]')
      if (!buildBtn) throw new Error('no Build PDF button')
      await page.setRequestInterception(true)
      const abortDownload = (r: import('puppeteer-core').HTTPRequest) => { if (r.url().includes('/storage/v1/object/sign/')) r.abort().catch(() => null); else r.continue().catch(() => null) }
      page.on('request', abortDownload)
      await buildBtn.click()
      const built = await page.waitForFunction(() => { const m = document.body.innerText.match(/(Your PDF is downloading|Couldn[^\n]*)/); return m ? m[0] : false }, { timeout: 240_000 })
        .then((h) => h.jsonValue() as Promise<string>).catch(() => '')
      await page.waitForNetworkIdle({ timeout: 30_000 }).catch(() => null)
      await settle(1500)
      check('Build PDF from the editor', built === 'Your PDF is downloading', built)
      page.off('request', abortDownload)
      await page.setRequestInterception(false)

      // 3. Back in the Studio: the report on the right, written for the typed reader
      await goto(`/dashboard/studio?item=${reportId}`)
      await shot('3-report')
      const t3 = await text(page)
      check('the report shows the typed reader', /written for the nordic sales team/i.test(t3))
      check('the report shows its build and share controls', /download pdf/i.test(t3) && /\bshare\b/i.test(t3))
      noDash('report detail', t3)

      // 4. Sending: a list, saved; test send; preview
      const to = await page.$('textarea')
      if (!to) throw new Error('no recipients textarea')
      await to.type('smoke-one@example.com, smoke-two@example.com')
      const [startBtn] = await page.$$('xpath/.//button[normalize-space()="Start sending"]')
      if (!startBtn) throw new Error('no Start sending button')
      await startBtn.click()
      await page.waitForFunction(() => /Saved|Could not|not an email/.test(document.body.innerText), { timeout: 60_000 })
      // Saved, then the route refreshes: the header's "2 people" lands a moment later.
      await page.waitForFunction(() => /2 people|Could not|not an email/.test(document.body.innerText), { timeout: 30_000 }).catch(() => null)
      const t4 = await text(page)
      check('sending saved with two addresses', t4.includes('2 people') && !/Could not|not an email/.test(t4), t4.match(/Saved|Could not[^\n]*/)?.[0])
      await shot('4-sending')
      const [testBtn] = await page.$$('xpath/.//button[contains(., "Send me a test")]')
      if (!testBtn) throw new Error('no Send me a test button')
      await testBtn.click()
      await page.waitForFunction(() => document.body.innerText.includes('Sending…'), { timeout: 30_000 })
      await page.waitForFunction(() => !document.body.innerText.includes('Sending…'), { timeout: 240_000 })
      const t5 = await text(page)
      check('Send me a test ran the runner', /Sent to|provider not configured/.test(t5), t5.match(/(Sent to|email not sent)[^\n]*/)?.[0])
      const [prevBtn] = await page.$$('xpath/.//button[contains(., "Preview the email")]')
      if (!prevBtn) throw new Error('no Preview button')
      await prevBtn.click()
      await page.waitForSelector('iframe[title="Email preview"]', { timeout: 30_000 })
      const frame = await (await page.$('iframe[title="Email preview"]'))!.contentFrame()
      await frame!.waitForFunction(() => document.body && document.body.innerText.length > 200, { timeout: 120_000 })
      const previewText = await frame!.evaluate(() => document.body.innerText)
      check('email preview renders the digest', /in short|where you stand/i.test(previewText), previewText.slice(0, 80).replace(/\n/g, ' '))
      noDash('email preview', previewText)
      await shot('5-preview')

      // 5. Reports: Sent · Built
      await goto('/dashboard/reports')
      const t6 = await text(page)
      check('Reports shows Sent and Built, no Exports', t6.includes('Sent') && t6.includes('Built') && !t6.includes('Everything exported'))
      noDash('reports', t6)
      await shot('6-reports')

      // 6. Settings + Team copy
      await goto('/dashboard/settings')
      const t7 = await text(page)
      check('Settings has no address field and points at the Studio', !(await page.$('input[name="report_emails"]')) && t7.includes('Studio'))
      noDash('settings', t7)
      await goto('/dashboard/team')
      const t8 = await text(page)
      check('Team lists addresses per report', t8.includes('Weekly digest') && t8.includes('Who gets the update'))
      noDash('team', t8)

      // 7. No export chrome on the dashboard pages
      for (const p of ['/dashboard', '/dashboard/market', '/dashboard/voice', '/dashboard/competitive', '/dashboard/videos', '/dashboard/profile']) {
        await goto(p)
        const exportChrome = await page.evaluate(() => document.querySelector('button[data-print-hide][aria-haspopup="dialog"]') != null)
        check(`no export control on ${p}`, !exportChrome && !/Add to a report/.test(await text(page)))
      }
      await shot('7-dashboard')
    })
  } finally {
    if (!has('keep')) await cleanup(since, reportId)
  }
  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed → ${out}/`)
  if (failed.length) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
