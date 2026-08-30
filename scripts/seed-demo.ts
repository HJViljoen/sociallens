import { randomUUID, createHash } from 'crypto'
import { createAdminClient, selectAll } from '../lib/supabase-admin'
import { computeMetrics } from '../lib/pipeline/metrics'
import type { VideoRow, CommentRow, Step2aMetrics } from '../lib/pipeline/types'
import { runStep2c } from '../lib/pipeline/owned-events'
import { ensureDefaultSchedule } from '../lib/schedules/default'

// Idempotent demo-tenant seeder (DATA ONLY — no UI). Creates "Össur — Demo":
// a comped tenant with a login, six weekly pipeline_runs, the latest run (W6)
// cloned from the real Ossur analysis + corpus so every live page renders full,
// and W1–W5 as lightweight aggregate history for the time-series / week-over-week
// deltas. Re-running deletes all demo rows + the auth user, then recreates.
//
// Numbers invariant (fixed 2026-07-08): W6's run_summary is COMPUTED from the
// cloned corpus with the pipeline's own computeMetrics — never hand-set — and
// the W1–W5 narrative arc is re-anchored to that endpoint, so every page that
// follows the "numbers come from run_summary" rule agrees with the corpus.
//
// Owned layer (Owned-Data-Plan Phase 0): synthetic account_snapshots + owned
// posts/comments (source='owned') across the six weeks — an IG follower jump at
// W5 driven by an athlete-story reel (explainable) and a small TikTok dip at W6
// (honestly unexplainable). After the data, Step 2c runs per week (detection is
// code; explanations need OPENAI_API_KEY) and the six weekly reports are stored
// so the Reports page renders.
//
// Run:  set -a; . ./.env.local; set +a
//       npx --no-install tsx scripts/seed-demo.ts
//
// Safety: the real Ossur client_id is READ-ONLY here — it is only ever the
// source of SELECTs. Every INSERT/DELETE is scoped to DEMO_CLIENT_ID.

// ---- constants --------------------------------------------------------------

const OSSUR_CLIENT_ID = 'e52cac94-30e1-426a-9a36-31b11e0b30b6' // read-only source
const SOURCE_RUN_ID = 'f9548a97-ded0-44ea-b727-2ffee709f09e'   // the full completed Ossur run

const DEMO_CLIENT_ID = 'de300055-0000-4000-8000-000000000001'
const DEMO_EMAIL = 'demo@verbatimintel.com'

// Fixed run ids (W1 oldest → W6 newest) so re-runs are stable.
const RUN_ID = {
  W1: 'de300055-0000-4000-8000-0000000000a1',
  W2: 'de300055-0000-4000-8000-0000000000a2',
  W3: 'de300055-0000-4000-8000-0000000000a3',
  W4: 'de300055-0000-4000-8000-0000000000a4',
  W5: 'de300055-0000-4000-8000-0000000000a5',
  W6: 'de300055-0000-4000-8000-0000000000a6',
} as const

type Week = keyof typeof RUN_ID

type Row = Record<string, unknown>

// The admin client is untyped (no Database generic), so `.select('*')` widens to
// PostgREST's GenericStringError[] shape. This is the structural type selectAll
// actually needs; we cast range-able builders to it to page whole tables.
type Rangeable = { range: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }> }
const rangeable = (b: unknown) => b as unknown as Rangeable

const admin = createAdminClient()

// ---- small helpers ----------------------------------------------------------

const iso = (s: string) => new Date(s).toISOString()
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

// Demo password. NOT hardcoded any more (T0-9, 2026-08-18): the old comment
// said this tenant held "only synthetic data" and that was false. The comments
// and videos are a verbatim clone of a real client's corpus, 4,701 distinct
// real handles among them, and '123456' was the whole lock. Handles are hashed
// on clone below, and the password comes from the environment.
function demoPassword(): string {
  const p = process.env.DEMO_PASSWORD
  if (!p || p.length < 12) {
    throw new Error('Set DEMO_PASSWORD (12+ chars) before seeding the demo tenant.')
  }
  return p
}

/** Stable pseudonym for a commenter in the demo tenant. Deterministic so the
 *  same person reads as the same voice across the six seeded weeks, one-way so
 *  the tenant carries no real handles. Not a security boundary: it is the
 *  removal of personal data from a showcase that did not need it. */
function pseudonymise(author: unknown): string | null {
  if (author == null || author === '') return null
  return `user_${createHash('sha256').update(String(author)).digest('hex').slice(0, 8)}`
}

async function insertRows(table: string, rows: Row[], chunk = 500): Promise<number> {
  let n = 0
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk)
    const { error } = await admin.from(table).insert(batch)
    if (error) throw new Error(`insert ${table} [${i}..${i + batch.length}]: ${error.message}`)
    n += batch.length
  }
  return n
}

async function chunkDelete(table: string, column: string, ids: string[], chunk = 200): Promise<void> {
  for (let i = 0; i < ids.length; i += chunk) {
    const { error } = await admin.from(table).delete().in(column, ids.slice(i, i + chunk))
    if (error) throw new Error(`delete ${table} by ${column}: ${error.message}`)
  }
}

// ---- 1. idempotent teardown -------------------------------------------------

async function deleteDemo(): Promise<void> {
  // insight_evidence has no client_id — clear it via our audience_insights + comments first.
  const demoInsights = await selectAll<{ id: string }>(() =>
    admin.from('audience_insights').select('id').eq('client_id', DEMO_CLIENT_ID).order('id', { ascending: true }),
  )
  if (demoInsights.length) await chunkDelete('insight_evidence', 'audience_insight_id', demoInsights.map((r) => r.id))
  const demoComments = await selectAll<{ id: string }>(() =>
    admin.from('comments').select('id').eq('client_id', DEMO_CLIENT_ID).order('id', { ascending: true }),
  )
  if (demoComments.length) await chunkDelete('insight_evidence', 'comment_id', demoComments.map((r) => r.id))

  // Child tables that carry client_id, in FK-safe order.
  const byClient = [
    'account_events',
    'account_snapshots',
    'language_samples',
    'audience_insights',
    'themes',
    'market_insights',
    'competitive_insights',
    'recommendations',
    'keyword_performance',
    'run_summary',
    'comments',
    'videos',
    'report_sends',
    'report_schedules',
    'weekly_reports',
    'ai_call_log',
    'invitations',
    'tracking_configs',
    'pipeline_runs',
    'users',
  ]
  for (const table of byClient) {
    const { error } = await admin.from(table).delete().eq('client_id', DEMO_CLIENT_ID)
    if (error) throw new Error(`delete ${table}: ${error.message}`)
  }
  const { error: cErr } = await admin.from('clients').delete().eq('id', DEMO_CLIENT_ID)
  if (cErr) throw new Error(`delete clients: ${cErr.message}`)

  // Auth user by email (paged).
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    const users = data?.users ?? []
    const match = users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL)
    if (match) {
      const { error: delErr } = await admin.auth.admin.deleteUser(match.id)
      if (delErr) throw new Error(`deleteUser: ${delErr.message}`)
    }
    if (users.length < 200) break
  }
}

// ---- 2. tenant, config, login ----------------------------------------------

