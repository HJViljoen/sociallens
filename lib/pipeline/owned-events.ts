import { zodResponseFormat } from 'openai/helpers/zod'
import { createAdminClient } from '../supabase-admin'
import { openai, samplingParams } from '../openai'
import { SYNTHESIS_MODEL, estimateCost } from '../config'
import { Step2cSchema, type Step2cOutput } from './schemas'
import { logAiCall } from './ai-log'
import { CALIBRATED_PROSE_RULE } from './prose-rules'
import { followerFloorPct } from '../gather/owned'

// Step 2c — owned-account events (Architecture/Owned-Data-Plan 2026-07-08).
// "Code rates, AI explains", a third time: code detects events on the client's
// own account metric series (account_snapshots + owned posts) and decides
// whether there is anything to explain at all; one GPT call per run explains
// the detected events from the run's themes + the comments on the client's own
// posts. "Unexplained" is a first-class outcome — when the tracked conversation
// doesn't account for a movement, the event is stored with explained=false and
// surfaces say so plainly. One invented cause kills trust in every card.
//
// Detection thresholds are PROVISIONAL — calibrated on the demo tenant's arc,
// flagged for review against the first real owned series (like lib/curation.ts).

// v2: hero_quote is required on explained events (v1 left it optional and the
// model skipped it), and the copy rule spells out "no surrounding quotation
// marks"; validation strips wrapping quotes before matching either way.
const PROMPT_VERSION = 'step_2c_v2'

// ---- detection ---------------------------------------------------------------

/** A follower delta only counts as an event when it clears BOTH bars:
 *  at least this % move week-over-week … */
const FOLLOWER_PCT_FLOOR = 1.5
/** …and at least this multiple of the series' typical (median) move. */
const FOLLOWER_BASELINE_MULTIPLE = 3
/** An owned post is an event at this multiple of the account's median post engagement. */
const POST_BASELINE_MULTIPLE = 4
/** Minimum prior deltas / prior posts before a baseline is trustworthy. */
const MIN_BASELINE_POINTS = 2
const MIN_BASELINE_POSTS = 4

export interface SnapshotRow {
  platform: string
  snapshot_date: string
  followers: number | null
}

export interface OwnedVideoRow {
  id: string
  run_id: string | null
  platform: string
  caption: string | null
  views: number | null
  likes: number | null
  comments_count: number | null
}

export interface DetectedEvent {
  platform: string
  metric: 'followers' | 'post_performance'
  eventDate: string // ISO date
  direction: 'up' | 'down'
  magnitudePct: number
  magnitudeLabel: string
  severity: 1 | 2 | 3
  videoId: string | null
  /** Code-rendered facts handed to the model — never raw numbers it could distort. */
  factLine: string
}

const round1 = (n: number) => Math.round(n * 10) / 10
const fmtInt = (n: number) => Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const median = (nums: number[]): number => {
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const PLATFORM_LABEL: Record<string, string> = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' }
const cap = (s: string) => PLATFORM_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1)

function followerSeverity(absPct: number): 1 | 2 | 3 {
  return absPct >= 6 ? 3 : absPct >= 3 ? 2 : 1
}

/**
 * Detect events in the window (windowStart, windowEnd]. Pure — no DB, no GPT.
 * Follower events: the latest week-over-week delta per platform, judged against
 * the median of that platform's earlier deltas. Post events: an owned post in
 * the window whose engagement is a multiple of the account's earlier median.
 */
/**
 * Compress a (possibly daily) snapshot series to weekly anchor points: walk
 * back from the latest snapshot keeping only points ≥6.5 days apart. On an
 * already-weekly series this returns the input unchanged, so pre-Wave-2
 * behavior is preserved exactly.
 */
export function weeklyAnchors(sortedAsc: SnapshotRow[]): SnapshotRow[] {
  if (sortedAsc.length < 2) return sortedAsc
  const picked: SnapshotRow[] = []
  let anchorT = Infinity
  for (let i = sortedAsc.length - 1; i >= 0; i--) {
    const t = Date.parse(sortedAsc[i].snapshot_date)
    if (anchorT - t >= 6.5 * 86_400_000 || picked.length === 0) {
      picked.push(sortedAsc[i])
      anchorT = t
    }
  }
  return picked.reverse()
}

