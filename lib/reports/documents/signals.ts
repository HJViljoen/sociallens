import type { SupabaseClient } from '@supabase/supabase-js'
import { selectAll } from '../../supabase-admin'
import { DOCUMENT_MERGE_LEXICAL_THRESHOLD, DOCUMENT_MERGE_THRESHOLD } from '../../config'
import { computeRunDelta, loadRunSummary, readShare, type RunDelta, type RunSummaryRow } from '../../report-delta'
import { loadBrandClaims, type BrandClaim, type BrandVoiceSnapshot } from '../../pipeline/claims'
import type { CiSummary, SayVsHearEntry } from '../../pipeline/schemas'
import { normalisePersona, type Persona } from '../../profile-tiles'
import { shortPhrases, themeTrajectories, type ThemeHistoryRow, type Trajectory } from '../../voice-tiles'
import { englishHits, keywordsOf } from '../../quotes'
import { quoteRef } from '../../renderables/quotes-freeze'
import type { Quote } from '../../renderables/types'
import { competitorThemes, mergeAcrossBuckets, trajectoryWord, type MergeThemeRow, type MergedConcern } from './merge'
import type { DocumentSettings } from './types'

/**
 * The researcher's reading of an update, in code, before a single question is
 * asked: the numbers, what moved, the themes across buckets merged into
 * concerns, each competitor's own pitch and its users' praise and pain, what
 * the brand claims against what its audience says, the personas, the phrases.
 * The writer never sees a comment's text: phrases and hero quotes travel as
 * refs from here on (AGENTS: nothing under lib/reports/ sends a comment to a
 * model), and the language gate counts what it held back.
 *
 * Reads with the admin client: a build runs for a schedule with no session,
 * and the tenant is the reports row's, never a request body's.
 */

export interface CompetitorSignal {
  name: string
  bucket: string
  /** What they say in their own videos (their marketing, not a comment). */
  claims: BrandClaim[]
  praise: MergeThemeRow[]
  hurt: MergeThemeRow[]
  asks: MergeThemeRow[]
  /** Share of tracked videos this update and across all updates, %. */
  shareNow: number | null
  shareAll: number | null
  videosNow: number
  thin: boolean
}

export interface PersonaSignal extends Persona {
  bucketMix: Record<string, number>
  themeIds: string[]
}

export interface Signals {
  clientId: string
  runId: string
  runDate: string
  runStatus: string
  company: string
  brandKeywords: string[]
  industryKeywords: string[]
  trackedCompetitors: string[]
  updatesCount: number
  run: {
    conversations: number
    videos: number
    clientVideos: number
    competitorVideos: number
    positivePct: number | null
    judged: number
    clientSharePct: number | null
    /** From run_summary; period layer preferred. */
    summary: RunSummaryRow
  }
  delta: RunDelta | null
  themes: MergeThemeRow[]
  concerns: MergedConcern[]
  trajectoryOf: (themeId: string) => string | null
  competitors: CompetitorSignal[]
  sayVsHear: SayVsHearEntry[]
  brandVoice: BrandVoiceSnapshot | null
  ciSummary: CiSummary | null
  personas: PersonaSignal[]
  /** Customer phrases as refs, English-reading only. */
  phrases: { quote: Quote; platform: string | null }[]
  heldBackPhrases: number
  competitiveInsights: { id: string; category: string; competitor_name: string | null; title: string; finding: string; impact_level: string }[]
}

export class SignalsError extends Error {}