async function createTenant(): Promise<{ password: string; authUserId: string }> {
  const { error: cErr } = await admin.from('clients').insert({
    id: DEMO_CLIENT_ID,
    company_name: 'Össur — Demo',
    plan: 'demo',
    is_active: true,
    is_comped: true,
    created_at: iso('2026-05-20T09:00:00Z'),
  })
  if (cErr) throw new Error(`create client: ${cErr.message}`)

  // Copy the real Ossur tracking_configs values (report_emails → demo inbox).
  const { data: srcCfg, error: cfgReadErr } = await admin
    .from('tracking_configs').select('*').eq('client_id', OSSUR_CLIENT_ID).maybeSingle()
  if (cfgReadErr) throw new Error(`read tracking_configs: ${cfgReadErr.message}`)
  const src = (srcCfg ?? {}) as Row
  const { error: cfgErr } = await admin.from('tracking_configs').insert({
    client_id: DEMO_CLIENT_ID,
    brand_keywords: src.brand_keywords ?? ['ossur'],
    competitor_keywords: src.competitor_keywords ?? ['ottobock'],
    competitor_names: src.competitor_names ?? ['Ottobock'],
    industry_keywords: src.industry_keywords ?? [],
    platforms: src.platforms ?? ['tiktok', 'youtube', 'instagram'],
    report_emails: [DEMO_EMAIL],
    report_day: src.report_day ?? 'sunday',
    report_period: 'weekly',
    max_videos: src.max_videos ?? 50,
    max_comments: src.max_comments ?? 5,
    comment_depth: src.comment_depth ?? 100,
  })
  if (cfgErr) throw new Error(`create tracking_configs: ${cfgErr.message}`)

  await ensureDefaultSchedule(admin, DEMO_CLIENT_ID, [DEMO_EMAIL])

  const password = demoPassword()
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Demo (Össur)' },
  })
  if (authErr || !created?.user) throw new Error(`createUser: ${authErr?.message ?? 'no user'}`)
  const authUserId = created.user.id

  const { error: uErr } = await admin.from('users').insert({
    id: authUserId,
    client_id: DEMO_CLIENT_ID,
    email: DEMO_EMAIL,
    full_name: 'Demo (Össur)',
    role: 'owner',
  })
  if (uErr) throw new Error(`create users row: ${uErr.message}`)

  return { password, authUserId }
}

// ---- trajectory (W1 → W6) ----------------------------------------------------
// The numeric values below are the NARRATIVE ARC (erosion story), not the final
// numbers: after cloning, anchorWeeks() rebuilds the table so W6 carries the
// corpus-computed values and W1–W5 keep the arc's shape (offsets for rates,
// proportions for counts) relative to that endpoint. Timing fields are literal.

interface WeekSpec {
  week: Week
  runId: string
  runDate: string       // ISO
  startedAt: string
  completedAt: string
  totalComments: number
  totalVideos: number
  pos: number
  neu: number
  neg: number
  sovOssur: number
  sovOttobock: number
  avgEng: number
}

const WEEKS: WeekSpec[] = [
  { week: 'W1', runId: RUN_ID.W1, runDate: '2026-05-30T09:00:00Z', startedAt: '2026-05-30T05:10:00Z', completedAt: '2026-05-30T08:40:00Z', totalComments: 4800, totalVideos: 620,  pos: 90.6, neu: 8.7, neg: 0.7, sovOssur: 8.9, sovOttobock: 10.4, avgEng: 5.1 },
  { week: 'W2', runId: RUN_ID.W2, runDate: '2026-06-06T09:00:00Z', startedAt: '2026-06-06T05:10:00Z', completedAt: '2026-06-06T08:45:00Z', totalComments: 5300, totalVideos: 700,  pos: 90.2, neu: 9.0, neg: 0.8, sovOssur: 8.6, sovOttobock: 10.7, avgEng: 5.2 },
  { week: 'W3', runId: RUN_ID.W3, runDate: '2026-06-13T09:00:00Z', startedAt: '2026-06-13T05:10:00Z', completedAt: '2026-06-13T08:55:00Z', totalComments: 5900, totalVideos: 820,  pos: 89.9, neu: 9.2, neg: 0.9, sovOssur: 8.2, sovOttobock: 11.0, avgEng: 5.4 },
  { week: 'W4', runId: RUN_ID.W4, runDate: '2026-06-20T09:00:00Z', startedAt: '2026-06-20T05:10:00Z', completedAt: '2026-06-20T09:05:00Z', totalComments: 6500, totalVideos: 1050, pos: 89.6, neu: 9.4, neg: 1.0, sovOssur: 7.9, sovOttobock: 11.3, avgEng: 5.5 },
  { week: 'W5', runId: RUN_ID.W5, runDate: '2026-06-27T09:00:00Z', startedAt: '2026-06-27T05:10:00Z', completedAt: '2026-06-27T09:10:00Z', totalComments: 6900, totalVideos: 1200, pos: 89.4, neu: 9.5, neg: 1.1, sovOssur: 7.6, sovOttobock: 11.5, avgEng: 5.6 },
  { week: 'W6', runId: RUN_ID.W6, runDate: '2026-07-04T09:26:00Z', startedAt: '2026-07-04T05:01:00Z', completedAt: '2026-07-04T09:26:00Z', totalComments: 7500, totalVideos: 1457, pos: 89.2, neu: 9.6, neg: 1.2, sovOssur: 7.4, sovOttobock: 11.7, avgEng: 5.7 },
]

const round1 = (n: number) => Math.round(n * 10) / 10

/** What the cloned W6 corpus actually computes to — the anchor for the arc. */
interface W6Actual {
  metrics: Step2aMetrics
  pos: number | null
  neu: number | null
  neg: number | null
  sentimentCounts: { positive: number; neutral: number; negative: number; mixed: number }
  videosJudged: number
  ciSummary: unknown
}

/** Rebuild the week table around the corpus-computed W6: rates keep the arc's
 *  week-to-week offsets, counts keep its proportions. */
function anchorWeeks(actual: W6Actual): WeekSpec[] {
  const s6 = WEEKS[WEEKS.length - 1]
  const m = actual.metrics
  const sovClient = m.share_of_voice.client?.pct_videos ?? s6.sovOssur
  const sovComp = m.share_of_voice['competitor:Ottobock']?.pct_videos ?? s6.sovOttobock
  const pos = actual.pos ?? s6.pos
  const neu = actual.neu ?? s6.neu
  const neg = actual.neg ?? s6.neg
  return WEEKS.map((w) => {
    if (w.week === 'W6') {
      return { ...w, totalVideos: m.total_videos, totalComments: m.total_comments, pos, neu, neg, sovOssur: sovClient, sovOttobock: sovComp, avgEng: m.avg_engagement_rate }
    }
    return {
      ...w,
      totalVideos: Math.round((m.total_videos * w.totalVideos) / s6.totalVideos),
      totalComments: Math.round((m.total_comments * w.totalComments) / s6.totalComments / 50) * 50,
      pos: round1(pos + (w.pos - s6.pos)),
      neu: round1(Math.max(0, neu + (w.neu - s6.neu))),
      neg: round1(Math.max(0, neg + (w.neg - s6.neg))),
      sovOssur: round1(Math.max(0, sovClient + (w.sovOssur - s6.sovOssur))),
      sovOttobock: round1(Math.max(0, sovComp + (w.sovOttobock - s6.sovOttobock))),
      avgEng: round1(Math.max(0, m.avg_engagement_rate + (w.avgEng - s6.avgEng))),
    }
  })
}

function shareOfVoice(w: WeekSpec) {
  const clientVideos = Math.round((w.totalVideos * w.sovOssur) / 100)
  const compVideos = Math.round((w.totalVideos * w.sovOttobock) / 100)
  const industryVideos = w.totalVideos - clientVideos - compVideos
  const industryPct = round1(100 - w.sovOssur - w.sovOttobock)
  const sov = {
    client: { videos: clientVideos, views: clientVideos * 3000, pct_videos: w.sovOssur },
    'competitor:Ottobock': { videos: compVideos, views: compVideos * 8000, pct_videos: w.sovOttobock },
    'industry-other': { videos: industryVideos, views: industryVideos * 110000, pct_videos: industryPct },
  }
  return { sov, clientVideos, compVideos, industryVideos }
}