export function detectAccountEvents(args: {
  snapshots: SnapshotRow[]
  ownedVideos: OwnedVideoRow[]
  /** run_id → run date (ISO) — assigns owned posts to their week. */
  runDates: Map<string, string>
  windowStart: string | null
  windowEnd: string
}): DetectedEvent[] {
  const { snapshots, ownedVideos, runDates, windowStart, windowEnd } = args
  const events: DetectedEvent[] = []
  const inWindow = (d: string) => (windowStart ? d > windowStart : true) && d <= windowEnd

  // ---- follower events, per platform ----
  const byPlatform = new Map<string, SnapshotRow[]>()
  for (const s of snapshots) {
    if (s.followers == null || s.snapshot_date > windowEnd.slice(0, 10)) continue
    const arr = byPlatform.get(s.platform) ?? []
    arr.push(s)
    byPlatform.set(s.platform, arr)
  }
  for (const [platform, rows] of byPlatform) {
    // Daily snapshots (Wave 2 cron) would make consecutive deltas day-over-day
    // — meaningless against the weekly floor. Compress to weekly anchors first:
    // on a weekly series this is the identity.
    const series = weeklyAnchors(rows.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)))
    if (series.length < 2) continue
    const last = series[series.length - 1]
    if (!inWindow(last.snapshot_date)) continue // no fresh snapshot this window

    const deltasPct: number[] = []
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1].followers!
      if (prev > 0) deltasPct.push(((series[i].followers! - prev) / prev) * 100)
    }
    const latest = deltasPct[deltasPct.length - 1]
    const baseline = deltasPct.slice(0, -1).map(Math.abs)
    if (baseline.length < MIN_BASELINE_POINTS) {
      console.log(`[step2c] audit ${platform}: weekly points=${series.length} baseline=${baseline.length} — too little history to judge`)
      continue
    }

    const typical = Math.max(median(baseline), 0.2)
    // YouTube's subscriberCount rounds to 3 sig figs — the floor must clear
    // two rounding steps or rounding noise fakes an event on small channels.
    const floor = followerFloorPct(platform, last.followers!, FOLLOWER_PCT_FLOOR)
    const fires = Math.abs(latest) >= floor && Math.abs(latest) >= typical * FOLLOWER_BASELINE_MULTIPLE
    console.log(`[step2c] audit ${platform}: latest=${round1(latest)}% typical=${round1(typical)}% floor=${round1(floor)}% → ${fires ? 'FIRES' : 'no event'}`)
    if (!fires) continue

    const prevFollowers = series[series.length - 2].followers!
    const diff = last.followers! - prevFollowers
    const direction = diff >= 0 ? 'up' : 'down'
    const label = `${diff >= 0 ? '+' : '−'}${fmtInt(diff)} followers on ${cap(platform)} (${diff >= 0 ? '+' : '−'}${round1(Math.abs(latest))}%) in a week`
    events.push({
      platform,
      metric: 'followers',
      eventDate: last.snapshot_date,
      direction,
      magnitudePct: round1(latest),
      magnitudeLabel: label,
      severity: followerSeverity(Math.abs(latest)),
      videoId: null,
      factLine: `${cap(platform)} followers moved ${diff >= 0 ? 'up' : 'down'} ${round1(Math.abs(latest))}% week-over-week (typical weekly move: ${round1(typical)}%)`,
    })
  }

  // ---- post-performance events, per platform ----
  const engagement = (v: OwnedVideoRow) => (Number(v.likes) || 0) + (Number(v.comments_count) || 0)
  const dated = ownedVideos
    .map((v) => ({ v, date: v.run_id ? runDates.get(v.run_id) ?? null : null }))
    .filter((x): x is { v: OwnedVideoRow; date: string } => x.date != null)
  for (const platform of new Set(dated.map((x) => x.v.platform))) {
    const mine = dated.filter((x) => x.v.platform === platform)
    const prior = mine.filter((x) => (windowStart ? x.date <= windowStart : false)).map((x) => engagement(x.v))
    if (prior.length < MIN_BASELINE_POSTS) continue
    const typical = Math.max(median(prior), 10)
    for (const { v, date } of mine.filter((x) => inWindow(x.date))) {
      const eng = engagement(v)
      if (eng < typical * POST_BASELINE_MULTIPLE) continue
      const ratio = eng / typical
      events.push({
        platform,
        metric: 'post_performance',
        eventDate: date.slice(0, 10),
        direction: 'up',
        magnitudePct: round1(ratio * 100),
        magnitudeLabel: `A post on ${cap(platform)} reached ${round1(ratio)}× your typical engagement`,
        severity: ratio >= POST_BASELINE_MULTIPLE * 2 ? 3 : 2,
        videoId: v.id,
        factLine: `An owned ${cap(platform)} post drew ${fmtInt(eng)} engagements — ${round1(ratio)}× the account's median post${v.caption ? ` (caption: "${v.caption.slice(0, 120)}")` : ''}`,
      })
    }
  }

  // Severity first, so the strongest event leads every surface.
  return events.sort((a, b) => b.severity - a.severity || Math.abs(b.magnitudePct) - Math.abs(a.magnitudePct))
}

