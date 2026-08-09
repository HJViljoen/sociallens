import { runStepA2, loadGroupedInsights } from '../lib/pipeline/step-a2'
import { similarityMatrix, type ClusterMethod } from '../lib/pipeline/cluster'
import { CLUSTER_SIMILARITY_THRESHOLD, EVIDENCE_FLOOR } from '../lib/config'

// CLI inspector for Step A2 (theme aggregation). Run with env loaded:
//   node --env-file=.env.local --import tsx scripts/run-a2.ts --run <id> [flags]
//
// Flags:
//   --run <uuid>         analysis run id to aggregate (required)
//   --client <uuid>      client_id (default: Ossur)
//   --method <name>      embedding | string (default: embedding)
//   --threshold <n>      cosine merge threshold for embedding (default: config)
//   --floor <n>          min distinct supporting videos to survive (default: config)
//   --no-merge           skip the LLM label-merge pass (A/B against raw clustering)
//   --merge-model <m>    model for the merge pass (default: config SYNTHESIS_MODEL)
//   --debug              print the per-group pairwise similarity matrix and exit
//                        (use this to tune --threshold against real data)

const OSSUR = 'e52cac94-30e1-426a-9a36-31b11e0b30b6'

interface Args {
  clientId: string
  runId?: string
  method?: ClusterMethod
  threshold?: number
  floor?: number
  noMerge: boolean
  mergeModel?: string
  debug: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { clientId: OSSUR, noMerge: false, debug: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--run') args.runId = next()
    else if (a === '--client') args.clientId = next()
    else if (a === '--method') args.method = next() as ClusterMethod
    else if (a === '--threshold') args.threshold = Number(next())
    else if (a === '--floor') args.floor = Number(next())
    else if (a === '--no-merge') args.noMerge = true
    else if (a === '--merge-model') args.mergeModel = next()
    else if (a === '--debug') args.debug = true
    else throw new Error(`unknown flag: ${a}`)
  }
  if (!args.runId) throw new Error('--run <uuid> is required')
  return args
}

async function debugMatrix(clientId: string, runId: string, threshold: number) {
  const { groups } = await loadGroupedInsights(clientId, runId)
  console.log(`\nSimilarity matrix — threshold ${threshold} (pairs >= it merge)\n`)
  for (const g of groups) {
    if (g.insights.length < 2) {
      console.log(`[${g.bucket}] 1 insight: ${g.insights[0].theme} — (singleton)`)
      continue
    }
    console.log(`[${g.bucket}] ${g.insights.length} insights:`)
    g.insights.forEach((ins, i) => console.log(`  ${i + 1}. ${ins.theme} (${ins.category})`))
    const m = await similarityMatrix(g.insights)
    for (let i = 0; i < g.insights.length; i++) {
      for (let j = i + 1; j < g.insights.length; j++) {
        const sim = m[i][j]
        const mark = sim >= threshold ? ' <= MERGE' : ''
        console.log(`     ${i + 1}~${j + 1}  ${sim.toFixed(3)}${mark}`)
      }
    }
    console.log('')
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const method = args.method ?? 'embedding'
  const threshold = args.threshold ?? CLUSTER_SIMILARITY_THRESHOLD
  const floor = args.floor ?? EVIDENCE_FLOOR
  console.log(`Step A2 — run=${args.runId} method=${method} threshold=${threshold} floor=${floor}`)

  if (args.debug) {
    await debugMatrix(args.clientId, args.runId!, threshold)
    return
  }

  const result = await runStepA2({
    clientId: args.clientId,
    runId: args.runId!,
    method,
    threshold,
    evidenceFloor: floor,
    merge: !args.noMerge,
    mergeModel: args.mergeModel,
  })

  if (result.mergesApplied.length) {
    console.log(`\n=== LABEL MERGES APPLIED — ${result.mergesApplied.length} (cost $${result.mergeCostUsd.toFixed(4)}) ===`)
    for (const m of result.mergesApplied) {
      console.log(`[${m.bucket}] ${m.members.join('  +  ')}`)
      console.log(`    ${m.reason}`)
    }
  }

  console.log(`\n=== SURVIVING THEMES (>= floor ${floor}) — ${result.themes.length} ===`)
  for (const t of result.themes) {
    const members = t.memberThemes.join(', ')
    console.log(
      `[${t.bucket} / ${t.category}] ${t.theme}  ·  ${t.evidenceCount} videos · strength ${t.strengthScore} · ${t.dominantEmotion}/${t.dominantSentimentImpact}`,
    )
    if (t.memberThemes.length > 1) console.log(`    merged: ${members}`)
  }

  console.log(`\n=== EARLY SIGNALS (below floor, kept + badged) — ${result.earlySignals.length} ===`)
  for (const t of result.earlySignals) {
    console.log(`[${t.bucket} / ${t.category}] ${t.theme}  ·  ${t.evidenceCount} video(s) · strength ${t.strengthScore}`)
  }

  console.log('\n=== SUMMARY ===')
  console.log(`insights in:       ${result.totalInsights}`)
  console.log(`clusters formed:   ${result.totalClusters}`)
  console.log(`survived floor:    ${result.themes.length}`)
  console.log(`early signals:     ${result.earlySignals.length}`)
}

main().catch((e) => {
  console.error('Step A2 failed:', e)
  process.exit(1)
})