function platformsSummary(w: WeekSpec) {
  const ttV = Math.round(w.totalVideos * 0.37)
  const ytV = Math.round(w.totalVideos * 0.25)
  const igV = w.totalVideos - ttV - ytV
  const ttC = Math.round(w.totalComments * 0.4)
  const igC = Math.round(w.totalComments * 0.45)
  const ytC = w.totalComments - ttC - igC
  return {
    tiktok: { videos: ttV, comments: ttC, views: ttV * 260000, avg_engagement_rate: round1(w.avgEng + 0.05) },
    youtube: { videos: ytV, comments: ytC, views: ytV * 3000, avg_engagement_rate: 1.1 },
    instagram: { videos: igV, comments: igC, views: 0, avg_engagement_rate: null },
  }
}

// ---- 3. pipeline_runs -------------------------------------------------------

async function insertRuns(): Promise<void> {
  const rows = WEEKS.map((w) => ({
    id: w.runId,
    client_id: DEMO_CLIENT_ID,
    status: 'completed',
    videos_scraped: w.totalVideos,
    started_at: iso(w.startedAt),
    completed_at: iso(w.completedAt),
    errors: [],
    steps_completed: ['gather', 'pass_a', 'cross_reference', 'themes', 'synthesize', 'run_summary'],
  }))
  await insertRows('pipeline_runs', rows)
}

// ---- 4. W6 clone of the real Ossur run --------------------------------------

interface CloneMaps {
  video: Map<string, string>
  comment: Map<string, string>
  insight: Map<string, string>
  market: Map<string, string>
  competitive: Map<string, string>
  bucketVideos: Record<string, string[]> // new video ids by entity bucket
  topVideoId: string | null
  evidenceInserted: number
}

function bucketOf(v: Row): string {
  if (v.is_client) return 'client'
  if (v.is_competitor) return `competitor:${(v.competitor_name as string) ?? 'Ottobock'}`
  return 'industry-other'
}

function mapIds(ids: unknown, m: Map<string, string>): string[] {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => m.get(id as string))
    .filter((x): x is string => Boolean(x))
}

async function cloneW6(): Promise<{ maps: CloneMaps; actual: W6Actual }> {
  const runId = RUN_ID.W6
  const w6 = WEEKS.find((w) => w.week === 'W6')!
  const stamp = iso(w6.completedAt)

  const eq = (t: string) =>
    rangeable(admin.from(t).select('*').eq('client_id', OSSUR_CLIENT_ID).eq('run_id', SOURCE_RUN_ID).order('id', { ascending: true }))

  const [videos, comments, insights, markets, competitives, recs, themes, kperf, samples] = await Promise.all([
    selectAll<Row>(() => eq('videos')),
    selectAll<Row>(() => eq('comments')),
    selectAll<Row>(() => eq('audience_insights')),
    selectAll<Row>(() => eq('market_insights')),
    selectAll<Row>(() => eq('competitive_insights')),
    selectAll<Row>(() => eq('recommendations')),
    selectAll<Row>(() => eq('themes')),
    selectAll<Row>(() => eq('keyword_performance')),
    selectAll<Row>(() => eq('language_samples')),
  ])

  // id maps
  const maps: CloneMaps = {
    video: new Map(), comment: new Map(), insight: new Map(), market: new Map(), competitive: new Map(),
    bucketVideos: { client: [], 'competitor:Ottobock': [], 'industry-other': [] },
    topVideoId: null, evidenceInserted: 0,
  }
  for (const v of videos) maps.video.set(v.id as string, randomUUID())
  for (const c of comments) maps.comment.set(c.id as string, randomUUID())
  for (const a of insights) maps.insight.set(a.id as string, randomUUID())
  for (const m of markets) maps.market.set(m.id as string, randomUUID())
  for (const ci of competitives) maps.competitive.set(ci.id as string, randomUUID())

  // videos
  const videoRows = videos.map((v) => {
    const id = maps.video.get(v.id as string)!
    const bucket = bucketOf(v)
    ;(maps.bucketVideos[bucket] ??= []).push(id)
    return { ...v, id, client_id: DEMO_CLIENT_ID, run_id: runId, scraped_at: stamp }
  })
  await insertRows('videos', videoRows)
  maps.topVideoId = maps.video.get('40e45359-9ef8-449f-855f-02349741d712') ?? null // real top video

  // insight_evidence (fetch first — its FKs decide which comments we must clone).
  const realInsightIds = insights.map((a) => a.id as string)
  const rawEvidence: Row[] = []
  for (let i = 0; i < realInsightIds.length; i += 100) {
    const { data, error } = await admin
      .from('insight_evidence').select('*').in('audience_insight_id', realInsightIds.slice(i, i + 100))
    if (error) throw new Error(`read insight_evidence: ${error.message}`)
    rawEvidence.push(...((data ?? []) as Row[]))
  }

  // Some evidence / language-sample comments live under an earlier run_id (a
  // video's comments are scraped once and reused), so they're missing from the
  // run-scoped comment pull. Fetch those referenced rows by id and clone them
  // too, so no FK is dropped. All belong to the same (read-only) Ossur client.
  const referenced = new Set<string>()
  for (const e of rawEvidence) if (e.comment_id) referenced.add(e.comment_id as string)
  for (const l of samples) if (l.comment_id) referenced.add(l.comment_id as string)
  const missing = [...referenced].filter((id) => !maps.comment.has(id))
  const extraComments: Row[] = []
  for (let i = 0; i < missing.length; i += 100) {
    const { data, error } = await admin.from('comments').select('*').in('id', missing.slice(i, i + 100))
    if (error) throw new Error(`read referenced comments: ${error.message}`)
    extraComments.push(...((data ?? []) as Row[]))
  }
  for (const c of extraComments) maps.comment.set(c.id as string, randomUUID())

  // comments (run-scoped + the referenced stragglers, all reparented to W6)
  const commentRows = [...comments, ...extraComments].map((c) => ({
    ...c, id: maps.comment.get(c.id as string)!, client_id: DEMO_CLIENT_ID, run_id: runId, created_at: stamp,
    // Real people do not need to be in the showcase (T0-9).
    author: pseudonymise(c.author),
  }))
  await insertRows('comments', commentRows)

  // audience_insights (source_video_id → mapped, nullable)
  const insightRows = insights.map((a) => ({
    ...a,
    id: maps.insight.get(a.id as string)!,
    client_id: DEMO_CLIENT_ID,
    run_id: runId,
    source_video_id: a.source_video_id ? maps.video.get(a.source_video_id as string) ?? null : null,
    created_at: stamp,
  }))
  await insertRows('audience_insights', insightRows)

  // insight_evidence (remap FKs; a row is dropped only if its SOURCE genuinely
  // no longer exists — never dangled). Two shapes since Step 2 (2026-08-08):
  // source='comment' rows remap comment_id; source='video' rows (transcript
  // evidence — hero-eligible by design, D2) remap source_video_id instead.
  const evidenceRows: Row[] = []
  for (const e of rawEvidence) {
    const ai = maps.insight.get(e.audience_insight_id as string)
    if (!ai) continue
    if (e.source === 'video') {
      const vid = maps.video.get(e.source_video_id as string)
      if (!vid) continue
      evidenceRows.push({ id: randomUUID(), audience_insight_id: ai, comment_id: null, source: 'video', source_video_id: vid, quote: e.quote, redacted: e.redacted ?? false, relevance_rank: e.relevance_rank, created_at: stamp })
      continue
    }
    const cm = maps.comment.get(e.comment_id as string)
    if (!cm) continue
    // Uniform keys with the video branch: bulk inserts use the UNION of keys
    // across rows and default missing keys to NULL — which would violate the
    // source NOT NULL constraint on any chunk mixing both shapes.
    // redacted rides along (counts-not-quotes, 2026-08-22): a demographic_signal
    // citation stays a citation in the demo too, with quote ''.
    evidenceRows.push({ id: randomUUID(), audience_insight_id: ai, comment_id: cm, source: 'comment', source_video_id: null, quote: e.quote, redacted: e.redacted ?? false, relevance_rank: e.relevance_rank, created_at: stamp })
  }
  maps.evidenceInserted = await insertRows('insight_evidence', evidenceRows)

  // language_samples (source_video_id + comment_id → mapped, nullable)
  const sampleRows = samples.map((l) => ({
    ...l,
    id: randomUUID(),
    client_id: DEMO_CLIENT_ID,
    run_id: runId,
    source_video_id: l.source_video_id ? maps.video.get(l.source_video_id as string) ?? null : null,
    comment_id: l.comment_id ? maps.comment.get(l.comment_id as string) ?? null : null,
    created_at: stamp,
  }))
  await insertRows('language_samples', sampleRows)

  // themes (remap supporting arrays; first_seen=false — the tenant has prior weeks)
  const themeRows = themes.map((t) => ({
    ...t,
    id: randomUUID(),
    client_id: DEMO_CLIENT_ID,
    run_id: runId,
    supporting_video_ids: mapIds(t.supporting_video_ids, maps.video),
    supporting_insight_ids: mapIds(t.supporting_insight_ids, maps.insight),
    first_seen: false,
    created_at: stamp,
  }))
  await insertRows('themes', themeRows)

  // market_insights (remap evidence: supporting_theme_ids → audience_insights, competitive → competitive_insights)
  const marketRows = markets.map((m) => {
    const ev = (m.evidence ?? {}) as Row
    return {
      ...m,
      id: maps.market.get(m.id as string)!,
      client_id: DEMO_CLIENT_ID,
      run_id: runId,
      evidence: {
        supporting_theme_ids: mapIds(ev.supporting_theme_ids, maps.insight),
        supporting_competitive_insight_ids: mapIds(ev.supporting_competitive_insight_ids, maps.competitive),
      },
      created_at: stamp,
    }
  })
  await insertRows('market_insights', marketRows)

  // competitive_insights (remap evidence.supporting_theme_ids → audience_insights)
  const competitiveRows = competitives.map((ci) => {
    const ev = (ci.evidence ?? {}) as Row
    return {
      ...ci,
      id: maps.competitive.get(ci.id as string)!,
      client_id: DEMO_CLIENT_ID,
      run_id: runId,
      evidence: { supporting_theme_ids: mapIds(ev.supporting_theme_ids, maps.insight) },
      created_at: stamp,
    }
  })
  await insertRows('competitive_insights', competitiveRows)

  // recommendations (remap based_on.insight_ids → market/competitive; realistic W6 statuses)
  const W6_REC_STATUS = ['new', 'acknowledged', 'acted_on', 'new'] // by real-run rec order
  const recRows = recs.map((r, i) => {
    const bo = (r.based_on ?? {}) as Row
    const ids = (Array.isArray(bo.insight_ids) ? bo.insight_ids : []) as string[]
    const remapped = ids.map((id) => maps.market.get(id) ?? maps.competitive.get(id)).filter((x): x is string => Boolean(x))
    return {
      ...r,
      id: randomUUID(),
      client_id: DEMO_CLIENT_ID,
      run_id: runId,
      based_on: { insight_ids: remapped },
      status: W6_REC_STATUS[i] ?? 'new',
      created_at: stamp,
      updated_at: stamp,
    }
  })
  await insertRows('recommendations', recRows)

  // keyword_performance (no FKs to remap)
  const kperfRows = kperf.map((k) => ({ ...k, id: randomUUID(), client_id: DEMO_CLIENT_ID, run_id: runId, created_at: stamp }))
  await insertRows('keyword_performance', kperfRows)

  // W6 truth: run the pipeline's own Step 2a metrics over the cloned corpus
  // (discovered rows only — the owned layer is inserted separately and the SoV
  // guard keeps it out of these numbers), plus the video-sentiment shares the
  // pipeline's run_summary writer would compute. This is what run_summary W6
  // carries, so pages and corpus can never disagree.
  const metrics = computeMetrics(
    videoRows as unknown as VideoRow[],
    commentRows as unknown as CommentRow[],
  )
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0, mixed: 0 }
  let videosJudged = 0
  for (const v of videoRows) {
    const s = (v as Row).sentiment as string | null
    if (s && s in sentimentCounts) {
      sentimentCounts[s as keyof typeof sentimentCounts]++
      videosJudged++
    }
  }
  const share = (n: number) => (videosJudged > 0 ? round1((n / videosJudged) * 100) : null)

  const { data: srcSummary } = await admin
    .from('run_summary').select('consumer_intelligence_summary')
    .eq('client_id', OSSUR_CLIENT_ID).eq('run_id', SOURCE_RUN_ID).maybeSingle()
  const ciSummary = (srcSummary?.consumer_intelligence_summary ?? null) as unknown

  const actual: W6Actual = {
    metrics,
    pos: share(sentimentCounts.positive),
    neu: share(sentimentCounts.neutral),
    neg: share(sentimentCounts.negative),
    sentimentCounts,
    videosJudged,
    ciSummary,
  }
  return { maps, actual }
}