// ---- explanation (one GPT call) -----------------------------------------------

interface ThemeLite {
  label: string
  bucket: string
  category: string
  evidence_count: number | null
  strength_score: number | null
  dominant_emotion: string | null
}

interface OwnedCommentRow {
  text: string | null
  likes: number | null
  platform: string
}

export interface ExplainedEvent extends DetectedEvent {
  explained: boolean
  explanation: string | null
  supportingThemeLabels: string[]
  heroQuote: string | null
}

const asUnexplained = (e: DetectedEvent): ExplainedEvent => ({
  ...e, explained: false, explanation: null, supportingThemeLabels: [], heroQuote: null,
})

function buildSystemPrompt(brandName: string): string {
  return [
    'You are a media-based consumer intelligence analyst working for a brand.',
    '',
    `The brand is ${brandName}. Its own social accounts moved this week — code has already`,
    'measured the movements (the EVENTS below; sizes are facts, not estimates). Your ONLY job',
    'is to say WHY each event happened, using nothing but the audience themes and the real',
    'comments from the brand\'s own posts provided below.',
    '',
    'Rules:',
    '- For each event, decide honestly: does the provided material actually account for it?',
    '- If it does: explained=true, a 1–2 sentence explanation grounded in the material,',
    '  supporting_themes listing the T# indices you drew on (only indices present in the input),',
    '  and hero_quote — REQUIRED on every explained event — set to the single most telling',
    '  comment, copied EXACTLY, character for character, from the COMMENTS list. Copy the',
    '  comment text only: no surrounding quotation marks, no [Q#] tag. Never edit, trim, or',
    '  merge quotes.',
    '- If it does NOT: explained=false, explanation=null, empty supporting_themes, hero_quote=null.',
    '  An honest "the tracked conversation doesn\'t account for this" is a valid, expected outcome.',
    '  NEVER invent a plausible-sounding cause the material does not show.',
    '- Do NOT invent counts, percentages, or metrics; the measured numbers are rendered by code.',
    CALIBRATED_PROSE_RULE,
    '- Return one entry per E# event, in the same order.',
  ].join('\n')
}

function buildUserPrompt(
  events: DetectedEvent[],
  themes: ThemeLite[],
  comments: string[],
  brandName: string,
): string {
  const lines: string[] = []
  lines.push(`EVENTS (${events.length})`)
  events.forEach((e, i) => lines.push(`[E${i + 1}] ${e.factLine}`))
  lines.push('')
  lines.push(`AUDIENCE THEMES this update (${themes.length})`)
  themes.forEach((t, i) =>
    lines.push(
      `[T${i + 1}] bucket=${t.bucket} category=${t.category} "${t.label}" · ${t.evidence_count ?? 0} conversations · strength ${t.strength_score ?? '—'} · ${t.dominant_emotion ?? '—'}`,
    ),
  )
  lines.push('')
  lines.push(`COMMENTS on ${brandName}'s own posts (verbatim; most-liked first)`)
  comments.forEach((c, i) => lines.push(`[Q${i + 1}] "${c}"`))
  return lines.join('\n')
}

/**
 * Load everything for a run, detect, explain, persist. The single entry point
 * for scripts, the seed, and (Phase 2) the Inngest pipeline. Detection alone
 * never needs GPT; when no events fire, no call is made and nothing is stored —
 * "nothing to explain" is cheap by design. A failed/skipped explanation still
 * persists the detected events as unexplained (honest, not silent).
 */
