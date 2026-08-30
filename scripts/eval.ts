/**
 * The eval contract (Tier 1, 2026-08-18).
 *
 * Verbatim had no ground truth anywhere: every calibration was
 * embedding-vs-embedding, and the six existing measurement scripts report
 * counts or deltas, never a correctness rate. This is the first thing in the
 * product that can say "the analysis is this good, and here is the number".
 *
 * It starts with the truth we already own rather than waiting on a labelling
 * effort:
 *
 *   1. GROUNDING — every stored insight quote must appear verbatim in the
 *      comment it cites. Pass A enforces this at write time and then never
 *      re-checks it, and it keeps nothing about what it rejected. This
 *      re-verifies the whole stored corpus using the pipeline's own
 *      normaliser, so the number cannot drift from what production enforces.
 *
 *   2. VALIDATION HISTORY — what ai_call_log already recorded about calls that
 *      failed their quote check or failed to parse.
 *
 *   3. STABILITY — theme identity agreement across runs, from
 *      theme_observations.match_kind. Empty until the registry seeds.
 *
 *   4. GATE — the relevance verdicts recorded by T1-7, once a gather has run.
 *
 * Read-only. No model calls, so it costs nothing to run.
 *
 * Usage:  npx tsx scripts/eval.ts [--client <uuid>] [--floor 0.95] [--json]
 */
import { createAdminClient, selectAll } from '../lib/supabase-admin'
import { reportGrounding, type EvidenceRow } from '../lib/eval/grounding'
import { cadenceReliability, formatCadence } from '../lib/pipeline/cadence'
import { EVAL_GROUNDING_FLOOR } from '../lib/config'

interface Args { clientId?: string; floor: number; json: boolean }

/** Run a query whose table may not exist in this environment yet. A missing
 *  table is a migration state, not an error worth aborting the whole report
 *  for; anything else still throws. */
async function optional<T>(fn: () => Promise<T[]>): Promise<T[] | null> {
  try {
    return await fn()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Table-level only: a missing COLUMN on an existing table is a real bug
    // and must not be reported as "not migrated here".
    if (/Could not find the table|relation .* does not exist/i.test(msg)) return null
    throw e
  }
}

