// Dev-only check for the Studio page (Reports & Exports Stage 3, T4).
//   node --env-file=.env.local --import tsx scripts/studio-smoke.ts --out scratch/studio [--base http://localhost:3000] [--keep]
// Signs in as the demo account and walks: Studio › Templates (starters, Use
// as my own → the editor → Build PDF) · Studio › Schedules (edit the default,
// save, Send me a test, Preview the email, New schedule → delete) · Reports
// (Sent · Built) · Settings/Team copy · no export chrome on any dashboard
// page. Creates real rows for the demo tenant — a template, snapshots,
// artifacts, links — which it deletes at the end unless --keep.

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
const check = (name: string, ok: boolean, note?: string) => { checks.push({ name, ok, note }); console.log(`${ok ? '✓' : '✗'} ${name}${note ? ` — ${note}` : ''}`) }
const text = (page: Page) => page.evaluate(() => document.body.innerText)
const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms))

async function cleanup(since: string, templateId: string | null) {
  const admin = createAdminClient()
  const { data: snaps } = await admin.from('report_snapshots').select('id').eq('client_id', DEMO).gte('created_at', since)
  for (const s of (snaps ?? []) as { id: string }[]) {
    const { data: arts } = await admin.from('artifacts').select('storage_path').eq('snapshot_id', s.id)
    const paths = ((arts ?? []) as { storage_path: string }[]).map((a) => a.storage_path)
    if (paths.length) await admin.storage.from('artifacts').remove(paths)
    await admin.from('report_snapshots').delete().eq('id', s.id)
  }
  if (templateId) await admin.from('reports').delete().eq('id', templateId).eq('client_id', DEMO)
  await admin.from('report_schedules').delete().eq('client_id', DEMO).eq('name', 'Smoke schedule')
  await admin.from('report_sends').delete().eq('client_id', DEMO).gte('claimed_at', since)
  console.log(`cleaned up rows since ${since}${templateId ? ` and template ${templateId}` : ''}`)
}

