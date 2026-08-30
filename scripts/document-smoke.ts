// Dev-only check for WRITTEN reports in the Studio (T8d, 2026-08-31).
//   INNGEST_DEV=1 npm run dev  +  npx inngest-cli@latest dev -u http://localhost:3000/api/inngest --no-discovery
//   node --env-file=.env.local --import tsx scripts/document-smoke.ts --out scratch/document-smoke [--base http://localhost:3000] [--no-build] [--keep]
// Signs in as the demo account and walks: New report → the Sales brief →
// the document editor (empty state, settings save) → Build (a REAL build
// through the route, the Inngest function and the render route, ≈ $0.6 and
// three to five minutes; --no-build skips it and everything after) → the
// pages on screen → edit a block in place, its mark, restore → the workings
// → the Studio list row → a share link opened as a stranger → the PDF's
// print variant. No em dash in any copy. Creates real rows for the demo
// tenant, which it deletes at the end unless --keep.

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Page } from 'puppeteer-core'
import { withBrowser } from '../lib/render/chromium'
import { createAdminClient } from '../lib/supabase-admin'

const args = process.argv.slice(2)
const flag = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt }
const has = (name: string) => args.includes(`--${name}`)
const out = flag('out', 'scratch/document-smoke')
const base = flag('base', process.env.RENDER_BASE_URL ?? 'http://localhost:3000')
const email = process.env.SHOT_EMAIL ?? 'demo@verbatimintel.com'
const password = process.env.SHOT_PASSWORD ?? process.env.DEMO_PASSWORD ?? ''
const DEMO = 'de300055-0000-4000-8000-000000000001'

const checks: { name: string; ok: boolean; note?: string }[] = []
const check = (name: string, ok: boolean, note?: string) => { checks.push({ name, ok, note }); console.log(`${ok ? '✓' : '✗'} ${name}${note ? ` (${note})` : ''}`) }
const text = (page: Page) => page.evaluate(() => document.body.innerText)
/** Eyebrows and labels are CSS-uppercased; compare without case. */
const hasText = (t: string, ...needles: string[]) => needles.every((n) => t.toLowerCase().includes(n.toLowerCase()))
const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms))

async function cleanup(since: string, reportId: string | null) {
  const admin = createAdminClient()
  const { data: snaps } = await admin.from('report_snapshots').select('id').eq('client_id', DEMO).gte('created_at', since)
  for (const s of (snaps ?? []) as { id: string }[]) {
    const { data: arts } = await admin.from('artifacts').select('storage_path').eq('snapshot_id', s.id)
    const paths = ((arts ?? []) as { storage_path: string }[]).map((a) => a.storage_path)
    if (paths.length) await admin.storage.from('artifacts').remove(paths)
    await admin.from('share_links').delete().eq('snapshot_id', s.id)
    await admin.from('report_edits').delete().eq('snapshot_id', s.id)
    await admin.from('report_snapshots').delete().eq('id', s.id)
  }
  if (reportId) {
    await admin.from('report_builds').delete().eq('report_id', reportId).eq('client_id', DEMO)
    await admin.from('report_schedules').delete().eq('report_id', reportId).eq('client_id', DEMO)
    await admin.from('reports').delete().eq('id', reportId).eq('client_id', DEMO)
  }
  console.log(`cleaned up rows since ${since}${reportId ? ` and report ${reportId}` : ''}`)
}