function parseArgs(argv: string[]): Args {
  const a: Args = { floor: EVAL_GROUNDING_FLOOR, json: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--client') a.clientId = argv[++i]
    else if (argv[i] === '--floor') {
      // NaN would make `rate < floor` always false and silently disable the
      // only floor this harness has.
      const v = Number(argv[++i])
      if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error(`--floor must be between 0 and 1`)
      a.floor = v
    }
    else if (argv[i] === '--json') a.json = true
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  return a
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const admin = createAdminClient()

  const clients = await selectAll<{ id: string; company_name: string }>(() => {
    // Ordered by id: selectAll pages by range, so a non-unique sort key can
    // repeat or skip rows across pages.
    let q = admin.from('clients').select('id, company_name').order('id', { ascending: true })
    if (args.clientId) q = q.eq('id', args.clientId)
    return q
  })
  if (!clients.length) {
    console.error(args.clientId ? `No client matches ${args.clientId}.` : 'No clients found.')
    process.exit(1)
  }

  const results: Record<string, unknown> = {}
  let failed = false

  for (const client of clients) {
    // ---- 1. Grounding over the stored corpus --------------------------------
    // redacted = false: demographic_signal evidence cites but never quotes
    // (counts-not-quotes, 2026-08-22) — quote is '' by design, not a grounding
    // failure.
    const evidence = await selectAll<{ id: string; quote: string; comment_id: string | null }>(() =>
      admin.from('insight_evidence').select('id, quote, comment_id, audience_insights!inner(client_id)')
        .eq('audience_insights.client_id', client.id).eq('source', 'comment').eq('redacted', false).order('id'),
    )
    const commentIds = [...new Set(evidence.map((e) => e.comment_id).filter((x): x is string => Boolean(x)))]
    const textById = new Map<string, string>()
    for (let i = 0; i < commentIds.length; i += 200) {
      const rows = await selectAll<{ id: string; text: string | null }>(() =>
        admin.from('comments').select('id, text').in('id', commentIds.slice(i, i + 200)).order('id'),
      )
      for (const r of rows) if (r.text) textById.set(r.id, r.text)
    }
    const rows: EvidenceRow[] = evidence.map((e) => ({
      id: e.id,
      quote: e.quote,
      commentText: e.comment_id ? textById.get(e.comment_id) ?? null : null,
    }))
    const grounding = reportGrounding(rows)

    // ---- 2. What validation already recorded --------------------------------
    const calls = await selectAll<{ validation_status: string | null }>(() =>
      admin.from('ai_call_log').select('validation_status').eq('client_id', client.id).eq('pass', 'pass_a').order('id'),
    )
    const validation = calls.reduce<Record<string, number>>((acc, c) => {
      const k = c.validation_status ?? 'null'
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})

    // ---- 3. Theme identity stability ----------------------------------------
    // Tolerant of a table that has not been migrated yet: this is an operator
    // tool, and it must still report the checks it CAN do on an environment
    // that is a migration behind rather than dying on the first missing one.
    const obs = await optional<{ match_kind: string }>(() =>
      selectAll<{ match_kind: string }>(() =>
        admin.from('theme_observations').select('match_kind').eq('client_id', client.id).order('id'),
      ),
    )
    const stability = (obs ?? []).reduce<Record<string, number>>((acc, o) => {
      acc[o.match_kind] = (acc[o.match_kind] ?? 0) + 1
      return acc
    }, {})

    // ---- 3b. Did the weekly update actually arrive? -------------------------
    const [runRows, reportRows] = await Promise.all([
      selectAll<{ id: string; status: string; options: { sendReport?: boolean } | null; completed_at: string | null }>(() =>
        admin.from('pipeline_runs').select('id, status, options, completed_at')
          .eq('client_id', client.id).order('id', { ascending: true }),
      ),
      selectAll<{ run_id: string | null; sent_at: string | null }>(() =>
        admin.from('report_sends').select('run_id, sent_at')
          .eq('client_id', client.id).eq('status', 'sent').order('sent_at', { ascending: true }),
      ),
    ])
    const cadence = cadenceReliability(
      runRows.map((r) => ({ id: r.id, status: r.status, options: r.options, completedAt: r.completed_at })),
      reportRows.map((r) => ({ runId: r.run_id, sentAt: r.sent_at })),
    )

    // ---- 4. Gate verdicts ---------------------------------------------------
    const verdicts = await optional<{ kept: boolean; source: string }>(() =>
      selectAll<{ kept: boolean; source: string }>(() =>
        admin.from('gate_verdicts').select('kept, source').eq('client_id', client.id).order('id'),
      ),
    )
    const gate = verdicts === null
      ? { migrated: false, judged: 0, kept: 0, dropped: 0, failedOpen: 0 }
      : {
          migrated: true,
          judged: verdicts.length,
          kept: verdicts.filter((v) => v.kept).length,
          dropped: verdicts.filter((v) => !v.kept).length,
          failedOpen: verdicts.filter((v) => v.source === 'default').length,
        }

    results[client.id] = { client: client.company_name, grounding, validation, stability, gate, cadence }

    if (!args.json) {
      console.log(`\n=== ${client.company_name} ===`)
      console.log(`grounding    ${grounding.grounded}/${grounding.grounded + grounding.notFound} quotes verify (${(grounding.rate * 100).toFixed(1)}%)` +
        `  · orphaned ${grounding.orphaned} · empty ${grounding.empty} · total ${grounding.total}`)
      if (grounding.failures.length) {
        console.log('  quotes that no longer verify:')
        for (const f of grounding.failures) console.log(`    - ${f.id}: "${f.quote}"`)
      }
      console.log(`pass A calls ${Object.entries(validation).map(([k, v]) => `${k}=${v}`).join(' · ') || '(none)'}`)
      console.log(`theme match  ${Object.entries(stability).map(([k, v]) => `${k}=${v}`).join(' · ') || (obs === null ? '(table not migrated here)' : '(registry has not seeded yet)')}`)
      console.log(`cadence      ${formatCadence(client.company_name, cadence).replace(`${client.company_name}: `, '')}`)
      console.log(`gate         ${!gate.migrated ? '(table not migrated here)' : gate.judged ? `${gate.kept} kept / ${gate.dropped} dropped · ${gate.failedOpen} failed open` : '(no gather since verdict recording shipped)'}`)
    }

    // The contract: grounding is the one number with a real floor today,
    // and only when there is enough of it to mean anything.
    const checkable = grounding.grounded + grounding.notFound
    if (checkable >= 100 && grounding.rate < args.floor) {
      console.error(`FAIL ${client.company_name}: grounding ${grounding.rate} below floor ${args.floor}`)
      failed = true
    }
  }

  if (args.json) console.log(JSON.stringify(results, null, 2))
  if (failed) {
    console.error('\nEval FAILED. A quote that does not appear in the comment it cites is the product\'s core promise breaking.')
    process.exit(1)
  }
  console.log('\nEval passed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
