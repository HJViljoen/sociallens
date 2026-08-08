import { createAdminClient, selectAll } from '../lib/supabase-admin'
import { computeMetrics } from '../lib/pipeline/metrics'
import { runStepA2 } from '../lib/pipeline/step-a2'
import { runPassB } from '../lib/pipeline/pass-b'
import { runPassC } from '../lib/pipeline/pass-c'
import { runPassD } from '../lib/pipeline/pass-d'
import { runCrossReference } from '../lib/pipeline/cross-reference'
import { loadBrandClaims } from '../lib/pipeline/claims'
import { persistThemes } from '../lib/pipeline/themes'
import { writeRunSummary } from '../lib/pipeline/run-summary'
import { resolveGatherWindow, inWindow } from '../lib/gather/gather'
import { CLUSTER_SIMILARITY_THRESHOLD, EVIDENCE_FLOOR } from '../lib/config'
import type { ClusterMethod } from '../lib/pipeline/cluster'
import type { VideoRow, CommentRow } from '../lib/pipeline/types'

// CLI orchestrator for the back half of the analysis chain: cross-reference →
// Step A2 → Pass B → themes → Pass C → Pass D (a+b) → run_summary, over an
// existing Pass A run. Run with env loaded:
//   node --env-file=.env.local --import tsx scripts/run-cd.ts --run <id> [flags]
//
// Flags:
//   --run <uuid>      Pass A run id to aggregate + synthesise (required)
//   --client <uuid>   client_id (default: Ossur)
//   --platform <name> platform for the metrics corpus, or "all" for market-wide SOV (default: tiktok)
//   --method <name>   embedding | string (A2 clustering; default: embedding)
//   --threshold <n>   A2 cosine merge threshold (default: config)
//   --floor <n>       A2 evidence floor (default: config; use 1 on thin/bucketed data)
//   --dry-run         assemble everything, no GPT calls / writes
//   --no-persist      run GPT calls but don't write C/D results to DB

const OSSUR = 'e52cac94-30e1-426a-9a36-31b11e0b30b6'

interface Args {
  clientId: string
  runId?: string
  platform: string
  method?: ClusterMethod
  threshold?: number
  floor?: number
  dryRun: boolean
  persist: boolean
}