export async function loadSignals(
  admin: SupabaseClient,
  args: { clientId: string; runId?: string | null; settings: DocumentSettings },
): Promise<Signals> {
  const { clientId } = args

  const [{ data: client }, { data: config }, { data: latestRun }, runningRes, historyRows, summaryRows] = await Promise.all([
    admin.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    admin.from('tracking_configs').select('brand_keywords, competitor_names, industry_keywords').eq('client_id', clientId).maybeSingle(),
    args.runId
      ? admin.from('pipeline_runs').select('id, status, started_at, completed_at').eq('id', args.runId).eq('client_id', clientId).maybeSingle()
      : admin.from('pipeline_runs').select('id, status, started_at, completed_at').eq('client_id', clientId).in('status', ['completed', 'partial']).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('pipeline_runs').select('id').eq('client_id', clientId).eq('status', 'running'),
    selectAll<ThemeHistoryRow>(() =>
      admin.from('themes').select('run_id, registry_id, label, category, bucket, strength_score, evidence_count, first_seen')
        .eq('client_id', clientId).order('run_id', { ascending: true }).order('id', { ascending: true }),
    ),
    selectAll<{ run_id: string; run_date: string }>(() =>
      admin.from('run_summary').select('run_id, run_date').eq('client_id', clientId).order('run_date', { ascending: true }),
    ),
  ])
  if (!latestRun) throw new SignalsError('Nothing to write from yet: your first update has not landed.')
  const runId = latestRun.id as string
  const company = (client?.company_name as string | undefined) ?? 'the company'
  const brandKeywords = ((config?.brand_keywords ?? []) as string[]).filter(Boolean)
  const industryKeywords = ((config?.industry_keywords ?? []) as string[]).filter(Boolean)
  const trackedCompetitors = ((config?.competitor_names ?? []) as string[]).filter(Boolean)
  const wanted = args.settings.competitors?.length
    ? trackedCompetitors.filter((c) => args.settings.competitors!.some((w) => w.toLowerCase() === c.toLowerCase()))
    : trackedCompetitors

  const runningIds = ((runningRes.data ?? []) as { id: string }[]).map((r) => r.id)
  const themedRunIds = new Set(historyRows.map((r) => r.run_id))
  themedRunIds.add(runId)
  const runDates = new Map(summaryRows.filter((s) => s.run_id && themedRunIds.has(s.run_id) && !runningIds.includes(s.run_id)).map((s) => [s.run_id, s.run_date]))
  if (!runDates.has(runId)) runDates.set(runId, (latestRun.started_at as string).slice(0, 10))
  const runDate = runDates.get(runId) ?? (latestRun.started_at as string)

  const [themeRows, summary, sayHearRes, profileRes, samplesRes, ciRes, claims] = await Promise.all([
    selectAll<ThemeDbRow>(() =>
      admin.from('themes')
        .select('id, registry_id, bucket, category, label, description, supporting_insight_ids, supporting_video_ids, evidence_count, strength_score, rank_score, dominant_emotion, dominant_sentiment_impact, single_source, first_seen, embedding')
        .eq('client_id', clientId).eq('run_id', runId)
        .order('rank_score', { ascending: false, nullsFirst: false }).order('id', { ascending: true }),
    ),
    loadRunSummary(admin, clientId, runId),
    admin.from('run_summary').select('say_vs_hear, brand_voice').eq('client_id', clientId).eq('run_id', runId).maybeSingle(),
    admin.from('consumer_profiles').select('personas, run_date').eq('client_id', clientId).order('run_date', { ascending: false }).limit(1).maybeSingle(),
    admin.from('language_samples_current').select('id, phrase, platform').eq('client_id', clientId).order('phrase').limit(400),
    admin.from('competitive_insights').select('id, category, competitor_name, title, finding, impact_level').eq('client_id', clientId).eq('run_id', runId),
    loadBrandClaims(admin, clientId, trackedCompetitors, brandKeywords),
  ])
  if (!summary) throw new SignalsError('This update has no summary to write from.')

  const themes: MergeThemeRow[] = themeRows.map((r) => ({
    id: r.id,
    registryId: r.registry_id,
    bucket: r.bucket,
    category: r.category,
    label: r.label,
    description: r.description ?? '',
    evidenceCount: Number(r.evidence_count ?? 0),
    rankScore: Number(r.rank_score ?? 0),
    strengthScore: Number(r.strength_score ?? 0),
    singleSource: !!r.single_source,
    firstSeen: !!r.first_seen,
    embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
    supportingInsightIds: r.supporting_insight_ids ?? [],
    supportingVideoIds: r.supporting_video_ids ?? [],
    dominantEmotion: r.dominant_emotion,
    dominantSentimentImpact: r.dominant_sentiment_impact,
  }))

  // History in words: the registry join Voice uses, so "new" and "seen N
  // updates" mean here what they mean on the page.
  const { trajectories, keyOf } = themeTrajectories(historyRows.filter((r) => !runningIds.includes(r.run_id)), runDates)
  const trajByKey = new Map<string, Trajectory>(trajectories.map((t) => [t.key, t]))
  const themeById = new Map(themes.map((t) => [t.id, t]))
  const trajectoryOf = (themeId: string): string | null => {
    const t = themeById.get(themeId)
    if (!t) return null
    return trajectoryWord(trajByKey.get(keyOf({ registry_id: t.registryId, label: t.label })))
  }

  const concerns = mergeAcrossBuckets(themes, { threshold: DOCUMENT_MERGE_THRESHOLD, lexicalThreshold: DOCUMENT_MERGE_LEXICAL_THRESHOLD, trajectoryOf: (t) => trajectoryOf(t.id) })

  const sovNow = summary.period_share_of_voice ?? summary.share_of_voice
  const sovAll = summary.share_of_voice
  const shareNow = readShare(sovNow)
  const pct = (sov: Record<string, { pct_videos?: number | string | null; videos?: number | string | null }> | null, bucket: string) => {
    const e = sov?.[bucket]
    return e ? Number(e.pct_videos ?? 0) : null
  }
  const videos = (sov: Record<string, { videos?: number | string | null }> | null, bucket: string) => Number(sov?.[bucket]?.videos ?? 0)

  const competitors: CompetitorSignal[] = wanted.map((name) => {
    const bucket = `competitor:${name}`
    const own = competitorThemes(themes, bucket)
    const videosNow = videos(sovNow, bucket)
    return {
      name,
      bucket,
      claims: claims.competitors.filter((c) => c.competitor?.toLowerCase() === name.toLowerCase()).slice(0, 8),
      ...own,
      shareNow: pct(sovNow, bucket),
      shareAll: pct(sovAll, bucket),
      videosNow,
      thin: videosNow < 5 && own.praise.length + own.hurt.length < 3,
    }
  })

  const delta = await computeRunDelta(admin, clientId, summary)

  const rawPersonas = ((profileRes.data?.personas ?? []) as Partial<Persona & { bucketMix: Record<string, number>; themeIds: string[] }>[])
  const personas: PersonaSignal[] = rawPersonas
    .map((p) => {
      const n = normalisePersona(p)
      if (!n) return null
      const mix = p.bucketMix && typeof p.bucketMix === 'object' ? p.bucketMix : {}
      return { ...n, bucketMix: mix, themeIds: Array.isArray(p.themeIds) ? p.themeIds.filter((x): x is string => typeof x === 'string') : [] }
    })
    .filter((p): p is PersonaSignal => !!p)

  // Phrases: English-reading, about the things the brief is about (they share
  // a content word with a concern or a competitor theme), four to fourteen
  // words, as refs. The count held back is what the method line and the
  // workings report; a Thai phrase is signal, not noise, it just cannot lead
  // an English page.
  const samples = ((samplesRes.data ?? []) as { id: string; phrase: string; platform: string | null }[])
  const english = samples.filter((s) => englishHits(s.phrase) >= 2 && s.phrase.length >= 12)
  const phrases = pickPhrases(english, [...concerns.map((c) => c.label), ...concerns.map((c) => c.description), ...competitors.flatMap((c) => [...c.praise, ...c.hurt].map((t) => t.label))])
    .map((s) => ({ quote: { ref: quoteRef.phrase(s.id), text: s.phrase }, platform: s.platform }))

  const aud = summary.period_audience_sentiment ?? summary.audience_sentiment
  const positivePct = aud?.positive == null ? null : Number(aud.positive)

  return {
    clientId,
    runId,
    runDate,
    runStatus: latestRun.status as string,
    company,
    brandKeywords,
    industryKeywords,
    trackedCompetitors,
    updatesCount: runDates.size,
    run: {
      conversations: Number(summary.period_comments ?? summary.total_comments ?? 0),
      videos: Number(summary.period_videos ?? summary.total_videos ?? 0),
      clientVideos: videos(sovNow, 'client'),
      competitorVideos: wanted.reduce((n, c) => n + videos(sovNow, `competitor:${c}`), 0),
      positivePct,
      judged: Number(aud?.judged ?? 0),
      clientSharePct: shareNow?.client ?? null,
      summary,
    },
    delta,
    themes,
    concerns,
    trajectoryOf,
    competitors,
    sayVsHear: ((sayHearRes.data?.say_vs_hear ?? []) as SayVsHearEntry[] | null) ?? [],
    brandVoice: (sayHearRes.data?.brand_voice ?? null) as BrandVoiceSnapshot | null,
    ciSummary: summary.consumer_intelligence_summary ?? null,
    personas,
    phrases,
    heldBackPhrases: samples.length - english.length,
    competitiveInsights: (ciRes.data ?? []) as Signals['competitiveInsights'],
  }
}