// ---- 5. run_summary writers ---------------------------------------------------

/** W1–W5: synthetic aggregates built from the (anchored) week spec. */
async function insertRunSummary(w: WeekSpec, prev: WeekSpec | null): Promise<void> {
  const { sov, clientVideos, compVideos } = shareOfVoice(w)

  const row = {
    id: randomUUID(),
    client_id: DEMO_CLIENT_ID,
    run_id: w.runId,
    total_videos: w.totalVideos,
    total_comments: w.totalComments,
    client_videos: clientVideos,
    competitor_videos: compVideos,
    platforms_covered: ['instagram', 'tiktok', 'youtube'],
    avg_engagement_rate: w.avgEng,
    top_video_id: null,
    top_video_views: null,
    top_video_platform: null,
    share_of_voice: sov,
    platforms_summary: platformsSummary(w),
    // Period slice: the baseline week gathers everything; later weeks add the
    // week-over-week growth. Feeds the dashboard's volume tiles + their deltas.
    period_videos: prev ? w.totalVideos - prev.totalVideos : w.totalVideos,
    period_comments: prev ? w.totalComments - prev.totalComments : w.totalComments,
    overall_sentiment_positive: w.pos,
    overall_sentiment_neutral: w.neu,
    overall_sentiment_negative: w.neg,
    sentiment_drivers: {
      video_sentiment_counts: {
        positive: Math.round((w.totalVideos * w.pos) / 100),
        neutral: Math.round((w.totalVideos * w.neu) / 100),
        negative: Math.round((w.totalVideos * w.neg) / 100),
      },
    },
    consumer_intelligence_summary: null,
    wow_sentiment_change: prev ? round1(w.pos - prev.pos) : null,
    wow_engagement_change: prev ? round1(w.avgEng - prev.avgEng) : null,
    period: 'weekly',
    run_date: iso(w.runDate),
  }
  const { error } = await admin.from('run_summary').insert(row)
  if (error) throw new Error(`run_summary ${w.week}: ${error.message}`)
}

/** W6: the corpus-computed truth, written the way the pipeline itself would. */
async function insertRunSummaryW6(w: WeekSpec, prev: WeekSpec, actual: W6Actual): Promise<void> {
  const m = actual.metrics
  const row = {
    id: randomUUID(),
    client_id: DEMO_CLIENT_ID,
    run_id: w.runId,
    total_videos: m.total_videos,
    total_comments: m.total_comments,
    client_videos: m.client_videos,
    competitor_videos: m.competitor_videos,
    platforms_covered: m.platforms_covered,
    avg_engagement_rate: m.avg_engagement_rate,
    top_video_id: m.top_video_id,
    top_video_views: m.top_video_views,
    top_video_platform: m.top_video_platform,
    share_of_voice: m.share_of_voice,
    platforms_summary: m.platforms_summary,
    period_videos: m.total_videos - prev.totalVideos,
    period_comments: m.total_comments - prev.totalComments,
    overall_sentiment_positive: actual.pos,
    overall_sentiment_neutral: actual.neu,
    overall_sentiment_negative: actual.neg,
    sentiment_drivers: { video_sentiment_counts: actual.sentimentCounts, videos_judged: actual.videosJudged },
    consumer_intelligence_summary: actual.ciSummary ?? null,
    wow_sentiment_change: actual.pos != null ? round1(actual.pos - prev.pos) : null,
    wow_engagement_change: round1(m.avg_engagement_rate - prev.avgEng),
    period: 'weekly',
    run_date: iso(w.runDate),
  }
  const { error } = await admin.from('run_summary').insert(row)
  if (error) throw new Error(`run_summary W6: ${error.message}`)
}