function parseArgs(argv: string[]): Args {
  const a: Args = { clientId: OSSUR, platform: 'tiktok', dryRun: false, persist: true }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = () => argv[++i]
    if (flag === '--run') a.runId = next()
    else if (flag === '--client') a.clientId = next()
    else if (flag === '--platform') a.platform = next()
    else if (flag === '--method') a.method = next() as ClusterMethod
    else if (flag === '--threshold') a.threshold = Number(next())
    else if (flag === '--floor') a.floor = Number(next())
    else if (flag === '--dry-run') a.dryRun = true
    else if (flag === '--no-persist') a.persist = false
    else throw new Error(`unknown flag: ${flag}`)
  }
  if (!a.runId) throw new Error('--run <uuid> is required')
  return a
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const method = args.method ?? 'embedding'
  const threshold = args.threshold ?? CLUSTER_SIMILARITY_THRESHOLD
  const floor = args.floor ?? EVIDENCE_FLOOR
  const persist = args.persist && !args.dryRun
  const admin = createAdminClient()
  console.log(`A2→C→D — run=${args.runId} client=${args.clientId} method=${method} threshold=${threshold} floor=${floor} persist=${persist}`)

  // Metrics corpus: client videos + their comments. `--platform all` spans every
  // platform so Share of Voice is market-wide (correct for a multi-platform run);
  // a named platform scopes the SOV/engagement metrics to that platform only.
  // SoV guard (Owned-Data-Plan): owned-account posts stay out of the
  // discovered-corpus metrics; their comments drop out via wantedVideos below.
  const videos = (await selectAll<VideoRow>(() => {
    let q = admin.from('videos').select('*').eq('client_id', args.clientId)
    if (args.platform !== 'all') q = q.eq('platform', args.platform)
    return q.order('id', { ascending: true })
  })).filter((v) => v.source !== 'owned')
  // Load the client's comments in one paginated scan and filter to the corpus
  // videos IN MEMORY — a `.in('video_id', [all ids])` filter blows the URL length
  // limit once the corpus grows to ~1k+ videos ("fetch failed"). Mirrors pass-a.ts.
  const wantedVideos = new Set(videos.map((v) => `${v.platform}::${v.video_id}`))
  const allComments = await selectAll<CommentRow>(() => {
    let q = admin
      .from('comments')
      .select('id, client_id, run_id, platform, video_id, comment_id, author, text, likes, comment_date')
      .eq('client_id', args.clientId)
      .order('id', { ascending: true })
    if (args.platform !== 'all') q = q.eq('platform', args.platform)
    return q
  })
  const comments = allComments.filter((c) => wantedVideos.has(`${c.platform}::${c.video_id}`))
  const metrics = computeMetrics(videos, comments)

  const { data: tc } = await admin
    .from('tracking_configs')
    .select('brand_keywords, competitor_names, industry_keywords, report_period')
    .eq('client_id', args.clientId)
    .maybeSingle()

  // Period slice — this run's rows, minus rows known older than the report
  // window (mirrors the Inngest synthesis half; null dates stay).
  const window = await resolveGatherWindow(args.clientId, args.runId!, tc?.report_period ?? 'weekly')
  const periodVideos = videos.filter((v) => v.run_id === args.runId && inWindow(v.upload_date, window.since))
  const periodComments = comments.filter((c) => c.run_id === args.runId && inWindow(c.comment_date, window.since))
  const periodMetrics = computeMetrics(periodVideos, periodComments)
  const { data: client } = await admin
    .from('clients')
    .select('company_name')
    .eq('id', args.clientId)
    .maybeSingle()
  const brandName = client?.company_name ?? undefined

  // Brand claims (Step 2b) — all-time, deduped/capped; empty for tenants that
  // have never run Pass A v4.
  const claims = await loadBrandClaims(admin, args.clientId)
  if (claims.client.length || claims.competitors.length) {
    console.log(`\nBrand claims: ${claims.client.length} client · ${claims.competitors.length} competitor`)
  }

  console.log('\nShare of voice:')
  for (const [bucket, e] of Object.entries(metrics.share_of_voice)) console.log(`  ${bucket}: ${e.videos} videos (${e.pct_videos}%)`)

  // Cross-reference detection (deterministic, corpus-wide; skipped on dry runs).
  if (persist) {
    const xr = await runCrossReference(args.clientId)
    console.log(`\nCross-reference: ${xr.commentsScanned} comments on non-client videos scanned → ${xr.mentionsFlagged} brand mentions flagged (${xr.flagsCleared} stale flags cleared)`)
  }

  // Step A2.
  const a2 = await runStepA2({ clientId: args.clientId, runId: args.runId!, method, threshold, evidenceFloor: floor })
  console.log(`\nStep A2: ${a2.totalInsights} insights → ${a2.totalClusters} clusters → ${a2.themes.length} survive floor ${floor} + ${a2.earlySignals.length} early signals`)
  for (const t of a2.themes) console.log(`  [${t.bucket} / ${t.category}] ${t.theme} · ${t.evidenceCount} videos · str ${t.strengthScore}`)
  for (const t of a2.earlySignals) console.log(`  (early) [${t.bucket} / ${t.category}] ${t.theme} · ${t.evidenceCount} video(s) · str ${t.strengthScore}`)

  // Pass B — label both tiers, then persist themes with first_seen matching.
  const allThemes = [...a2.themes, ...a2.earlySignals]
  const b = await runPassB({ clientId: args.clientId, runId: args.runId!, themes: allThemes, brandName, persist, dryRun: args.dryRun })
  console.log(`\n=== PASS B — theme labels (${b.labelled} labelled, ${b.fallbacks} fallbacks) ===`)
  for (const t of allThemes) console.log(`  ${t.label}${t.singleSource ? ' (early signal)' : ''} — ${t.description ?? ''}`)
  if (persist) {
    const pt = await persistThemes(args.clientId, args.runId!, allThemes)
    console.log(`Themes persisted: ${pt.inserted} (${pt.hadPreviousRun ? `${pt.firstSeen} new vs previous run` : 'first themed run — no "New" baseline yet'})`)
  }

  // Pass C.
  const c = await runPassC({
    clientId: args.clientId,
    runId: args.runId!,
    themes: a2.themes,
    trackingConfig: tc ?? undefined,
    brandName,
    sov: metrics.share_of_voice,
    competitorClaims: claims.competitors,
    persist,
    dryRun: args.dryRun,
  })
  console.log(`\n=== PASS C — competitive insights (${c.inserted}) ===`)
  if (c.skippedReason) console.log(`  (skipped: ${c.skippedReason})`)
  for (const ci of c.competitiveInsights) {
    console.log(`  [${ci.category}${ci.competitor_name ? ` vs ${ci.competitor_name}` : ''}] ${ci.title} (${ci.impact_level})`)
    console.log(`     ${ci.finding}`)
  }
  if (c.rejectedRefs) console.log(`  (rejected theme refs: ${c.rejectedRefs})`)

  // Pass D.
  const d = await runPassD({
    clientId: args.clientId,
    runId: args.runId!,
    themes: a2.themes,
    competitiveInsights: c.competitiveInsights,
    brandName,
    sov: metrics.share_of_voice,
    clientClaims: claims.client,
    persist,
    dryRun: args.dryRun,
  })
  console.log(`\n=== PASS D-a — market insights (${d.marketInsights.length}) ===`)
  for (const mi of d.marketInsights) {
    console.log(`  [${mi.insight_type}] ${mi.title} · conf ${mi.confidence_score} / opp ${mi.opportunity_score}`)
  }
  if (d.ciSummary) {
    console.log('\n=== PASS D-a — consumer intelligence summary ===')
    console.log(`  unmet needs:     ${d.ciSummary.top_unmet_needs.join(' | ') || '(none)'}`)
    console.log(`  buying triggers: ${d.ciSummary.top_buying_triggers.join(' | ') || '(none)'}`)
    console.log(`  differentiators: ${d.ciSummary.top_differentiators.join(' | ') || '(none)'}`)
    console.log(`  mood:            ${d.ciSummary.emotional_snapshot}`)
    console.log(`  threats:         ${d.ciSummary.threats.join(' | ') || '(none)'}`)
  }
  console.log('\n=== PASS D-a — executive brief (render substitutes [[n]]) ===')
  if (d.executiveBrief) {
    console.log(`  headline: ${d.executiveBrief.headline_finding}`)
    for (const beat of d.executiveBrief.narrative) console.log(`  · [${beat.metric}] ${beat.text}`)
  } else {
    console.log('  (none produced — dashboard will use the code-composed fallback)')
  }
  console.log(`\n=== PASS D-b — recommendations (${d.recommendations.length}) ===`)
  for (const r of d.recommendations) {
    console.log(`  [${r.type} · ${r.priority}] ${r.title}`)
  }
  if (d.rejectedRefs) console.log(`  (rejected refs: ${d.rejectedRefs})`)

  // run_summary — metrics + sentiment + CI summary; the email-delta baseline.
  if (persist) {
    await writeRunSummary({
      clientId: args.clientId, runId: args.runId!, metrics, videos,
      periodMetrics, periodVideos,
      ciSummary: d.ciSummary, executiveBrief: d.executiveBrief, period: tc?.report_period ?? null,
    })
    console.log('\nrun_summary written.')
  }

  // Close the run lifecycle. Pass A opens analysis runs as 'analyzing' and never
  // flips them; run-cd is the terminal analysis stage, so it marks completion.
  // (Phase 3 / Inngest will own this end-to-end.) Skipped on dry/no-persist runs.
  if (persist) {
    const { error: statusErr } = await admin.from('pipeline_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', args.runId!)
    if (statusErr) console.warn(`! could not mark run completed: ${statusErr.message}`)
    else console.log(`\nRun ${args.runId!.slice(0, 8)} marked completed.`)
  }

  const totalCost = b.costUsd + c.costUsd + d.costUsd
  console.log('\n=== SUMMARY ===')
  console.log(`pass B cost: $${b.costUsd.toFixed(5)} (${b.promptTokens}+${b.completionTokens} tok)`)
  console.log(`pass C cost: $${c.costUsd.toFixed(5)} (${c.promptTokens}+${c.completionTokens} tok)`)
  console.log(`pass D cost: $${d.costUsd.toFixed(5)} (${d.promptTokens}+${d.completionTokens} tok, a+b)`)
  console.log(`total:       $${totalCost.toFixed(5)}`)
}

main().catch((e) => {
  console.error('A2→C→D failed:', e)
  process.exit(1)
})
