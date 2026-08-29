// Dev-only check for share links (Reports & Exports Stage 2, T5).
//   node --env-file=.env.local --import tsx scripts/share-smoke.ts --report <reports.id> [--out scratch/share]
// Signs in as the demo account, creates an open link and a password-protected
// link to the report's latest build from the Reports page, then opens each in
// a FRESH browser context (no session): content, a working evidence popover,
// an inert dashboard link, the password gate (wrong then right), the robots
// header, the view count, and revoke → "withdrawn". Leaves the links revoked;
// the report itself is cleaned up by studio-smoke --cleanup.

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { withBrowser } from '../lib/render/chromium'
import { createAdminClient } from '../lib/supabase-admin'

const args = process.argv.slice(2)
const flag = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt }
const reportId = flag('report', '')
const out = flag('out', 'scratch/share')
const base = flag('base', process.env.RENDER_BASE_URL ?? 'http://localhost:3000')
const email = process.env.SHOT_EMAIL ?? 'demo@verbatimintel.com'
const password = process.env.SHOT_PASSWORD ?? process.env.DEMO_PASSWORD ?? ''
const PASS = 'monday-call'

async function main() {
  if (!reportId) throw new Error('--report is required')
  if (!password) throw new Error('SHOT_PASSWORD or DEMO_PASSWORD is required')
  mkdirSync(out, { recursive: true })
  const admin = createAdminClient()
  const results: string[] = []
  const ok = (name: string, pass: boolean, detail = '') => { results.push(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

  await withBrowser(async (page) => {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    const shot = async (p: typeof page, name: string) => writeFileSync(join(out, `${name}.png`), await p.screenshot({ type: 'png' }))
    await page.goto(`${base}/login`, { waitUntil: 'networkidle0' })
    await page.type('input[type="email"]', email)
    await page.type('input[type="password"]', password)
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.keyboard.press('Enter')])

    // 1. Create links from the Reports page.
    await page.goto(`${base}/dashboard/reports?item=${reportId}`, { waitUntil: 'networkidle0' })
    const [createBtn] = await page.$$('xpath/.//button[contains(., "Create link")]')
    if (!createBtn) throw new Error('no Create link button (is the report built?)')
    await createBtn.click()
    await page.waitForSelector('a[href*="/r/"]', { timeout: 30_000 })
    const openUrl = await page.evaluate(() => (document.querySelector('a[href*="/r/"]') as HTMLAnchorElement).href)
    await page.type('input[placeholder^="Password"]', PASS)
    const [createBtn2] = await page.$$('xpath/.//button[contains(., "Create link")]')
    await createBtn2!.click()
    await page.waitForFunction((prev) => { const a = document.querySelector('a[href*="/r/"]') as HTMLAnchorElement | null; return a && a.href !== prev }, { timeout: 30_000 }, openUrl)
    const lockedUrl = await page.evaluate(() => (document.querySelector('a[href*="/r/"]') as HTMLAnchorElement).href)
    await shot(page, '1-links-made')
    ok('two links created', openUrl !== lockedUrl, `${openUrl} · ${lockedUrl}`)

    // 2. A fresh context: no session, no cookies.
    const ctx = await page.browser().createBrowserContext()
    const anon = await ctx.newPage()
    await anon.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
    const res = await anon.goto(openUrl, { waitUntil: 'networkidle0' })
    ok('open link renders without a session', res?.status() === 200 && !anon.url().includes('/login'), `status ${res?.status()} at ${anon.url()}`)
    ok('X-Robots-Tag noindex', /noindex/.test(res?.headers()['x-robots-tag'] ?? ''), res?.headers()['x-robots-tag'] ?? '(none)')
    const text = await anon.evaluate(() => document.body.innerText)
    ok('cover + sections on the page', /Prepared by/.test(text) && /1\. Dashboard/.test(text) && /with Verbatim/.test(text))
    ok('no dashboard chrome', !/Consumer Profile\s+Competitive Intel/.test(text))
    await anon.evaluate(() => document.fonts.ready)
    await shot(anon, '2-open-link')

    // 3. The evidence popover works; a dashboard link is inert.
    const trigger = await anon.$('button[aria-haspopup="dialog"]')
    if (trigger) {
      await trigger.click()
      await new Promise((r) => setTimeout(r, 400))
      const dialogs = await anon.$$('[role="dialog"]')
      ok('evidence popover opens', dialogs.length > 0)
      await shot(anon, '3-popover')
      await anon.keyboard.press('Escape')
    } else ok('evidence popover opens', false, 'no popover trigger on the page')
    const before = anon.url()
    const link = await anon.$('a[href^="/dashboard"]')
    if (link) {
      await link.click()
      await new Promise((r) => setTimeout(r, 500))
      const note = await anon.evaluate(() => document.body.innerText.includes('That lives in Verbatim'))
      ok('dashboard link inert with a note', anon.url() === before && note, anon.url())
      await shot(anon, '4-inert-link')
    } else ok('dashboard link inert with a note', true, 'no dashboard link on this deck')

    // 4. The password gate.
    await anon.goto(lockedUrl, { waitUntil: 'networkidle0' })
    ok('protected link shows the gate', await anon.evaluate(() => document.body.innerText.includes('This report is protected')))
    await anon.type('input[name="password"]', 'wrong')
    await Promise.all([anon.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => null), anon.keyboard.press('Enter')])
    await anon.waitForFunction(() => document.body.innerText.includes('not right') || !document.body.innerText.includes('This report is protected'), { timeout: 20_000 })
    ok('wrong password stays out', await anon.evaluate(() => document.body.innerText.includes('not right')))
    await shot(anon, '5-gate-wrong')
    await anon.click('input[name="password"]', { count: 3 })
    await anon.type('input[name="password"]', PASS)
    await Promise.all([anon.waitForNavigation({ waitUntil: 'networkidle0' }), anon.keyboard.press('Enter')])
    ok('right password opens', await anon.evaluate(() => !document.body.innerText.includes('This report is protected') && document.body.innerText.includes('Prepared by')))
    await anon.reload({ waitUntil: 'networkidle0' })
    ok('cookie holds on reload', await anon.evaluate(() => !document.body.innerText.includes('This report is protected')))
    await shot(anon, '6-gate-open')

    // 5. Views counted; revoke; withdrawn.
    const { data: rows } = await admin.from('share_links').select('id, token, view_count').in('token', [openUrl.split('/r/')[1], lockedUrl.split('/r/')[1]])
    const views = ((rows ?? []) as { view_count: number }[]).map((r) => r.view_count)
    ok('views counted', views.every((v) => v >= 1), `counts ${views.join(', ')}`)
    await page.goto(`${base}/dashboard/reports?item=${reportId}`, { waitUntil: 'networkidle0' })
    const [revoke] = await page.$$('xpath/.//button[contains(., "Revoke")]')
    if (!revoke) throw new Error('no Revoke button')
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => null), revoke.click()])
    await new Promise((r) => setTimeout(r, 1500))
    await shot(page, '7-after-revoke')
    const revokedToken = ((await admin.from('share_links').select('token').not('revoked_at', 'is', null).in('token', [openUrl.split('/r/')[1], lockedUrl.split('/r/')[1]])).data as { token: string }[] | null)?.[0]?.token
    ok('one link revoked', Boolean(revokedToken))
    if (revokedToken) {
      await anon.goto(`${base}/r/${revokedToken}`, { waitUntil: 'networkidle0' })
      ok('revoked link says withdrawn', await anon.evaluate(() => document.body.innerText.includes('withdrawn')))
      await shot(anon, '8-withdrawn')
    }
    await anon.goto(`${base}/r/not-a-real-token`, { waitUntil: 'networkidle0' })
    ok('bad token says nothing here', await anon.evaluate(() => document.body.innerText.includes('Nothing here')))
    // Leave the other link revoked too, so nothing stays open on the demo tenant.
    await admin.from('share_links').update({ revoked_at: new Date().toISOString() }).in('token', [openUrl.split('/r/')[1], lockedUrl.split('/r/')[1]]).is('revoked_at', null)
    await ctx.close()
  })
  console.log(results.join('\n'))
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(2)
}

main().catch((e) => { console.error(e); process.exit(1) })