// ---- 6. W1–W5 lightweight aggregate history ---------------------------------

// Carried theme trajectory (label → per-week [strength, evidence]); W1..W5.
interface CarriedTheme {
  label: string; bucket: string; category: string; description: string
  emotion: string; impact: string
  series: Partial<Record<Week, { s: number; e: number }>>
  debut: Week
}
const CARRIED_THEMES: CarriedTheme[] = [
  {
    label: "Ottobock's innovation halo", bucket: 'competitor:Ottobock', category: 'praise',
    description: 'Audiences praise Ottobock for advanced prosthetic technology, comfort, and design — admiration that can shape brand preference before people weigh price or access.',
    emotion: 'joyful', impact: 'positive', debut: 'W1',
    series: { W1: { s: 5, e: 40 }, W2: { s: 5, e: 51 }, W3: { s: 6, e: 62 }, W4: { s: 6, e: 73 }, W5: { s: 7, e: 84 }, W6: { s: 8, e: 95 } },
  },
  {
    label: 'Questions about prosthetic options', bucket: 'industry-other', category: 'question',
    description: 'People ask practical questions about prosthetic fit, features, cost, and how to access options — curiosity mixed with resilience across the category.',
    emotion: 'curious', impact: 'positive', debut: 'W1',
    series: { W1: { s: 6, e: 150 }, W2: { s: 6, e: 157 }, W3: { s: 6, e: 164 }, W4: { s: 6, e: 171 }, W5: { s: 6, e: 178 }, W6: { s: 6, e: 185 } },
  },
  {
    label: 'Praise for Ossur products', bucket: 'client', category: 'praise',
    description: 'Viewers commend Ossur products and team for quality, performance, and the movement and confidence they enable.',
    emotion: 'joyful', impact: 'positive', debut: 'W1',
    series: { W1: { s: 5, e: 60 }, W2: { s: 5, e: 64 }, W3: { s: 5, e: 68 }, W4: { s: 5, e: 72 }, W5: { s: 5, e: 76 }, W6: { s: 5, e: 80 } },
  },
  {
    label: 'Cost & access barriers', bucket: 'industry-other', category: 'pain_point',
    description: 'Frustration surfaces around insurance coverage, cost clarity, and the steps required to actually obtain a prosthesis.',
    emotion: 'frustrated', impact: 'negative', debut: 'W5',
    series: { W5: { s: 3, e: 15 }, W6: { s: 4, e: 28 } },
  },
]

// Competitive-insight text reused from the real run (impact escalates for the halo).
const HALO_IMPACT: Record<Week, string> = { W1: 'low', W2: 'low', W3: 'medium', W4: 'medium', W5: 'high', W6: 'high' }

// Recommendation lifecycle for W1–W5. 1 high + 2 medium per week.
interface HistRec { key: string; title: string; type: string; priority: string; reasoning: string }
const REC: Record<string, HistRec> = {
  HIGH: {
    key: 'HIGH', priority: 'high', type: 'content_communication',
    title: "Launch a 'Before you choose a prosthesis' education series",
    reasoning: 'New amputees and caregivers are learning about prosthetic life in the wider category conversation, not from Ossur. A structured education series covering recovery, comfort, daily use, and what to ask before choosing a prosthesis lets Ossur build trust before a brand decision is made.',
  },
  INSURANCE: {
    key: 'INSURANCE', priority: 'medium', type: 'customer_experience',
    title: 'Publish an insurance & reimbursement guide for new amputees',
    reasoning: 'Coverage and cost clarity are where hopeful conversations turn to friction. A plain-language guide to insurance, reimbursement, and the steps to access Ossur would reduce drop-off at the decision point.',
  },
  FAQ: {
    key: 'FAQ', priority: 'medium', type: 'content_communication',
    title: 'Create a product-details FAQ answering pricing and buying questions',
    reasoning: 'The most common Ossur questions are about materials, price, compatibility, and how to buy. A concise FAQ that answers them directly would move interested people from evaluation to next step.',
  },
  ATHLETE: {
    key: 'ATHLETE', priority: 'medium', type: 'positioning_messaging',
    title: 'Highlight Ossur athlete outcomes to reinforce fitness inspiration',
    reasoning: 'Ossur already owns inspiration tied to fitness and active living. Amplifying real athlete outcomes strengthens that ownership while Ottobock leans on technical storytelling.',
  },
  COUNTER: {
    key: 'COUNTER', priority: 'medium', type: 'competitive_response',
    title: "Counter Ottobock's innovation narrative",
    reasoning: 'Ottobock is accumulating admiration for advanced prosthetics, shaping preference on engineering before buyers compare access or service. Ossur should make its own innovation story — what its knees and feet actually do — as visible as its inspiration story.',
  },
}
// [recKey, status] triples per week.
const REC_WEEK: Record<Week, Array<[string, string]>> = {
  W1: [['HIGH', 'new'], ['INSURANCE', 'new'], ['FAQ', 'new']],
  W2: [['HIGH', 'new'], ['INSURANCE', 'acknowledged'], ['FAQ', 'new']],
  W3: [['HIGH', 'acknowledged'], ['INSURANCE', 'acknowledged'], ['FAQ', 'dismissed']],
  W4: [['HIGH', 'acknowledged'], ['INSURANCE', 'acted_on'], ['ATHLETE', 'new']],
  W5: [['HIGH', 'acknowledged'], ['ATHLETE', 'acknowledged'], ['COUNTER', 'new']],
  W6: [],
}

const HIST_MARKET = [
  { insight_type: 'unmet_need', title: 'Access answers are part of the product experience', description: 'People turn to Ossur when they are trying to move from interest to action, asking for product details, pricing, buying steps, and where Ossur is located. When reimbursement and purchase steps feel unclear, intent can stall.', confidence_score: 9, opportunity_score: 9 },
  { insight_type: 'industry_signal', title: 'Technology admiration is shaping competitive perception', description: 'Ottobock is the name attached to admiration for advanced prosthetics, while Ossur praise is framed around inspiration and fitness. Innovation storytelling is helping define preference before buyers reach price, insurance, or purchase-path questions.', confidence_score: 8, opportunity_score: 8 },
]
const HIST_COMPETITIVE = (week: Week) => [
  { category: 'competitive_threat', competitor_name: 'Ottobock', title: 'Ottobock is associated with advanced-prosthetics admiration', finding: 'Ottobock draws joyful praise for advanced prosthetics, while Ossur praise is framed around inspiration and fitness rather than technical leadership. Admiration for innovation can shape preference before people compare price or access.', impact_level: HALO_IMPACT[week] },
  { category: 'content_gap', competitor_name: null, title: 'Daily-life education is more visible outside Ossur', finding: 'Industry conversation features everyday prosthetic questions and phantom-pain relief, but Ossur themes stay close to brand-specific information and access — leaving room to build trust earlier with education that is not tied to a purchase question.', impact_level: 'medium' },
]

