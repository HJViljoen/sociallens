// Structural eval of a built document (decision 13, 2026-08-31): re-reads a
// snapshot and says whether the pages look the way every issue should.
//   node --env-file=.env.local --import tsx scripts/eval-document.ts <snapshotId> [<snapshotId>...] [--json]
// Checks: the page kinds in skeleton order · block count and length per
// field within DOCUMENT_BLOCK_MAX · no digit outside a [[key]] in machine
// text (product names allowed via the method's own words; the code-composed
// heard and sure lines are exempt) · no em or en
// dash · every [[key]] resolves in figures · every quote a ref with empty
// text · workings: every finding block rests on known points, check verdicts
// present, continuedFrom coverage. Exit 1 on any failure.

import { createAdminClient } from '../lib/supabase-admin'
import { DOCUMENT_BLOCK_MAX } from '../lib/config'
import { isDocumentData, type DocumentSnapshotData, type DocumentWorkings } from '../lib/reports/documents/types'
import { FIGURE_KEY_RE } from '../lib/reports/cover'

const args = process.argv.slice(2)
const ids = args.filter((a) => !a.startsWith('--'))
if (!ids.length) { console.error('give at least one snapshot id'); process.exit(2) }

interface Finding { ok: boolean; name: string; note?: string }

function evaluate(data: DocumentSnapshotData, workings: DocumentWorkings | null): Finding[] {
  const out: Finding[] = []
  const f = (name: string, ok: boolean, note?: string) => out.push({ name, ok, note })
  const kinds = data.pages.map((p) => p.kind)
  const order = ['in_short', 'finding', 'competitor', 'personas', 'language', 'method']
  const ranks = kinds.map((k) => order.indexOf(k))
  f('pages in skeleton order', ranks.every((r, i) => i === 0 || r >= ranks[i - 1]), kinds.join(' · '))
  f('overview first, method last', kinds[0] === 'in_short' && kinds[kinds.length - 1] === 'method')
  const findings = data.pages.filter((p) => p.kind === 'finding')
  f('one to four findings', findings.length >= 1 && findings.length <= 4, `${findings.length}`)
  const digitRe = /\d/
  let digits = 0, dashes = 0, unresolved = 0, quotesWithText = 0, overCap = 0
  const over: string[] = []
  const known = new Set(Object.keys(data.figures))
  for (const p of data.pages) {
    for (const b of p.blocks) {
      const texts = [b.text, ...(b.items ?? [])].filter(Boolean)
      for (const t of texts) {
        const stripped = t.replace(FIGURE_KEY_RE, '')
        if (p.kind !== 'method' && b.field !== 'heard' && b.field !== 'sure' && digitRe.test(stripped.replace(/\b[A-Z]?[a-z]*\d[\w-]*\b/g, ''))) digits++
        if (/[—–]/.test(t)) dashes++
        for (const m of t.matchAll(FIGURE_KEY_RE)) if (!known.has(m[1])) unresolved++
        const cap = b.field === 'sure' ? 0 : DOCUMENT_BLOCK_MAX[b.field]
        if (cap && t.length > cap * 1.15) { overCap++; over.push(`${b.id} ${t.length}/${cap}`) }
      }
      if (b.quote && b.quote.text) quotesWithText++
    }
  }
  f('no digit outside a placeholder in machine prose', digits === 0, `${digits} block texts`)
  f('no em or en dash anywhere', dashes === 0, `${dashes}`)
  f('every [[key]] resolves', unresolved === 0, `${unresolved} unresolved`)
  f('every pull quote is a ref with empty text', quotesWithText === 0, `${quotesWithText} with text`)
  f('blocks within their caps (15% grace)', overCap === 0, overCap ? over.join(', ') : 'all within')
  f('a method block with items', data.pages.some((p) => p.kind === 'method' && p.blocks.some((b) => (b.items?.length ?? 0) > 0)))
  if (workings) {
    const pointIds = new Set(workings.points.map((p) => p.id))
    const concernIds = new Set(workings.concerns.map((_, i) => `S${i + 1}`))
    const fb = workings.blocks.filter((b) => /^f\d+\./.test(b.blockId))
    f('every finding block rests on known points or concerns', fb.every((b) => b.basedOn.length > 0 && b.basedOn.every((id) => pointIds.has(id) || concernIds.has(id))), `${fb.length} finding blocks`)
    const heads = fb.filter((b) => b.blockId.endsWith('.headline'))
    f('check verdicts recorded on every finding', heads.every((b) => b.check === 'echoes' || b.check === 'silent'), heads.map((b) => b.check ?? 'none').join(','))
    const carried = heads.filter((b) => b.continuedFrom).length
    console.log(`  · continuity: ${carried}/${heads.length} findings carried from the previous brief`)
    const wq = workings.points.flatMap((p) => p.quotes).filter((q) => q.text).length
    f('no quote text in the workings at rest', wq === 0, `${wq}`)
  } else f('workings present', false)
  return out
}

async function main() {
  const admin = createAdminClient()
  let failed = 0
  for (const id of ids) {
    const { data: row } = await admin.from('report_snapshots').select('id, client_id, data, workings').eq('id', id).maybeSingle()
    if (!row || !isDocumentData(row.data)) { console.log(`✗ ${id}: not a document snapshot`); failed++; continue }
    const res = evaluate(row.data, (row.workings as DocumentWorkings | null) ?? null)
    console.log(`\n${id.slice(0, 8)} · ${row.data.title} · ${row.data.pages.length + 1} pages`)
    for (const r of res) { console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.note ? ` (${r.note})` : ''}`); if (!r.ok) failed++ }
  }
  if (args.includes('--json')) console.log(JSON.stringify({ failed }))
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