async function main() {
  if (!password) throw new Error('SHOT_PASSWORD or DEMO_PASSWORD is required')
  mkdirSync(out, { recursive: true })
  const since = new Date().toISOString()
  let templateId: string | null = null
  const admin = createAdminClient()
  const { data: def } = await admin.from('report_schedules').select('id, name, recipients').eq('client_id', DEMO).eq('is_default', true).maybeSingle()
  const original = def as { id: string; name: string; recipients: string[] } | null

  try {
    await withBrowser(async (page) => {
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
      const shot = async (name: string) => writeFileSync(join(out, `${name}.png`), await page.screenshot({ type: 'png' }))
      const goto = (path: string) => page.goto(`${base}${path}`, { waitUntil: 'networkidle0', timeout: 120_000 })
      await goto('/login')
      await page.type('input[type="email"]', email)
      await page.type('input[type="password"]', password)
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.keyboard.press('Enter')])

      // 1. Sidebar + Studio › Templates
      await goto('/dashboard/studio')
      await shot('1-studio')
      const t1 = await text(page)
      check('sidebar has Studio', await page.$('a[href="/dashboard/studio"]') != null)
      check('five starters listed', ['Weekly digest', 'Monthly marketing review', 'Leadership one-pager', 'Sales: objections & competitors', 'Content: what to make next'].every((n) => t1.includes(n)))
      check('starter detail offers Use as my own', t1.includes('Use as my own'))

      // 2. Use as my own → the editor → Build PDF
      const [useBtn] = await page.$$('xpath/.//button[normalize-space()="Use as my own"]')
      if (!useBtn) throw new Error('no "Use as my own" button')
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120_000 }), useBtn.click()])
      templateId = page.url().split('/studio/edit/')[1]?.split('?')[0] ?? null
      check('Use as my own lands in the editor', Boolean(templateId), page.url())
      await page.waitForSelector('fieldset input[type="checkbox"]', { timeout: 120_000 })
      await page.evaluate(() => document.fonts.ready)
      await shot('2-editor')
      check('editor has no save-as-template control', !(await text(page)).includes('as a template'))
      const [buildBtn] = await page.$$('xpath/.//button[contains(., "Build PDF")]')
      if (!buildBtn) throw new Error('no Build PDF button')
      // The signed-URL download would navigate the tab away; abort that one request.
      await page.setRequestInterception(true)
      const abortDownload = (r: import('puppeteer-core').HTTPRequest) => { if (r.url().includes('/storage/v1/object/sign/')) r.abort().catch(() => null); else r.continue().catch(() => null) }
      page.on('request', abortDownload)
      await buildBtn.click()
      // The result line shows, then the route refreshes (the outline re-keys on
      // updated_at) — read it in the same evaluate that saw it.
      const built = await page.waitForFunction(() => { const m = document.body.innerText.match(/(Your PDF is downloading|Couldn[^\n]*)/); return m ? m[0] : false }, { timeout: 240_000 })
        .then((h) => h.jsonValue() as Promise<string>).catch(() => '')
      await page.waitForNetworkIdle({ timeout: 30_000 }).catch(() => null)
      await settle(1500)
      check('Build PDF from the editor', built === 'Your PDF is downloading', built)
      page.off('request', abortDownload)
      await page.setRequestInterception(false)

      // 3. Back in the Studio: the template is listed with its build
      await goto(`/dashboard/studio?group=templates&item=${templateId}`)
      await shot('3-own-template')
      const t3 = await text(page)
      check('own template shows its build and share controls', /download pdf/i.test(t3) && /\bshare\b/i.test(t3))
      check('own template offers Edit and Send on a schedule', t3.includes('Edit') && t3.includes('Send on a schedule'))

      // 4. Schedules: the default, edited and saved
      await goto('/dashboard/studio?group=schedules')
      await shot('4-schedules')
      const t4 = await text(page)
      check('default Weekly digest schedule listed', t4.includes('Weekly digest') && t4.includes('default'))
      const nameInput = await page.$('input[placeholder="Weekly digest"]')
      if (!nameInput) throw new Error('no schedule name input')
      await nameInput.evaluate((el) => (el as HTMLInputElement).select())
      await nameInput.type('Weekly digest (smoke)')
      const to = await page.$('textarea')
      if (!to) throw new Error('no recipients textarea')
      await to.click()
      await page.keyboard.press('End')
      await to.type(', smoke-two@example.com')
      const [saveBtn] = await page.$$('xpath/.//button[normalize-space()="Save"]')
      if (!saveBtn) throw new Error('no Save button')
      await saveBtn.click()
      await page.waitForFunction(() => /Saved|could not|Could not|not an email/.test(document.body.innerText), { timeout: 60_000 })
      await settle(1500)
      const t4b = await text(page)
      check('schedule saved with a second address', t4b.includes('Weekly digest (smoke)') && t4b.includes('2 people') && !/Could not|not an email/.test(t4b), t4b.match(/Saved|Could not[^\n]*/)?.[0])
      await shot('5-schedule-saved')

      // 5. Send me a test (locally the provider is a stub: the route reports the failure honestly)
      const [testBtn] = await page.$$('xpath/.//button[contains(., "Send me a test")]')
      if (!testBtn) throw new Error('no Send me a test button')
      await testBtn.click()
      await page.waitForFunction(() => document.body.innerText.includes('Sending…'), { timeout: 30_000 })
      await page.waitForFunction(() => !document.body.innerText.includes('Sending…'), { timeout: 240_000 })
      const t5 = await text(page)
      check('Send me a test ran the runner', /Sent to|provider not configured/.test(t5), t5.match(/(Sent to|email not sent)[^\n]*/)?.[0])
      await shot('6-test-sent')

      // 6. Preview the email
      const [prevBtn] = await page.$$('xpath/.//button[contains(., "Preview the email")]')
      if (!prevBtn) throw new Error('no Preview button')
      await prevBtn.click()
      await page.waitForSelector('iframe[title="Email preview"]', { timeout: 30_000 })
      const frameEl = await page.$('iframe[title="Email preview"]')
      const frame = await frameEl!.contentFrame()
      await frame!.waitForFunction(() => document.body && document.body.innerText.length > 200, { timeout: 120_000 })
      const previewText = await frame!.evaluate(() => document.body.innerText)
      check('email preview renders the digest', /in short|where you stand/i.test(previewText), previewText.slice(0, 80).replace(/\n/g, ' '))
      await shot('7-preview')

      // 7. New schedule from a starter → create → delete
      await goto('/dashboard/studio?group=schedules&item=new&starter=leadership_one_pager')
      const nameNew = await page.$('input[placeholder="Weekly digest"]')
      await nameNew!.type('Smoke schedule')
      const toNew = await page.$('textarea')
      await toNew!.type('smoke@example.com')
      const [createBtn] = await page.$$('xpath/.//button[normalize-space()="Create schedule"]')
      if (!createBtn) throw new Error('no Create schedule button')
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60_000 }).catch(() => null), createBtn.click()])
      await page.waitForFunction(() => document.body.innerText.includes('Smoke schedule'), { timeout: 60_000 })
      await settle(1000)
      check('new schedule created and listed', (await text(page)).includes('Smoke schedule'))
      await shot('8-new-schedule')
      const [delBtn] = await page.$$('xpath/.//button[normalize-space()="Delete"]')
      if (delBtn) {
        await delBtn.click()
        const [yes] = await page.$$('xpath/.//button[normalize-space()="Yes, delete"]')
        if (yes) await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60_000 }).catch(() => null), yes.click()])
        await settle(1000)
      }
      check('schedule deleted after an inline confirm', !(await text(page)).includes('Smoke schedule'))

      // 8. Reports: Sent · Built
      await goto('/dashboard/reports')
      await shot('9-reports-sent')
      const t8 = await text(page)
      check('Reports shows Sent and Built, no Exports', t8.includes('Sent') && t8.includes('Built') && !t8.includes('Everything exported'))
      await goto('/dashboard/reports?group=built')
      const t8b = await text(page)
      check('Built lists the hand build', /built in the studio|nothing built/i.test(t8b))
      await shot('10-reports-built')

      // 9. Settings + Team copy
      await goto('/dashboard/settings')
      const t9 = await text(page)
      check('Settings has no address field and points at Studio › Schedules', !(await page.$('input[name="report_emails"]')) && t9.includes('Schedules'))
      await goto('/dashboard/team')
      const t9b = await text(page)
      check('Team lists addresses per schedule', t9b.includes('Weekly digest') && t9b.includes('Who gets the update'))
      await shot('11-team')

      // 10. No export chrome on the dashboard pages
      for (const p of ['/dashboard', '/dashboard/market', '/dashboard/voice', '/dashboard/competitive', '/dashboard/videos', '/dashboard/profile']) {
        await goto(p)
        const exportChrome = await page.evaluate(() => document.querySelector('button[data-print-hide][aria-haspopup="dialog"]') != null || /\bExport\b/.test(document.querySelector('header, [data-page-bar]')?.textContent ?? ''))
        const t = await text(page)
        check(`no export control on ${p}`, !exportChrome && !/Add to a report/.test(t))
      }
      await shot('12-dashboard')
    })
  } finally {
    // Put the default schedule back as it was; drop what the walk created.
    if (original) await admin.from('report_schedules').update({ name: original.name, recipients: original.recipients }).eq('id', original.id)
    if (!has('keep')) await cleanup(since, templateId)
  }
  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed → ${out}/`)
  if (failed.length) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