// The tracked-theme trajectory rows for a single week. Inserted for W1–W5 as the
// week's whole theme set, and ALSO appended to W6 (on top of the real-run clone)
// so every tracked theme's strength line runs cleanly across all six weeks — the
// Trends page joins themes by label, and the real W6 clone uses different, more
// granular labels that wouldn't extend these lines.
async function insertCarriedThemes(w: WeekSpec): Promise<void> {
  const stamp = iso(w.runDate)
  const themeRows = CARRIED_THEMES.flatMap((t) => {
    const pt = t.series[w.week]
    if (!pt) return []
    return [{
      id: randomUUID(), client_id: DEMO_CLIENT_ID, run_id: w.runId,
      bucket: t.bucket, category: t.category, label: t.label, description: t.description,
      member_themes: [slug(t.label)], supporting_insight_ids: [], supporting_video_ids: [],
      evidence_count: pt.e, strength_score: pt.s, dominant_emotion: t.emotion, dominant_sentiment_impact: t.impact,
      single_source: false, first_seen: t.debut === w.week, embedding: null, created_at: stamp,
    }]
  })
  if (themeRows.length) await insertRows('themes', themeRows)
}

// W5-only background themes: the dashboard's "confirmed themes" tile diffs the
// current run against the previous one, so the week before W6 needs a
// realistic confirmed count (4 carried + these 11 = 15 vs W6's 17 → "▲ 2").
// Labels are unique to W5 → one-point trajectories, invisible on Trends.
const W5_BACKGROUND_THEMES: Array<[label: string, category: string, emotion: string, evidence: number]> = [
  ['Insurance paperwork frustration', 'pain_point', 'frustrated', 6],
  ['Praise for clinic support staff', 'praise', 'joyful', 5],
  ['Questions about waterproof use', 'question', 'curious', 4],
  ['Curiosity about running blades', 'question', 'curious', 4],
  ['Sleeve comfort in hot weather', 'pain_point', 'frustrated', 3],
  ['Asking where to get fitted', 'question', 'curious', 3],
  ['Recovery timeline questions', 'question', 'hopeful', 3],
  ['Praise for lightweight design', 'praise', 'joyful', 2],
  ['Sharing rehab progress', 'demographic_signal', 'hopeful', 2],
  ['Concerns about part replacements', 'question', 'curious', 2],
  ['Interest in sports prosthetics', 'purchase_intent', 'excited', 2],
]

async function insertW5BackgroundThemes(w: WeekSpec): Promise<void> {
  if (w.week !== 'W5') return
  const stamp = iso(w.runDate)
  await insertRows('themes', W5_BACKGROUND_THEMES.map(([label, category, emotion, evidence]) => ({
    id: randomUUID(), client_id: DEMO_CLIENT_ID, run_id: w.runId,
    bucket: 'industry-other', category, label,
    description: null, member_themes: [slug(label)], supporting_insight_ids: [], supporting_video_ids: [],
    evidence_count: evidence, strength_score: 5, dominant_emotion: emotion, dominant_sentiment_impact: null,
    single_source: false, first_seen: true, embedding: null, created_at: stamp,
  })))
}

async function insertHistoryWeek(w: WeekSpec, prev: WeekSpec | null): Promise<void> {
  const stamp = iso(w.runDate)

  // run_summary
  await insertRunSummary(w, prev)

  // themes carried this week
  await insertCarriedThemes(w)
  await insertW5BackgroundThemes(w)

  // market_insights (reused text, no FKs)
  await insertRows('market_insights', HIST_MARKET.map((m) => ({
    id: randomUUID(), client_id: DEMO_CLIENT_ID, run_id: w.runId, ...m, evidence: {}, created_at: stamp,
  })))

  // competitive_insights (halo escalation + content gap, no FKs)
  await insertRows('competitive_insights', HIST_COMPETITIVE(w.week).map((c) => ({
    id: randomUUID(), client_id: DEMO_CLIENT_ID, run_id: w.runId, ...c, evidence: {}, created_at: stamp,
  })))

  // recommendations (lifecycle)
  await insertRows('recommendations', REC_WEEK[w.week].map(([key, status]) => {
    const r = REC[key]
    return {
      id: randomUUID(), client_id: DEMO_CLIENT_ID, run_id: w.runId,
      type: r.type, title: r.title, reasoning: r.reasoning, priority: r.priority,
      based_on: { insight_ids: [] }, status, created_at: stamp, updated_at: stamp,
    }
  }))
}

// ---- 7. owned layer (Owned-Data-Plan Phase 0) --------------------------------
// The client's own accounts as a data source, seeded dark: weekly follower
// snapshots per platform, own-post rows and own-post comments (source='owned',
// excluded from every discovered-corpus metric). The arc plants exactly the
// stories Step 2c must handle: a W5 Instagram follower jump (+6.2%) alongside
// an athlete-story reel that far outran the account's typical engagement —
// explainable from the praise themes + own-post comments — and a small W6
// TikTok dip that nothing in the tracked conversation accounts for, exercising
// the first-class "unexplained" outcome.

interface OwnedPost {
  week: Week
  platform: 'instagram' | 'tiktok'
  key: string        // stable platform-native id → videos.video_id
  caption: string
  views: number | null // IG exposes no view counts in this corpus — null there
  likes: number
  comments_count: number
}

const OWNED_FOLLOWERS: Record<'instagram' | 'tiktok', { handle: string; series: Record<Week, number> }> = {
  instagram: { handle: 'ossur', series: { W1: 41200, W2: 41420, W3: 41650, W4: 41890, W5: 44480, W6: 44720 } },
  tiktok:    { handle: 'ossur', series: { W1: 28400, W2: 28510, W3: 28650, W4: 28740, W5: 28820, W6: 28190 } },
}

const OWNED_POSTS: OwnedPost[] = [
  // Steady weekly cadence — the baseline Step 2c judges the standout against.
  { week: 'W1', platform: 'instagram', key: 'ossur-own-ig-w1a', caption: 'Fitting week at the Reykjavik clinic — every socket starts with a conversation.', views: null, likes: 340, comments_count: 18 },
  { week: 'W1', platform: 'instagram', key: 'ossur-own-ig-w1b', caption: 'POWER KNEE™ in daily life: stairs, slopes, long days.', views: null, likes: 410, comments_count: 22 },
  { week: 'W1', platform: 'tiktok',    key: 'ossur-own-tt-w1a', caption: 'How a running blade is made #prosthetics', views: 41200, likes: 1180, comments_count: 44 },
  { week: 'W2', platform: 'instagram', key: 'ossur-own-ig-w2a', caption: 'Clinician Q&A: what to ask before your first prosthesis.', views: null, likes: 385, comments_count: 26 },
  { week: 'W2', platform: 'instagram', key: 'ossur-own-ig-w2b', caption: 'Behind the scenes with our R&D team in Iceland.', views: null, likes: 448, comments_count: 19 },
  { week: 'W2', platform: 'tiktok',    key: 'ossur-own-tt-w2a', caption: 'Cheetah blade vs everyday foot — what changes? #amputee', views: 38800, likes: 1040, comments_count: 39 },
  { week: 'W3', platform: 'instagram', key: 'ossur-own-ig-w3a', caption: 'Proprio Foot® on uneven ground — see the difference.', views: null, likes: 402, comments_count: 21 },
  { week: 'W3', platform: 'instagram', key: 'ossur-own-ig-w3b', caption: 'Your questions on liners and sleeves, answered.', views: null, likes: 356, comments_count: 24 },
  { week: 'W3', platform: 'tiktok',    key: 'ossur-own-tt-w3a', caption: 'A day at our mobility clinic — first steps count twice #prosthetics', views: 44100, likes: 1290, comments_count: 51 },
  { week: 'W4', platform: 'instagram', key: 'ossur-own-ig-w4a', caption: 'Team Össur at the track — training week.', views: null, likes: 471, comments_count: 25 },
  { week: 'W4', platform: 'instagram', key: 'ossur-own-ig-w4b', caption: 'Which knee is right for you? Our clinicians explain the options.', views: null, likes: 389, comments_count: 20 },
  { week: 'W4', platform: 'tiktok',    key: 'ossur-own-tt-w4a', caption: 'Water, sand, trails — where can a prosthetic foot go?', views: 40300, likes: 1120, comments_count: 42 },
  // W5 standout — the athlete-story reel behind the follower jump.
  { week: 'W5', platform: 'instagram', key: 'ossur-own-ig-w5a', caption: "Sara's first 5K on her new running blade — eight months after her accident. Watch to the finish line. 🏁", views: null, likes: 6200, comments_count: 148 },
  { week: 'W5', platform: 'instagram', key: 'ossur-own-ig-w5b', caption: 'Sara answers your questions — live this Friday.', views: null, likes: 512, comments_count: 31 },
  { week: 'W5', platform: 'tiktok',    key: 'ossur-own-tt-w5a', caption: "Sara's finish line — the full story is on our Instagram.", views: 47600, likes: 1350, comments_count: 48 },
  { week: 'W6', platform: 'instagram', key: 'ossur-own-ig-w6a', caption: "Thank you for the love on Sara's story — more athlete journeys coming.", views: null, likes: 545, comments_count: 29 },
  { week: 'W6', platform: 'instagram', key: 'ossur-own-ig-w6b', caption: 'Maintenance 101: caring for your prosthesis in summer.', views: null, likes: 398, comments_count: 17 },
  { week: 'W6', platform: 'tiktok',    key: 'ossur-own-tt-w6a', caption: 'Clinic myths, busted by our prosthetists.', views: 39900, likes: 1080, comments_count: 41 },
]

