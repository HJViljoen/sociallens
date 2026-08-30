// Stage 3 follow-up (Heinrich, 2026-08-30): a report is the thing you see in
// the Studio, and its sending lives with it. Every schedule that still points
// at a STARTER (the backfilled Weekly digest) gets a real reports row made
// from that starter, and the schedule points at it instead.
//   node --env-file=.env.local --import tsx scripts/backfill-digest-reports.ts [--apply]

import { createAdminClient } from '../lib/supabase-admin'
import { instantiate, starterTemplate } from '../lib/reports/templates'

const apply = process.argv.includes('--apply')

async function main() {
  const admin = createAdminClient()
  const { data } = await admin.from('report_schedules').select('id, client_id, name, starter_key').not('starter_key', 'is', null).is('report_id', null)
  const rows = (data ?? []) as { id: string; client_id: string; name: string; starter_key: string }[]
  console.log(`${rows.length} schedule(s) on a starter${apply ? '' : ' (dry run; --apply to write)'}`)
  for (const s of rows) {
    const t = starterTemplate(s.starter_key)
    if (!t) { console.log(`  ${s.id}: unknown starter ${s.starter_key}, skipped`); continue }
    console.log(`  ${s.name} (${s.client_id}) ← ${t.name}`)
    if (!apply) continue
    const { data: r, error } = await admin.from('reports')
      .insert({ client_id: s.client_id, template_key: t.key, title: t.name, audience: t.audience, sections: instantiate(t.sections), cover: { register: t.audience }, created_by: null })
      .select('id').single()
    if (error || !r) throw new Error(`report: ${error?.message ?? 'no row'}`)
    const { error: e2 } = await admin.from('report_schedules').update({ report_id: (r as { id: string }).id, starter_key: null, updated_at: new Date().toISOString() }).eq('id', s.id)
    if (e2) throw new Error(`schedule: ${e2.message}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
