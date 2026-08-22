import { selectAll } from '../supabase-admin'
import { AGENT_TREND_MAX_RUNS, AGENT_TREND_MIN_POINTS, AGENT_TREND_MIN_EVIDENCE } from '../config'

// Cross-run context for the Verbatim Agent — the honest answer to "has this
// changed?".
//
// WHAT IS AND IS NOT AVAILABLE, because the difference is the whole design.
// prune-stale-analysis keeps only the CURRENT analysis of each video, and
// insight_evidence cascades with its parent, so April's insight text and its
// quotes cannot be retrieved. What survives every run untouched:
//   theme_observations  — a per-run time series, one row per (theme, run)
//   consumer_profiles   — one row per run, never overwritten
//   run_summary         — one row per run
// So a movement is reported from COUNTS and PROFILES, and the agent may never
// claim to be quoting what someone said three months ago. Every number here is
// a count of evidence rows a run saw; none of it is a forecast.

export interface ThemeSeriesPoint {
  runDate: string
  evidenceCount: number
  /** The label THAT run gave it. Labels churn ~88% run to run, which is why
   *  identity is the registry id and the label is only ever display. */
  label: string
}

export interface ThemeSeries {
  registryId: string
  canonicalLabel: string
  bucket: string
  points: ThemeSeriesPoint[]
  movement: Movement
}

export interface ProfilePoint {
  runDate: string
  personas: { key: string; name: string; evidenceCount: number }[]
}

export interface SummaryPoint {
  runDate: string
  totalVideos: number | null
  totalComments: number | null
  sentimentPositive: number | null
  sentimentNegative: number | null
}

export interface TrendContext {
  themes: ThemeSeries[]
  profiles: ProfilePoint[]
  summaries: SummaryPoint[]
  runsCovered: number
}

export type Movement = 'rising' | 'steady' | 'fading' | 'new' | 'too_few'

/**
 * Direction of travel for one theme — never a forecast number.
 *
 * Two floors, both deliberate. `too_few` when there are not enough points to
 * say anything: three to six weekly readings is noise, and a product that calls
 * noise a trend is the product that gets caught. `too_few` again when the
 * counts are tiny, because 2 → 4 is a doubling and it is also nothing.
 *
 * Pure, so it can be argued with in a test rather than in production.
 */
export function movement(points: { evidenceCount: number }[]): Movement {
  if (points.length === 1) return 'new'
  if (points.length < AGENT_TREND_MIN_POINTS) return 'too_few'
  const recent = points[points.length - 1].evidenceCount
  const prior = points.slice(0, -1)
  const priorMean = prior.reduce((n, p) => n + p.evidenceCount, 0) / prior.length
  if (recent < AGENT_TREND_MIN_EVIDENCE && priorMean < AGENT_TREND_MIN_EVIDENCE) return 'too_few'
  if (priorMean === 0) return recent > 0 ? 'rising' : 'steady'
  const ratio = recent / priorMean
  // ±25% of the prior mean. Anything inside that is the same theme having a
  // slightly different week.
  if (ratio >= 1.25) return 'rising'
  if (ratio <= 0.75) return 'fading'
  return 'steady'
}

interface ObservationRow {
  theme_id: string
  run_date: string | null
  evidence_count: number | null
  label: string | null
}

interface RegistryRow {
  id: string
  canonical_label: string
  bucket: string
}

interface ProfileRow {
  run_date: string
  personas: { key?: string; name?: string; evidence_count?: number; evidenceCount?: number }[] | null
}

interface SummaryRow {
  run_date: string | null
  total_videos: number | null
  total_comments: number | null
  overall_sentiment_positive: number | null
  overall_sentiment_negative: number | null
}

type Admin = ReturnType<typeof import('../supabase-admin').createAdminClient>

/**
 * Load the trend context for the registry ids a question actually retrieved.
 *
 * Scoped to those ids on purpose: a client asking about pricing does not need
 * the movement of every theme in the corpus, and handing a model the whole
 * history is how a specific question gets a general answer.
 *
 * Returns null when the tenant has fewer than two runs — there is no such thing
 * as a trend across one reading, and saying so is better than drawing a line
 * between a point and itself.
 */
export async function loadTrendContext(
  admin: Admin,
  args: { clientId: string; registryIds: string[]; maxRuns?: number },
): Promise<TrendContext | null> {
  const { clientId } = args
  const maxRuns = args.maxRuns ?? AGENT_TREND_MAX_RUNS
  const registryIds = [...new Set(args.registryIds.filter(Boolean))]

  const summaryRows = await selectAll<SummaryRow>(() =>
    admin
      .from('run_summary')
      .select('run_date, total_videos, total_comments, overall_sentiment_positive, overall_sentiment_negative')
      .eq('client_id', clientId)
      .order('run_date', { ascending: false }),
  )
  if (summaryRows.length < 2) return null

  const summaries: SummaryPoint[] = summaryRows
    .slice(0, maxRuns)
    .reverse()
    .map((r) => ({
      runDate: r.run_date ?? '',
      totalVideos: r.total_videos,
      totalComments: r.total_comments,
      sentimentPositive: r.overall_sentiment_positive,
      sentimentNegative: r.overall_sentiment_negative,
    }))

  const profileRows = await selectAll<ProfileRow>(() =>
    admin
      .from('consumer_profiles')
      .select('run_date, personas')
      .eq('client_id', clientId)
      .order('run_date', { ascending: false }),
  )
  const profiles: ProfilePoint[] = profileRows
    .slice(0, maxRuns)
    .reverse()
    .map((r) => ({
      runDate: r.run_date,
      personas: (Array.isArray(r.personas) ? r.personas : []).map((p) => ({
        key: String(p?.key ?? ''),
        name: String(p?.name ?? ''),
        evidenceCount: Number(p?.evidence_count ?? p?.evidenceCount ?? 0),
      })),
    }))

  let themes: ThemeSeries[] = []
  if (registryIds.length > 0) {
    const registry: RegistryRow[] = []
    for (let i = 0; i < registryIds.length; i += 120) {
      const { data } = await admin
        .from('theme_registry')
        .select('id, canonical_label, bucket')
        .eq('client_id', clientId)
        .in('id', registryIds.slice(i, i + 120))
      registry.push(...((data ?? []) as RegistryRow[]))
    }

    const observations: ObservationRow[] = []
    for (let i = 0; i < registryIds.length; i += 120) {
      const { data } = await admin
        .from('theme_observations')
        .select('theme_id, run_date, evidence_count, label')
        .eq('client_id', clientId)
        .in('theme_id', registryIds.slice(i, i + 120))
        .order('run_date', { ascending: true })
      observations.push(...((data ?? []) as ObservationRow[]))
    }

    const byTheme = new Map<string, ThemeSeriesPoint[]>()
    for (const o of observations) {
      const arr = byTheme.get(o.theme_id) ?? []
      arr.push({
        runDate: o.run_date ?? '',
        evidenceCount: o.evidence_count ?? 0,
        label: o.label ?? '',
      })
      byTheme.set(o.theme_id, arr)
    }

    themes = registry.map((r) => {
      const points = (byTheme.get(r.id) ?? []).slice(-maxRuns)
      return {
        registryId: r.id,
        canonicalLabel: r.canonical_label,
        bucket: r.bucket,
        points,
        movement: movement(points),
      }
    })
  }

  return { themes, profiles, summaries, runsCovered: summaries.length }
}