// Comments on the standout reel — the explanation material + hero-quote pool.
// Short, first-person, quotable: exactly what the evidence-led cards lead with.
const OWNED_COMMENTS_W5: Array<{ author: string; text: string; likes: number }> = [
  { author: 'runwithmaya', text: 'I cried watching this. My daughter lost her leg last year and this is the first thing that made her excited about running again.', likes: 462 },
  { author: 'coach_dre_pt', text: "I'm a physical therapist and I'm showing this to every one of my amputee patients this week.", likes: 318 },
  { author: 'stefan.k.runs', text: 'Eight months?! It took me two years to get back on the road. Sara is unreal.', likes: 254 },
  { author: 'annika_lifts', text: 'This is why I chose an Össur blade after my amputation. Watching Sara felt like watching my own first 5K.', likes: 231 },
  { author: 'tommy_tri', text: 'Followed instantly. More stories like this please.', likes: 187 },
  { author: 'gracefulstride', text: 'The moment she sees the finish line 😭😭', likes: 164 },
  { author: 'mrs_ortiz_teaches', text: 'Showed this to my class today. Half of them want to be prosthetists now.', likes: 142 },
  { author: 'davidpaddles', text: 'My brother just had his fitting appointment. Sending him this for motivation.', likes: 119 },
  { author: 'kensington_pt', text: 'The gait work behind this recovery is elite. Credit to her whole care team.', likes: 96 },
  { author: 'lena.morgan.art', text: 'I have watched this eleven times and it gets better every time.', likes: 88 },
  { author: 'firstresponder_jax', text: 'I was there when Sara was hurt. Seeing this today — no words. Go Sara.', likes: 415 },
  { author: 'quietmilesclub', text: 'Never commented on a brand post before but this one earned it.', likes: 73 },
  { author: 'hopeafterlimbloss', text: 'Posts like this are why our support group keeps recommending you to new members.', likes: 67 },
  { author: 'nordicnurse', text: 'From a rehab nurse: this is what realistic recovery representation looks like. Thank you.', likes: 59 },
]

// A little ordinary chatter elsewhere, so the owned pool isn't only the reel —
// and so the W6 TikTok dip has honest material that does NOT explain it.
const OWNED_COMMENTS_MISC: Array<{ week: Week; platform: 'instagram' | 'tiktok'; key: string; author: string; text: string; likes: number }> = [
  { week: 'W5', platform: 'tiktok', key: 'ossur-own-tt-w5a', author: 'blade_curious', text: 'Went straight to the IG video. Incredible.', likes: 41 },
  { week: 'W5', platform: 'tiktok', key: 'ossur-own-tt-w5a', author: 'physio_finn', text: 'The cadence control in that last stretch is so clean.', likes: 28 },
  { week: 'W6', platform: 'tiktok', key: 'ossur-own-tt-w6a', author: 'gadgetgrandad', text: 'Myth 3 got me. I genuinely believed that for years.', likes: 22 },
  { week: 'W6', platform: 'tiktok', key: 'ossur-own-tt-w6a', author: 'sockliner_sam', text: 'Can you do one on liners next?', likes: 17 },
  { week: 'W6', platform: 'instagram', key: 'ossur-own-ig-w6b', author: 'summer_strider', text: 'The talc tip is a lifesaver in this heat.', likes: 12 },
]

async function insertOwnedLayer(weeks: WeekSpec[]): Promise<void> {
  const byWeek = new Map(weeks.map((w) => [w.week, w]))

  // account_snapshots — one per platform per week, dated with the run.
  const snapshotRows: Row[] = []
  for (const [platform, acct] of Object.entries(OWNED_FOLLOWERS)) {
    for (const w of weeks) {
      snapshotRows.push({
        id: randomUUID(),
        client_id: DEMO_CLIENT_ID,
        run_id: w.runId,
        platform,
        handle: acct.handle,
        snapshot_date: w.runDate.slice(0, 10),
        followers: acct.series[w.week],
        posts_count: OWNED_POSTS.filter((p) => p.platform === platform && byWeek.get(p.week)!.runDate <= w.runDate).length,
        metrics: null,
      })
    }
  }
  await insertRows('account_snapshots', snapshotRows)

  // Own posts → videos (source='owned'; is_client so entity attribution holds).
  const videoRows: Row[] = OWNED_POSTS.map((p) => {
    const w = byWeek.get(p.week)!
    return {
      id: randomUUID(),
      client_id: DEMO_CLIENT_ID,
      run_id: w.runId,
      platform: p.platform,
      video_id: p.key,
      video_url: p.platform === 'instagram' ? `https://www.instagram.com/p/${p.key}/` : `https://www.tiktok.com/@ossur/video/${p.key}`,
      account_name: 'ossur',
      is_client: true,
      is_competitor: false,
      competitor_name: null,
      caption: p.caption,
      hashtags: [],
      views: p.views ?? 0, // IG exposes no views; 0 matches the discovered corpus convention
      likes: p.likes,
      shares: 0,
      comments_count: p.comments_count,
      account_followers: OWNED_FOLLOWERS[p.platform].series[p.week],
      sentiment: null,
      source: 'owned',
      scraped_at: iso(w.runDate),
    }
  })
  await insertRows('videos', videoRows)

  // Own-post comments (source='owned') — the "what your audience says" segment.
  const commentRows: Row[] = []
  const w5 = byWeek.get('W5')!
  OWNED_COMMENTS_W5.forEach((c, i) => {
    commentRows.push({
      id: randomUUID(), client_id: DEMO_CLIENT_ID, run_id: w5.runId,
      platform: 'instagram', video_id: 'ossur-own-ig-w5a', comment_id: `ossur-own-ig-w5a-c${i + 1}`,
      author: c.author, text: c.text, likes: c.likes,
      source: 'owned', created_at: iso(w5.runDate),
    })
  })
  OWNED_COMMENTS_MISC.forEach((c, i) => {
    const w = byWeek.get(c.week)!
    commentRows.push({
      id: randomUUID(), client_id: DEMO_CLIENT_ID, run_id: w.runId,
      platform: c.platform, video_id: c.key, comment_id: `${c.key}-c${i + 1}`,
      author: c.author, text: c.text, likes: c.likes,
      source: 'owned', created_at: iso(w.runDate),
    })
  })
  await insertRows('comments', commentRows)
}

// ---- 8. Step 2c + stored reports ----------------------------------------------

/** Detect + explain owned-account events per week, oldest first. Detection is
 *  code-only; explanations need OPENAI_API_KEY (skipped honestly without it). */