export async function runStep2c(args: {
  clientId: string
  runId: string
  persist?: boolean
}): Promise<{ events: ExplainedEvent[]; costUsd: number; skippedReason?: string }> {
  const { clientId, runId } = args
  const persist = args.persist ?? true
  const admin = createAdminClient()

  // Idempotent per (client, run) — clear before any early return.
  if (persist) {
    const { error } = await admin.from('account_events').delete().eq('client_id', clientId).eq('run_id', runId)
    if (error) throw new Error(`clear account_events: ${error.message}`)
  }

  // Run window: this run's completion back to the previous completed run's.
  const { data: run } = await admin
    .from('pipeline_runs').select('id, started_at, completed_at')
    .eq('client_id', clientId).eq('id', runId).maybeSingle()
  if (!run) throw new Error(`run ${runId} not found for client ${clientId}`)
  const windowEnd = (run.completed_at ?? run.started_at) as string
  const { data: prevRun } = await admin
    .from('pipeline_runs').select('completed_at')
    .eq('client_id', clientId).eq('status', 'completed')
    .lt('completed_at', windowEnd)
    .order('completed_at', { ascending: false }).limit(1).maybeSingle()
  const windowStart = (prevRun?.completed_at as string | undefined) ?? null

  const [{ data: snapRows }, { data: ownedRows }, { data: runRows }] = await Promise.all([
    admin.from('account_snapshots')
      .select('platform, snapshot_date, followers')
      .eq('client_id', clientId).order('snapshot_date', { ascending: true }),
    admin.from('videos')
      .select('id, run_id, platform, caption, views, likes, comments_count')
      .eq('client_id', clientId).eq('source', 'owned'),
    admin.from('pipeline_runs')
      .select('id, started_at, completed_at')
      .eq('client_id', clientId),
  ])
  const runDates = new Map(
    ((runRows ?? []) as { id: string; started_at: string | null; completed_at: string | null }[])
      .map((r) => [r.id, (r.completed_at ?? r.started_at ?? '') as string]),
  )

  const detected = detectAccountEvents({
    snapshots: (snapRows ?? []) as SnapshotRow[],
    ownedVideos: (ownedRows ?? []) as OwnedVideoRow[],
    runDates,
    windowStart,
    windowEnd,
  })
  if (detected.length === 0) {
    return { events: [], costUsd: 0, skippedReason: 'no events detected — nothing to explain' }
  }

  // Explanation material: the run's themes + comments on the brand's own posts
  // (bounded retrieval — never the raw corpus).
  const [{ data: client }, { data: themeRows }] = await Promise.all([
    admin.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    admin.from('themes')
      .select('label, bucket, category, evidence_count, strength_score, dominant_emotion')
      .eq('client_id', clientId).eq('run_id', runId)
      .order('strength_score', { ascending: false }),
  ])
  const themes = ((themeRows ?? []) as ThemeLite[]).slice(0, 30)
  const eventPlatforms = [...new Set(detected.map((e) => e.platform))]
  // Prefer THIS window's owned comments — an event should be explained by the
  // conversation around it, not a greatest-hit from months ago. Widen to
  // all-time only when the window is too thin to ground anything.
  const windowedQ = admin
    .from('comments')
    .select('text, likes, platform')
    .eq('client_id', clientId).eq('source', 'owned')
    .in('platform', eventPlatforms)
    .order('likes', { ascending: false })
    .limit(40)
  const { data: winRows } = windowStart
    ? await windowedQ.gt('comment_date', windowStart)
    : await windowedQ
  let pool = (winRows ?? []) as OwnedCommentRow[]
  if (pool.length < 10) {
    const { data: allRows } = await admin
      .from('comments')
      .select('text, likes, platform')
      .eq('client_id', clientId).eq('source', 'owned')
      .in('platform', eventPlatforms)
      .order('likes', { ascending: false })
      .limit(40)
    pool = (allRows ?? []) as OwnedCommentRow[]
  }
  const commentPool = pool
    .map((c) => (c.text ?? '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 0)

  let events = detected.map(asUnexplained)
  let costUsd = 0
  let skippedReason: string | undefined

  if (!process.env.OPENAI_API_KEY) {
    skippedReason = 'OPENAI_API_KEY not set — events stored unexplained'
  } else {
    const brandName = (client?.company_name as string | undefined)?.trim() || 'the brand'
    const systemPrompt = buildSystemPrompt(brandName)
    const userPrompt = buildUserPrompt(detected, themes, commentPool, brandName)
    const startedAt = Date.now()
    let parsed: Step2cOutput | null = null
    let usage = { prompt_tokens: 0, completion_tokens: 0 }
    try {
      const completion = await openai.chat.completions.parse({
        model: SYNTHESIS_MODEL,
        ...samplingParams(SYNTHESIS_MODEL),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: zodResponseFormat(Step2cSchema, 'step_2c'),
      })
      parsed = completion.choices[0]?.message?.parsed ?? null
      if (completion.usage) {
        usage = { prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens }
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      if (persist) {
        await logAiCall(admin, { clientId, runId, pass: 'step_2c', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION, systemPrompt, userPrompt, response: null, error, usage, durationMs: Date.now() - startedAt, validationStatus: 'parse_error' })
      }
      skippedReason = `explanation call failed — events stored unexplained (${error})`
    }
    const durationMs = Date.now() - startedAt
    costUsd = estimateCost(SYNTHESIS_MODEL, usage.prompt_tokens, usage.completion_tokens)

    if (parsed) {
      // Validation: T# refs must exist (stored as labels); hero_quote must be an
      // exact copy of a shown comment; an "explained" verdict with no surviving
      // grounding (no valid theme AND no valid quote) is downgraded to
      // unexplained — code guards confabulation, not the prompt.
      // Normalise whitespace AND strip wrapping quote marks — the prompt shows
      // each comment inside "…", and a copy that keeps them is still the same
      // verbatim. The canonical original is what gets stored.
      const norm = (s: string) =>
        s.replace(/\s+/g, ' ').trim().replace(/^["'‘’“”]+|["'‘’“”]+$/g, '').trim().toLowerCase()
      const shownByNorm = new Map(commentPool.map((q) => [norm(q), q]))
      let rejectedRefs = 0
      const byIndex = new Map(parsed.events.map((ev) => [String(ev.index).replace(/[^0-9]/g, ''), ev]))
      events = detected.map((d, i) => {
        const ev = byIndex.get(String(i + 1))
        if (!ev || !ev.explained || !ev.explanation) return asUnexplained(d)
        const labels: string[] = []
        for (const ref of ev.supporting_themes) {
          const idx = Number(String(ref).replace(/[^0-9]/g, '')) - 1
          if (Number.isInteger(idx) && idx >= 0 && idx < themes.length) labels.push(themes[idx].label)
          else rejectedRefs++
        }
        const heroQuote = ev.hero_quote ? shownByNorm.get(norm(ev.hero_quote)) ?? null : null
        if (labels.length === 0 && !heroQuote) return asUnexplained(d)
        return { ...d, explained: true, explanation: ev.explanation, supportingThemeLabels: [...new Set(labels)], heroQuote }
      })
      if (persist) {
        await logAiCall(admin, {
          clientId, runId, pass: 'step_2c', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION, systemPrompt, userPrompt,
          response: { events: events.length, explained: events.filter((e) => e.explained).length, rejected_refs: rejectedRefs },
          error: null, usage, durationMs,
          validationStatus: rejectedRefs > 0 ? 'ref_rejected' : 'ok',
        })
      }
    }
  }

  if (persist) {
    const rows = events.map((e) => ({
      client_id: clientId,
      run_id: runId,
      platform: e.platform,
      metric: e.metric,
      event_date: e.eventDate.slice(0, 10),
      direction: e.direction,
      magnitude_pct: e.magnitudePct,
      magnitude_label: e.magnitudeLabel,
      severity: e.severity,
      video_id: e.videoId,
      explained: e.explained,
      explanation: e.explanation,
      supporting_theme_labels: e.supportingThemeLabels,
      hero_quote: e.heroQuote,
    }))
    const { error } = await admin.from('account_events').insert(rows)
    if (error) throw new Error(`persist account_events: ${error.message}`)
  }

  return { events, costUsd, skippedReason }
}
