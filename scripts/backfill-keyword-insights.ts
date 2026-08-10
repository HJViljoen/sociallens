import { createAdminClient, selectAll } from '../lib/supabase-admin'
import { attributeRunKeywords } from '../lib/pipeline/keyword-attribution'

// One-off backfill of keyword_performance.insights_contributed for runs that
// predate the keyword-attribution pipeline step (2026-08-10).
//
// HONESTY CAVEAT: gather full-replaces videos.source_keywords on every re-find,
// so for OLD runs the current keyword list is a proxy for what found the video
// back then — exact where the keyword config hasn't changed, an estimate where
// it has. Forward runs (the pipeline step) are exact. Runs whose analysis never
// completed legitimately backfill to 0.
//
//   node --env-file=.env.local --import tsx scripts/backfill-keyword-insights.ts [--client <uuid>] [--no-persist]

function parseArgs(argv: string[]): { clientId: string | null; persist: boolean } {
  const args = { clientId: null as string | null, persist: true }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--client') args.clientId = argv[++i]
    else if (argv[i] === '--no-persist') args.persist = false
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  return args
}

async function main() {
  const { clientId, persist } = parseArgs(process.argv.slice(2))
  const admin = createAdminClient()

  const data = await selectAll<{ client_id: string; run_id: string }>(() =>
    admin.from('keyword_performance').select('client_id, run_id').order('id'),
  )
  const targets = new Map<string, Set<string>>()
  for (const r of data) {
    if (clientId && r.client_id !== clientId) continue
    const runs = targets.get(r.client_id) ?? new Set<string>()
    runs.add(r.run_id)
    targets.set(r.client_id, runs)
  }
  if (targets.size === 0) {
    console.log('nothing to backfill — no keyword_performance rows matched')
    return
  }
  if (!persist) console.log('--no-persist: computing only, no writes\n')

  const summary: Record<string, unknown>[] = []
  for (const [client, runs] of targets) {
    for (const runId of runs) {
      const r = await attributeRunKeywords(admin, client, runId, { persist })
      summary.push({
        client: client.slice(0, 8),
        run: runId.slice(0, 8),
        insights: r.insights,
        'kp rows': r.kpRows,
        'pairs w/ insights': r.attributed,
      })
    }
  }
  console.table(summary)
  console.log(persist ? 'written — keyword-roi.ts now reflects insights_contributed' : 'dry run — re-run without --no-persist to write')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