async function runOwnedEvents(weeks: WeekSpec[]): Promise<void> {
  for (const w of weeks) {
    const res = await runStep2c({ clientId: DEMO_CLIENT_ID, runId: w.runId })
    const explained = res.events.filter((e) => e.explained).length
    console.log(
      `  ${w.week}: ${res.events.length} event(s)` +
      (res.events.length ? ` (${explained} explained)` : '') +
      (res.skippedReason ? ` — ${res.skippedReason}` : ''),
    )
  }
}

/** The demo's Sent archive. The hand-written weekly email is gone (Stage 3):
 *  a sent update is a report_sends row made by the schedule runner, which
 *  needs a browser and Storage — not a seed's business. The demo's default
 *  "Weekly digest" schedule is created with its tracking config; its first
 *  send lands the first time the runner fires for it (scripts/send-report.ts
 *  --client <demo> --commit). */
async function storeReports(): Promise<void> {
  console.log('  sends come from the schedule runner, not the seed')
}

// ---- 9. verification --------------------------------------------------------

const RUN_TABLES = [
  'videos', 'comments', 'audience_insights', 'themes', 'market_insights',
  'competitive_insights', 'recommendations', 'keyword_performance', 'language_samples', 'run_summary',
] as const

async function countRun(table: string, runId: string): Promise<number> {
  const { count, error } = await admin
    .from(table).select('id', { head: true, count: 'exact' })
    .eq('client_id', DEMO_CLIENT_ID).eq('run_id', runId)
  if (error) throw new Error(`count ${table}: ${error.message}`)
  return count ?? 0
}

async function verify(maps: CloneMaps, password: string, weeks: WeekSpec[]): Promise<void> {
  console.log('\n=================  VERIFICATION  =================')
  console.log(`DEMO_CLIENT_ID : ${DEMO_CLIENT_ID}`)
  console.log(`login email    : ${DEMO_EMAIL}`)
  console.log(`login password : ${password}`)
  console.log(`insight_evidence rows (W6): ${maps.evidenceInserted}`)

  // Row counts per table per run.
  console.log('\nRow counts per table per run:')
  const header = ['table', ...weeks.map((w) => w.week)].join('\t')
  console.log(header)
  for (const table of RUN_TABLES) {
    const cells: string[] = [table.padEnd(21)]
    for (const w of weeks) cells.push(String(await countRun(table, w.runId)))
    console.log(cells.join('\t'))
  }

  // run_summary arc.
  console.log('\nrun_summary arc (pos/neu/neg · SoV Ossur/Ottobock · wowSent/wowEng):')
  const rs = await selectAll<Row>(() =>
    rangeable(admin.from('run_summary').select('*').eq('client_id', DEMO_CLIENT_ID).order('run_date', { ascending: true })),
  )
  for (const r of rs) {
    const sov = (r.share_of_voice ?? {}) as Record<string, { pct_videos?: number }>
    const w = weeks.find((x) => x.runId === r.run_id)?.week ?? '??'
    console.log(
      `${w}  ${String(r.run_date).slice(0, 10)}  ` +
      `pos ${r.overall_sentiment_positive} / neu ${r.overall_sentiment_neutral} / neg ${r.overall_sentiment_negative}  ·  ` +
      `Ossur ${sov.client?.pct_videos ?? '—'}% / Ottobock ${sov['competitor:Ottobock']?.pct_videos ?? '—'}%  ·  ` +
      `wowSent ${r.wow_sentiment_change ?? '—'} / wowEng ${r.wow_engagement_change ?? '—'}  ·  ` +
      `videos ${r.total_videos} comments ${r.total_comments}`,
    )
  }

  // Numbers invariant: W6 run_summary must equal the corpus it was computed from.
  const w6 = weeks[weeks.length - 1]
  const [vids, cmts] = await Promise.all([
    admin.from('videos').select('id', { head: true, count: 'exact' })
      .eq('client_id', DEMO_CLIENT_ID).eq('run_id', w6.runId).eq('source', 'discovered'),
    admin.from('comments').select('id', { head: true, count: 'exact' })
      .eq('client_id', DEMO_CLIENT_ID).eq('run_id', w6.runId).eq('source', 'discovered'),
  ])
  const w6Summary = rs.find((r) => r.run_id === w6.runId)
  const match = w6Summary && w6Summary.total_videos === (vids.count ?? -1) && w6Summary.total_comments === (cmts.count ?? -1)
  console.log(`\nW6 corpus consistency: run_summary ${w6Summary?.total_videos}/${w6Summary?.total_comments} vs discovered corpus ${vids.count}/${cmts.count} → ${match ? 'OK' : 'MISMATCH'}`)

  // Owned layer + reports.
  const ownedCounts = async (table: string, extra?: (q: unknown) => unknown) => {
    let q = admin.from(table).select('id', { head: true, count: 'exact' }).eq('client_id', DEMO_CLIENT_ID)
    if (extra) q = extra(q) as typeof q
    const { count } = await q
    return count ?? 0
  }
  console.log('\nOwned layer:')
  console.log(`  account_snapshots : ${await ownedCounts('account_snapshots')}`)
  console.log(`  owned videos      : ${await ownedCounts('videos', (q) => (q as { eq: (c: string, v: string) => unknown }).eq('source', 'owned'))}`)
  console.log(`  owned comments    : ${await ownedCounts('comments', (q) => (q as { eq: (c: string, v: string) => unknown }).eq('source', 'owned'))}`)
  console.log(`  account_events    : ${await ownedCounts('account_events')}`)
  console.log(`  weekly_reports    : ${await ownedCounts('weekly_reports')}`)

  const { data: events } = await admin
    .from('account_events')
    .select('run_id, platform, metric, severity, explained, magnitude_label')
    .eq('client_id', DEMO_CLIENT_ID)
  for (const e of (events ?? []) as Row[]) {
    const w = weeks.find((x) => x.runId === e.run_id)?.week ?? '??'
    console.log(`    ${w} [sev ${e.severity}] ${e.magnitude_label} — ${e.explained ? 'explained' : 'unexplained'}`)
  }
  console.log('=================================================\n')
}

// ---- main -------------------------------------------------------------------

async function main() {
  // Fail before deleteDemo(): validating only inside createTenant() meant a
  // run without DEMO_PASSWORD destroyed the demo tenant and THEN threw,
  // leaving no workspace and no login.
  demoPassword()
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (source .env.local first)')
  }
  console.log('› Tearing down any existing demo data…')
  await deleteDemo()

  console.log('› Creating demo tenant + login…')
  const { password } = await createTenant()

  console.log('› Inserting 6 pipeline_runs…')
  await insertRuns()

  console.log('› Cloning the real Ossur run into W6 (this copies the full corpus)…')
  const { maps, actual } = await cloneW6()

  console.log('› Anchoring the W1–W6 arc to the corpus-computed W6…')
  const weeks = anchorWeeks(actual)
  for (const w of weeks) {
    const { error } = await admin.from('pipeline_runs').update({ videos_scraped: w.totalVideos }).eq('id', w.runId)
    if (error) throw new Error(`update pipeline_runs ${w.week}: ${error.message}`)
  }

  console.log('› Writing the W6 run_summary from corpus metrics…')
  await insertRunSummaryW6(weeks[weeks.length - 1], weeks[weeks.length - 2], actual)

  console.log('› Appending the tracked-theme trajectory to W6…')
  await insertCarriedThemes(weeks[weeks.length - 1])

  console.log('› Building W1–W5 aggregate history…')
  for (let i = 0; i < weeks.length - 1; i++) await insertHistoryWeek(weeks[i], i > 0 ? weeks[i - 1] : null)

  console.log('› Seeding the owned layer (snapshots, own posts, own-post comments)…')
  await insertOwnedLayer(weeks)

  console.log('› Step 2c — detecting + explaining owned-account events…')
  await runOwnedEvents(weeks)

  console.log('› Storing the six weekly reports…')
  await storeReports()

  await verify(maps, password, weeks)
  console.log('✓ Demo seed complete.')
}

main().catch((e) => {
  console.error('\n✗ seed-demo failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
