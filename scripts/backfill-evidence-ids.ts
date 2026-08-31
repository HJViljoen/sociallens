/**
 * Backfill `report_snapshots.evidence_ids` with the refs that live in
 * `workings` (T11, 2026-08-31).
 *
 *   node --env-file=.env.local --import tsx scripts/backfill-evidence-ids.ts [--apply] [--client <id>]
 *
 * Why: `createSnapshot` froze the workings' quotes but threw their refs away,
 * so `evidence_ids` carried only what the pages cite. Erasure finds a
 * snapshot by `overlaps('evidence_ids', refs)` — so a document whose only
 * citation of an erased commenter sat in the workings was invisible to it,
 * and its PDF was never re-rendered. The write path is fixed; this repairs
 * the snapshots built before the fix.
 *
 * Dry run by default: prints what each snapshot would gain.
 */
import { createAdminClient } from '../lib/supabase-admin'
import { collectQuoteRefs } from '../lib/renderables/quotes-freeze'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const clientId = args.includes('--client') ? args[args.indexOf('--client') + 1] : null

async function main() {
  const admin = createAdminClient()
  let q = admin.from('report_snapshots').select('id, client_id, title, evidence_ids, workings').not('workings', 'is', null).order('created_at')
  if (clientId) q = q.eq('client_id', clientId)
  const { data, error } = await q
  if (error) throw new Error(`report_snapshots: read failed: ${error.message}`)
  const rows = (data ?? []) as { id: string; client_id: string; title: string; evidence_ids: string[] | null; workings: unknown }[]
  console.log(`${rows.length} snapshot(s) with workings${clientId ? ` for client ${clientId}` : ''}${apply ? '' : ' — DRY RUN (add --apply to write)'}\n`)

  let changed = 0
  let added = 0
  for (const row of rows) {
    const have = new Set(row.evidence_ids ?? [])
    const inWorkings = collectQuoteRefs(row.workings)
    const missing = inWorkings.filter((r) => !have.has(r))
    if (!missing.length) {
      console.log(`  ${row.id.slice(0, 8)} "${row.title}": ${have.size} refs, nothing missing`)
      continue
    }
    changed++
    added += missing.length
    console.log(`  ${row.id.slice(0, 8)} "${row.title}": ${have.size} refs ${apply ? '+' : 'would gain '}${missing.length} from the workings`)
    if (apply) {
      const next = [...new Set([...have, ...missing])]
      const { error: upErr } = await admin.from('report_snapshots').update({ evidence_ids: next }).eq('id', row.id)
      if (upErr) throw new Error(`report_snapshots ${row.id}: update failed: ${upErr.message}`)
    }
  }
  console.log(`\n${changed} snapshot(s) ${apply ? 'updated' : 'would change'}, ${added} ref(s) ${apply ? 'added' : 'to add'}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
