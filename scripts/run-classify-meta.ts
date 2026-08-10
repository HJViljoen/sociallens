import { planClassifyMetaBatches, runClassifyMetaBatch } from '../lib/pipeline/classify-meta'

// Operator run of the metadata-classification batch outside the pipeline —
// backfill a run's corpus, or verify the pass before a scheduled run
// exercises it. COSTS OPENAI MONEY: ~$0.10 per ~400 unclassified videos
// (gpt-4.1-mini). --plan-only previews the batch count for free.
// CAVEAT for past runs: gather restamps videos.run_id on every re-find, so an
// old run id only reaches videos not re-found since — partial by construction.
// The latest run always covers its full corpus.
//   node --env-file=.env.local --import tsx scripts/run-classify-meta.ts \
//     --client <uuid> --run <uuid> [--max-batches N] [--plan-only]

function parseArgs(argv: string[]) {
  const args = { clientId: '', runId: '', maxBatches: Infinity, planOnly: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--client') args.clientId = argv[++i]
    else if (argv[i] === '--run') args.runId = argv[++i]
    else if (argv[i] === '--max-batches') args.maxBatches = Number(argv[++i])
    else if (argv[i] === '--plan-only') args.planOnly = true
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  if (!args.clientId || !args.runId) throw new Error('--client and --run are required')
  return args
}

async function main() {
  const { clientId, runId, maxBatches, planOnly } = parseArgs(process.argv.slice(2))
  const batches = await planClassifyMetaBatches(clientId, runId)
  const pending = batches.reduce((n, b) => n + b.length, 0)
  console.log(`${pending} unclassified videos in ${batches.length} batches`)
  if (planOnly || batches.length === 0) return

  const summary: Record<string, unknown>[] = []
  let cost = 0
  for (const [i, ids] of batches.slice(0, maxBatches).entries()) {
    const r = await runClassifyMetaBatch(clientId, runId, ids, i + 1)
    cost += r.costUsd
    summary.push({ batch: i + 1, requested: r.requested, classified: r.classified, nulls: r.nulls, '$': r.costUsd.toFixed(3), error: r.error ?? '' })
  }
  console.table(summary)
  console.log(`total $${cost.toFixed(2)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