async function main() {
  if (!password) throw new Error('SHOT_PASSWORD or DEMO_PASSWORD is required')
  mkdirSync(out, { recursive: true })
  const since = new Date().toISOString()
  let reportId: string | null = null
  const admin = createAdminClient()

  try {
    await withBrowser(async (page) => {
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
      const shot = async (name: string) => writeFileSync(join(out, `${name}.png`), await page.screenshot({ type: 'png' }))
      const goto = (path: string) => page.goto(path.startsWith('http') ? path : `${base}${path}`, { waitUntil: 'networkidle0', timeout: 120_000 })
      const noDash = (label: string, raw: string) => { const t = raw.replace(/Össur — Demo/gi, '').replace(/ÖSSUR — DEMO/g, '').replace(/^\s*— .*$/gm, ''); check(`no em dash: ${label}`, !t.includes('—'), t.includes('—') ? t.split('\n').find((l) => l.includes('—'))?.slice(0, 80) : undefined) }
      await goto('/login')
      await page.type('input[type="email"]', email)
      await page.type('input[type="password"]', password)
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.keyboard.press('Enter')])

      // 1. New report: the written group, the Sales brief
      await goto('/dashboard/studio/new')
      let t = await text(page)
      const lc = t.toLowerCase()
      check('New report shows "Written from the update" above the arranged group', lc.indexOf('written from the update') > -1 && lc.indexOf('written from the update') < lc.indexOf('arranged from the pages'))
      check('the Sales brief card is there', t.includes('Sales brief'))
      noDash('New report', t)
      await shot('01-new')
      const [briefBtn] = await page.$$('xpath/.//button[@name="document"][@value="sales_brief"]')
      if (!briefBtn) throw new Error('no Sales brief button')
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120_000 }), briefBtn.click()])
      const m = /\/dashboard\/studio\/edit\/([0-9a-f-]{36})/.exec(page.url())
      reportId = m?.[1] ?? null
      check('lands in the document editor', Boolean(reportId), page.url())
      // The editor streams in behind a skeleton; wait for the settings pane.
      await page.waitForFunction(() => /who you sell to/i.test(document.body.innerText), { timeout: 60_000 }).catch(() => null)

      // 2. The editor before a build: settings save
      t = await text(page)
      check('empty state says Build to write the first draft', t.includes('Build to write the first draft'))
      check('settings show who you sell to, competitors, findings, English', hasText(t, 'Who you sell to', 'Competitors to include', 'Ottobock', 'English'))
      noDash('document editor (empty)', t)
      await shot('02-editor-empty')
      const reader = await page.$('input[placeholder="the sales team"]')
      if (!reader) throw new Error('no written-for input')
      await reader.evaluate((el) => { (el as HTMLInputElement).value = ''; (el as HTMLInputElement).focus() })
      await reader.type('the reps in the field')
      await page.keyboard.press('Tab')
      await page.waitForFunction(() => document.body.innerText.includes('Saved'), { timeout: 30_000 }).catch(() => null)
      await page.select('select', 'professionals')
      await page.waitForFunction(() => /Saved/.test(document.body.innerText), { timeout: 30_000 }).catch(() => null)
      await settle(1200)
      const { data: row } = await admin.from('reports').select('kind, template_key, cover, settings').eq('id', reportId!).single()
      check('the row is kind document / sales_brief', row?.kind === 'document' && row?.template_key === 'sales_brief')
      check('written for and who you sell to saved', (row?.cover as { reader?: string })?.reader === 'the reps in the field' && (row?.settings as { sellsTo?: string })?.sellsTo === 'professionals', JSON.stringify({ cover: row?.cover, settings: row?.settings }))

      if (has('no-build')) { console.log('--no-build: stopping after the settings'); return }

      // 3. Build through the UI, the route, Inngest and the render route
      const [buildBtn] = await page.$$('xpath/.//button[normalize-space(.)="Build"]')
      if (!buildBtn) throw new Error('no Build button')
      const t0 = Date.now()
      await buildBtn.click()
      await page.waitForFunction(() => /Building · \d+:\d\d/.test(document.body.innerText), { timeout: 30_000 }).catch(() => null)
      t = await text(page)
      check('the control counts and says where the build is', /Building · \d+:\d\d/.test(t) && /(Queued|Reading the update|Starting|Picking up)/.test(t), t.match(/Building · [^\n]+\n[^\n]+/)?.[0])
      await shot('03-building')
      const outcome = await page.waitForFunction(() => { const m = document.body.innerText.match(/(Built\.|The build failed[^\n]*|Not a document[^\n]*|Nothing to write[^\n]*|Couldn[^\n]*|failed[^\n]*)/); return m ? m[0] : false }, { timeout: 480_000 })
        .then((h) => h.jsonValue() as Promise<string>).catch(() => 'timed out')
      const secs = Math.round((Date.now() - t0) / 1000)
      check(`the build ends Built (in ${secs} s)`, outcome === 'Built.', outcome)
      const { data: build } = await admin.from('report_builds').select('status, cost_usd, snapshot_id, artifact_id, needs_review, error').eq('report_id', reportId!).order('started_at', { ascending: false }).limit(1).single()
      check('the build row is done with cost, snapshot and artifact', build?.status === 'done' && Number(build?.cost_usd) > 0 && Boolean(build?.snapshot_id) && Boolean(build?.artifact_id), JSON.stringify(build))
      const snapshotId = build?.snapshot_id as string
      await page.waitForNetworkIdle({ timeout: 60_000 }).catch(() => null)
      await settle(1500)

      // 4. The pages on screen, edit a block in place
      await goto(`/dashboard/studio/edit/${reportId}`)
      await page.waitForFunction(() => document.body.innerText.includes('Click any text to change it'), { timeout: 60_000 }).catch(() => null)
      await settle(1000)
      t = await text(page)
      check('the pages show after the build', hasText(t, 'Click any text to change it', 'Findings in this brief'))
      noDash('document editor (built)', t)
      await shot('04-editor-built')
      const slides = await page.$$('.vb-slide')
      check('the deck has a cover and pages', slides.length >= 5, `${slides.length} slides`)
      const overflow = await page.$$('.vb-slide[data-overflow]')
      check('no page overflows its sheet', overflow.length === 0, `${overflow.length} overflowing`)
      const saw = await page.$('.vb-block[data-block-id$=".saw"] [role="button"]')
      if (!saw) throw new Error('no saw block to edit')
      await saw.click()
      const ta = await page.waitForSelector('textarea.vb-edit', { timeout: 10_000 })
      const before = await ta!.evaluate((el) => (el as HTMLTextAreaElement).value)
      check('the textarea holds the substituted prose, no placeholders', before.length > 40 && !before.includes('[['), before.slice(0, 60))
      await ta!.evaluate((el) => { const x = el as HTMLTextAreaElement; x.setSelectionRange(x.value.length, x.value.length) })
      await page.keyboard.type(' SMOKE EDIT 7f3a.')
      await page.keyboard.press('Tab')
      // The saved words come back with the server's refresh, not the blur:
      // wait for the refreshed deck, not a fixed pause.
      await page.waitForFunction(() => {
        const t2 = document.body.innerText.toLowerCase()
        return t2.includes('smoke edit 7f3a.') && t2.includes('restore the original')
      }, { timeout: 60_000 }).catch(() => null)
      t = await text(page)
      check('the edit shows on the page with its mark', hasText(t, 'SMOKE EDIT 7f3a.', 'edited', 'restore the original'))
      const { data: edits } = await admin.from('report_edits').select('block_id, text').eq('snapshot_id', snapshotId)
      check('one report_edits row, the snapshot untouched', edits?.length === 1 && edits[0].text.endsWith('SMOKE EDIT 7f3a.'), JSON.stringify(edits?.map((e) => e.block_id)))
      const { data: snapRow } = await admin.from('report_snapshots').select('data').eq('id', snapshotId).single()
      check('the stored snapshot does not carry the edit', !JSON.stringify(snapRow?.data).includes('SMOKE EDIT'))
      const { data: arts } = await admin.from('artifacts').select('stale').eq('snapshot_id', snapshotId)
      check('the artifact is stale after the edit', Boolean(arts?.length) && arts!.every((a) => a.stale))
      await shot('05-edited')

      // 5. The workings
      const [workingsBox] = await page.$$('xpath/.//label[contains(., "Show the workings")]/input')
      if (!workingsBox) throw new Error('no workings toggle')
      await workingsBox.click()
      await settle(600)
      const pill = await page.$('.vb-block button[aria-label^="Show what this rests on"]')
      check('count pills appear in the margin', Boolean(pill))
      if (pill) { await pill.click(); await settle(600) }
      t = await text(page)
      check('the drawer shows the block\'s points and the questions asked', /conversations?/i.test(t) && hasText(t, 'What the researcher asked'))
      const drawerBox = await page.$eval('aside[aria-label="The workings"]', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, w: r.width, right: r.right, vw: window.innerWidth } }).catch(() => null)
      check('the drawer is on screen beside the page', Boolean(drawerBox) && drawerBox!.w > 200 && drawerBox!.right <= drawerBox!.vw + 1, JSON.stringify(drawerBox))
      noDash('workings drawer', t)
      await shot('06-workings')

      // 6. Restore the original
      const [restoreBtn] = await page.$$('xpath/.//button[contains(., "restore the original")]')
      if (restoreBtn) { await restoreBtn.click(); await page.waitForFunction(() => document.body.innerText.includes('Restored.'), { timeout: 30_000 }).catch(() => null); await settle(1000) }
      const { count: left } = await admin.from('report_edits').select('id', { count: 'exact', head: true }).eq('snapshot_id', snapshotId)
      check('restore removes the edit row', left === 0)

      // 7. The Studio list row
      await goto(`/dashboard/studio?item=${reportId}`)
      await page.waitForFunction(() => /written report/i.test(document.body.innerText), { timeout: 60_000 }).catch(() => null)
      t = await text(page)
      check('the list shows the written report, built, with its cost', hasText(t, 'Written report', 'Built') && /\$\d\.\d\d/.test(t))
      noDash('Studio list', t)
      await shot('07-studio')

      // 8. A share link made in the Studio, opened as a stranger
      const [createLink] = await page.$$('xpath/.//button[contains(., "Create link")]')
      if (!createLink) throw new Error('no Create link button')
      await createLink.click()
      const shareUrl = await page.waitForFunction(() => { const a = Array.from(document.querySelectorAll('a')).find((x) => /\/r\/[A-Za-z0-9_-]+/.test(x.getAttribute('href') ?? '')); return a ? a.getAttribute('href') : false }, { timeout: 30_000 })
        .then((h) => h.jsonValue() as Promise<string>).catch(() => '')
      check('a share link was made from the Studio', Boolean(shareUrl), shareUrl)
      if (shareUrl) {
        const token = shareUrl.split('/r/')[1]
        const ctx = await page.browser().createBrowserContext()
        const p2 = await ctx.newPage()
        await p2.setViewport({ width: 1280, height: 900 })
        const res = await p2.goto(`${base}/r/${token}`, { waitUntil: 'networkidle0', timeout: 120_000 })
        const t2 = await p2.evaluate(() => document.body.innerText)
        check('the share page renders the written document', (res?.status() ?? 0) === 200 && hasText(t2, 'Findings in this brief', 'Prepared by'))
        noDash('share page', t2)
        writeFileSync(join(out, '08-share.png'), await p2.screenshot({ type: 'png' }))
        await ctx.close()
      }

      // 9. Paper prints on hairlines
      const { renderUrl } = await import('../lib/render/render')
      const html = await (await fetch(renderUrl(base, snapshotId, {}))).text()
      check('the render root prints variant b (hairlines)', html.includes('data-print-variant="b"'))
    })
  } finally {
    if (!has('keep')) await cleanup(since, reportId)
  }
  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed → ${out}/`)
  if (failed.length) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
