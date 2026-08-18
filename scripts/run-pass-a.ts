import { runPassA, type RunPassAOptions } from '../lib/pipeline/pass-a'

// CLI runner for Pass A iteration. Run with env loaded:
//   node --env-file=.env.local --import tsx scripts/run-pass-a.ts [flags]
//
// Flags:
//   --client <uuid>      client_id (default: Ossur)
//   --platform <name>    platform filter (default: all platforms)
//   --run <uuid>         reuse an existing analysis run id (idempotent re-runs)
//   --limit <n>          cap videos processed (most-commented first)
//   --video <id>         process only this videos.id (repeatable)
//   --min-comments <n>   min kept comments per call (default 5)
//   --dry-run            assemble prompts + estimate tokens, no API calls / writes
//   --no-persist         run live calls but don't write to DB

const OSSUR = 'e52cac94-30e1-426a-9a36-31b11e0b30b6'

function parseArgs(argv: string[]): RunPassAOptions & { dryRun: boolean } {
  const opts: RunPassAOptions & { dryRun: boolean } = {
    clientId: OSSUR,
    // No platform default → analyse all platforms (IG + TT + YT). Pass --platform
    // only to scope to one.
    dryRun: false,
  }
  const videoIds: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--client') opts.clientId = next()
    else if (a === '--platform') opts.platform = next()
    else if (a === '--run') opts.runId = next()
    else if (a === '--limit') opts.limit = Number(next())
    else if (a === '--video') videoIds.push(next())
    else if (a === '--min-comments') opts.minComments = Number(next())
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--no-persist') opts.persist = false
    else throw new Error(`unknown flag: ${a}`)
  }
  if (videoIds.length) opts.videoIds = videoIds
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  console.log(
    `Pass A — client=${opts.clientId} platform=${opts.platform ?? 'all'} ` +
      `limit=${opts.limit ?? '∞'} dryRun=${opts.dryRun}`,
  )
  const summary = await runPassA(opts)

  console.log('\n=== SUMMARY ===')
  console.log(`run id:            ${summary.runId}`)
  console.log(`model:             ${summary.model}`)
  console.log(`videos processed:  ${summary.videosProcessed}`)
  console.log(`  analyzed:        ${summary.videosAnalyzed} (claims lane: ${summary.videosClaimsOnly})`)
  console.log(`  skipped (<min):  ${summary.videosSkipped}`)
  console.log(`  errored:         ${summary.videosErrored}${summary.rateLimited ? ' (incl. 429)' : ''}  refused: ${summary.videosRefused}  already done this run: ${summary.videosAlreadyAnalyzed}`)
  if (summary.errors.length) console.log(`  first errors:    ${summary.errors.join(' | ')}`)
  console.log(`insights kept:     ${summary.insightsKept}`)
  console.log(`insights dropped:  ${summary.insightsDropped}`)
  console.log(`evidence dropped:  ${summary.evidenceDropped}`)
  if (summary.dryRun) {
    console.log(`est. input tokens: ${summary.estInputTokens} (~$${(summary.estInputTokens / 1e6 * 0.4).toFixed(5)} input @ gpt-4.1-mini)`)
  } else {
    console.log(`tokens:            ${summary.promptTokens} in + ${summary.completionTokens} out`)
    console.log(`COST THIS RUN:     $${summary.costUsd.toFixed(5)}`)
  }
}

main().catch((e) => {
  console.error('Pass A failed:', e)
  process.exit(1)
})