/** Phrases that speak to the brief's subjects: score by content words shared
 *  with the concerns and competitor themes, keep four to fourteen words, the
 *  best thirty. Falls back to the shortest when fewer than ten score. */
export function pickPhrases<T extends { phrase: string }>(samples: T[], subjects: string[], n = 30): T[] {
  const subjectWords = new Set(subjects.flatMap((s) => [...keywordsOf(s)]))
  const words = (s: string) => s.trim().split(/\s+/).length
  const scored = samples
    .filter((s) => { const w = words(s.phrase); return w >= 4 && w <= 14 })
    .map((s) => ({ s, score: [...keywordsOf(s.phrase)].filter((k) => subjectWords.has(k)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.phrase.length - b.s.phrase.length)
  const seen = new Set<string>()
  const out: T[] = []
  for (const { s } of scored) {
    const key = s.phrase.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= n) break
  }
  return out.length >= 10 ? out : shortPhrases(samples, n, 14)
}

interface ThemeDbRow {
  id: string
  registry_id: string | null
  bucket: string
  category: string
  label: string
  description: string | null
  supporting_insight_ids: string[] | null
  supporting_video_ids: string[] | null
  evidence_count: number | null
  strength_score: number | null
  rank_score: number | string | null
  dominant_emotion: string | null
  dominant_sentiment_impact: string | null
  single_source: boolean | null
  first_seen: boolean | null
  embedding: unknown
}
