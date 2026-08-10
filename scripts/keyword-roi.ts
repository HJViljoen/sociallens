import { createAdminClient } from '../lib/supabase-admin'
import { APIFY_COST_ESTIMATES } from '../lib/config'

// Operator read of keyword ROI across every gathered run — the pruning tool.
// keyword_performance is written by gather (analysis-only re-runs add nothing),
// so each row is one (run, platform, keyword) gather outcome; the pipeline's
// keyword-attribution step (2026-08-10) fills insights_contributed after
// synthesis. Aggregates per (platform, keyword) — the data says ROI lives on
// that axis, not keyword alone. Prints worst-relevance-first with an estimated
// Apify spend ($est, coarse ranking constants from lib/config.ts — not an
// invoice) and a DROP-CANDIDATE marker. Run with env loaded:
//   node --env-file=.env.local --import tsx scripts/keyword-roi.ts [--client <uuid>]
// No --client: every client with keyword_performance rows, one table each.

// Drop rule (plan 2026-08-10): pooled over runs where the client's run produced
// any insights at all (excludes gather-only/died-before-analysis runs, which
// would otherwise fake a 0-insight signal), a (platform, keyword) is a
// DROP-CANDIDATE when: ≥3 such runs, pooled survival <5%, pooled found ≥100,
// pooled insights 0. Per-platform by construction — a keyword can be dropped
// on Instagram and kept on YouTube.
const DROP_MIN_RUNS = 3
const DROP_MAX_SURVIVAL = 0.05
const DROP_MIN_FOUND = 100

function parseArgs(argv: string[]): { clientId: string | null } {
  const args = { clientId: null as string | null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--client') args.clientId = argv[++i]
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  return args
}

interface KpRow {
  run_id: string
  platform: string
  keyword: string
  bucket: string
  videos_found: number
  gate_survived: number
  eligible_videos: number
  insights_contributed: number | null
  value_score: number | string | null
  created_at: string
}

function estRowCost(r: KpRow): number {
  const c = APIFY_COST_ESTIMATES[r.platform]
  if (!c) return 0
  return c.search + r.eligible_videos * c.perVideoComments
}

async function reportClient(clientId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('keyword_performance')
    .select('run_id, platform, keyword, bucket, videos_found, gate_survived, eligible_videos, insights_contributed, value_score, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as KpRow[]
  if (rows.length === 0) {
    console.log(`client ${clientId}: no keyword_performance rows — no gathered runs yet\n`)
    return
  }

  // Runs whose whole client run produced at least one attributed insight —
  // the only runs the drop rule may pool over.
  const insightsByRun = new Map<string, number>()
  for (const r of rows) {
    insightsByRun.set(r.run_id, (insightsByRun.get(r.run_id) ?? 0) + (r.insights_contributed ?? 0))
  }
  const insightfulRuns = new Set([...insightsByRun].filter(([, n]) => n > 0).map(([id]) => id))

  const runs = new Set(rows.map((r) => r.run_id))
  const first = rows[0].created_at.slice(0, 10)
  const last = rows[rows.length - 1].created_at.slice(0, 10)
  console.log(`client ${clientId} · ${runs.size} gathered run${runs.size === 1 ? '' : 's'} (${insightfulRuns.size} with insights) · ${first} → ${last}\n`)

  interface Agg {
    platform: string
    keyword: string
    bucket: string
    runs: Set<string>
    insightfulRuns: Set<string>
    found: number
    survived: number
    insightfulFound: number
    insightfulSurvived: number
    insights: number
    est: number
    scoreSum: number
    scoreN: number
  }
  const byPair = new Map<string, Agg>()
  for (const r of rows) {
    const key = `${r.platform}::${r.keyword}`
    const agg = byPair.get(key) ?? {
      platform: r.platform, keyword: r.keyword, bucket: r.bucket,
      runs: new Set<string>(), insightfulRuns: new Set<string>(),
      found: 0, survived: 0, insightfulFound: 0, insightfulSurvived: 0,
      insights: 0, est: 0, scoreSum: 0, scoreN: 0,
    }
    agg.runs.add(r.run_id)
    agg.found += r.videos_found
    agg.survived += r.gate_survived
    agg.insights += r.insights_contributed ?? 0
    agg.est += estRowCost(r)
    if (insightfulRuns.has(r.run_id)) {
      agg.insightfulRuns.add(r.run_id)
      agg.insightfulFound += r.videos_found
      agg.insightfulSurvived += r.gate_survived
    }
    if (r.value_score != null) {
      agg.scoreSum += Number(r.value_score)
      agg.scoreN += 1
    }
    byPair.set(key, agg)
  }

  const isDrop = (a: Agg) =>
    a.insightfulRuns.size >= DROP_MIN_RUNS &&
    a.insightfulFound >= DROP_MIN_FOUND &&
    (a.insightfulFound > 0 ? a.insightfulSurvived / a.insightfulFound : 0) < DROP_MAX_SURVIVAL &&
    a.insights === 0

  const table = [...byPair.values()]
    .map((a) => ({
      platform: a.platform,
      keyword: a.keyword,
      bucket: a.bucket,
      runs: a.runs.size,
      found: a.found,
      relevant: a.survived,
      'rate %': a.found > 0 ? Math.round((a.survived / a.found) * 100) : 0,
      insights: a.insights,
      '$est': a.est.toFixed(2),
      'avg score': a.scoreN > 0 ? (a.scoreSum / a.scoreN).toFixed(1) : '—',
      'DROP?': isDrop(a) ? 'DROP-CANDIDATE' : '',
    }))
    .sort((a, b) => a['rate %'] - b['rate %'] || b.found - a.found)

  console.table(table)
  console.log('sorted worst relevance first · rate = gate_survived / videos_found at gather time · $est = coarse Apify ranking estimate, not an invoice')
  console.log(`DROP-CANDIDATE: ≥${DROP_MIN_RUNS} insight-bearing runs, <${DROP_MAX_SURVIVAL * 100}% survival, ≥${DROP_MIN_FOUND} found, 0 insights — judged per platform\n`)
}

async function main() {
  const { clientId } = parseArgs(process.argv.slice(2))
  if (clientId) return reportClient(clientId)

  const admin = createAdminClient()
  const { data, error } = await admin.from('keyword_performance').select('client_id')
  if (error) throw new Error(error.message)
  const clients = [...new Set((data ?? []).map((r) => r.client_id as string))]
  if (clients.length === 0) {
    console.log('no keyword_performance rows anywhere — no gathered runs yet')
    return
  }
  for (const id of clients) await reportClient(id)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
