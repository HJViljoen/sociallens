/**
 * The four written templates through the Studio, in a real browser, WITHOUT
 * building any of them (2026-09-02).
 *
 *   SHOT_PASSWORD=… node --env-file=.env.local --import tsx scripts/document-templates-smoke.ts [--base http://localhost:3000] [--keep]
 *
 * document-smoke.ts proves one template end to end and pays for a build to do
 * it. This one proves the part that is per template and costs nothing: that
 * every template is offered, that picking it makes a report of the right kind,
 * that its settings pane offers only controls that do something on THAT brief,
 * and that a report takes one schedule, not two. Everything it creates on the
 * demo tenant is deleted at the end unless --keep.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'puppeteer-core'
import { createAdminClient } from '../lib/supabase-admin'
import { withBrowser } from '../lib/render/chromium'
import { DOCUMENT_TEMPLATES } from '../lib/reports/documents/templates'

const args = process.argv.slice(2)
const flag = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt }
const has = (name: string) => args.includes(`--${name}`)
const out = flag('out', 'scratch/document-templates-smoke')
const base = flag('base', process.env.RENDER_BASE_URL ?? 'http://localhost:3000')
const email = process.env.SHOT_EMAIL ?? 'demo@verbatimintel.com'
const password = process.env.SHOT_PASSWORD ?? process.env.DEMO_PASSWORD ?? ''
const DEMO = 'de300055-0000-4000-8000-000000000001'

const checks: { name: string; ok: boolean; note?: string }[] = []
const check = (name: string, ok: boolean, note?: string) => { checks.push({ name, ok, note }); console.log(`${ok ? '✓' : '✗'} ${name}${note ? ` (${note})` : ''}`) }
const text = (page: Page) => page.evaluate(() => document.body.innerText)
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms))

async function cleanup(ids: string[]) {
  if (!ids.length) return
  const admin = createAdminClient()
  await admin.from('report_schedules').delete().in('report_id', ids).eq('client_id', DEMO)
  await admin.from('report_builds').delete().in('report_id', ids).eq('client_id', DEMO)
  await admin.from('reports').delete().in('id', ids).eq('client_id', DEMO)
  console.log(`cleaned up ${ids.length} report(s)`)
}

async function main() {
  if (!password) throw new Error('SHOT_PASSWORD or DEMO_PASSWORD is required')
  mkdirSync(out, { recursive: true })
  const made: string[] = []
  const admin = createAdminClient()

  try {
    await withBrowser(async (page) => {
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
      const shot = async (name: string) => writeFileSync(join(out, `${name}.png`), await page.screenshot({ type: 'png' }))
      const goto = (path: string) => page.goto(`${base}${path}`, { waitUntil: 'networkidle0', timeout: 120_000 })

      await goto('/login')
      await page.type('input[type="email"]', email)
      await page.type('input[type="password"]', password)
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.keyboard.press('Enter')])

      // 1. Every written template is offered, and none of them says a dash.
      await goto('/dashboard/studio/new')
      const t = await text(page)
      for (const tpl of DOCUMENT_TEMPLATES) check(`"${tpl.name}" is offered`, t.includes(tpl.name))
      check('no em dash on the picker', !t.replace(/Össur — Demo/gi, '').includes('—'))
      await shot('01-new')

      // 2. Each template makes a report of its own kind, and its settings
      //    pane offers only the controls that do something on that brief.
      for (const tpl of DOCUMENT_TEMPLATES) {
        await goto('/dashboard/studio/new')
        const [btn] = await page.$$(`xpath/.//button[@name="document"][@value="${tpl.key}"]`)
        if (!btn) { check(`${tpl.key}: a button to use it`, false); continue }
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120_000 }), btn.click()])
        const url = page.url()
        const id = /\/studio\/edit\/([0-9a-f-]{36})/.exec(url)?.[1] ?? null
        check(`${tpl.key}: lands in the editor`, !!id, url.replace(base, ''))
        if (!id) continue
        made.push(id)
        const { data: row } = await admin.from('reports').select('kind, template_key, audience').eq('id', id).maybeSingle()
        const r = row as { kind: string; template_key: string; audience: string } | null
        check(`${tpl.key}: stored as a document of this template`, r?.kind === 'document' && r?.template_key === tpl.key && r?.audience === tpl.audience, `${r?.kind}/${r?.template_key}/${r?.audience}`)

        await settle()
        const pane = await text(page)
        const wantsCompetitors = tpl.skeleton.some((p) => p.kind === 'competitor') || tpl.anchors.some((a) => a.perCompetitor)
        check(`${tpl.key}: the competitors picker is ${wantsCompetitors ? 'offered' : 'hidden'}`,
          pane.toLowerCase().includes('competitors to include') === wantsCompetitors)
        check(`${tpl.key}: findings offers at most ${tpl.findingsMax}`,
          tpl.findingsMax === 4 ? pane.toLowerCase().includes('up to four') : !pane.toLowerCase().includes('up to four') && pane.toLowerCase().includes('up to three'))
        check(`${tpl.key}: says what it is before it is built`, pane.includes(tpl.description.slice(0, 40)))
        await shot(`02-${tpl.key}`)
      }

      // 3. One schedule per report: the second is refused in words.
      const first = made[0]
      if (first) {
        const { error: e1 } = await admin.from('report_schedules').insert({ client_id: DEMO, name: 'Smoke one', report_id: first, cadence: 'every_update', recipients: ['smoke@example.com'], attach_pdf: true, share_days: 30, active: false, review: false, is_default: false })
        check('a report takes a first schedule', !e1, e1?.message)
        const { error: e2 } = await admin.from('report_schedules').insert({ client_id: DEMO, name: 'Smoke two', report_id: first, cadence: 'every_update', recipients: ['smoke@example.com'], attach_pdf: true, share_days: 30, active: false, review: false, is_default: false })
        check('and refuses a second on the same report', !!e2 && /unique|duplicate/i.test(e2.message), e2?.message?.slice(0, 60) ?? 'accepted, which is the bug')
      }

      // 4. The Studio lists them all, each named and readable.
      await goto('/dashboard/studio')
      const studio = await text(page)
      for (const tpl of DOCUMENT_TEMPLATES) check(`Studio lists "${tpl.name}"`, studio.includes(tpl.name))
      await shot('03-studio')
    })
  } finally {
    if (!has('keep')) await cleanup(made)
  }

  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed · screenshots in ${out}/`)
  if (failed.length) { console.error(failed.map((f) => `  ✗ ${f.name}${f.note ? ` (${f.note})` : ''}`).join('\n')); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) })
