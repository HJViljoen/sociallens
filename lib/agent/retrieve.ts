import { embedTexts } from '../pipeline/cluster'
import { selectAll } from '../supabase-admin'
import {
  bucketByAudienceId,
  scopeToClientVoices,
  fetchInsightsByIds,
  fetchQuoteCitationsByAudience,
  type QuoteCitation,
} from '../quotes'
import { AGENT_INSIGHTS_PER_QUERY, AGENT_INSIGHTS_TOTAL, CITATION_RELEVANCE_FLOOR } from '../config'
import { fuseHits, countConversations, type Hit } from './rank'

// The retrieval half of the Verbatim Agent. Its whole job is to put real
// insights and real quotes in front of the answering model, entity-scoped and
// redaction-filtered, so that everything downstream is arguing about text that
// actually came from this tenant's corpus.
//
// It reaches INSIGHT level, not theme level. Answering a client's question off
// ~334 one-line theme headers is the "synthesis on headers" defect the August
// cold review found in Pass C/D, and it would sit here at the surface the
// client touches most.

export interface RetrievedInsight {
  id: string
  theme: string
  description: string
  emotion: string | null
  journeyStage: string | null
  videoId: string | null
  bucket: string
  similarity: number
  quotes: QuoteCitation[]
}

export interface RetrievedContext {
  insights: RetrievedInsight[]
  /** DISTINCT source videos behind the retrieved insights — "conversations" in
   *  the product's fixed vocabulary. Computed here, never by a model. */
  conversationCount: number
  /** Queries that returned nothing above the floor. Surfaced so the caller can
   *  tell "the corpus is silent on this" apart from "retrieval was never run",
   *  and so the operator lever can see WHICH angle found nothing. */
  emptyQueries: string[]
  runId: string
}

type Admin = ReturnType<typeof import('../supabase-admin').createAdminClient>

/** Newest run that actually produced analysis. Mirrors the dashboard pages: an
 *  in-flight run has no themes yet, so the agent keeps answering from the last
 *  closed corpus rather than going blank mid-run. */
export async function latestRunId(admin: Admin, clientId: string): Promise<string | null> {
  const { data } = await admin
    .from('pipeline_runs')
    .select('id, started_at')
    .eq('client_id', clientId)
    .in('status', ['completed', 'partial'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

interface ThemeBucketRow {
  bucket: string | null
  supporting_insight_ids: string[] | null
}

/**
 * Retrieve the corpus context for one question.
 *
 * `queries` is the question expanded into the vocabulary the corpus actually
 * uses (lib/agent/interpret.ts) — clients ask "should we run a Black Friday
 * promo", and no theme is labelled that.
 */
export async function retrieveForQueries(
  admin: Admin,
  args: {
    clientId: string
    runId: string
    queries: string[]
    perQuery?: number
    limit?: number
    floor?: number
  },
): Promise<RetrievedContext> {
  const { clientId, runId } = args
  const queries = args.queries.map((q) => q.trim()).filter(Boolean)
  const perQuery = args.perQuery ?? AGENT_INSIGHTS_PER_QUERY
  const limit = args.limit ?? AGENT_INSIGHTS_TOTAL
  const floor = args.floor ?? CITATION_RELEVANCE_FLOOR

  if (queries.length === 0) {
    return { insights: [], conversationCount: 0, emptyQueries: [], runId }
  }

  const vectors = await embedTexts(queries)
  const perQueryHits: Hit[][] = []
  const emptyQueries: string[] = []

  for (let i = 0; i < queries.length; i++) {
    const { data, error } = await admin.rpc('match_insights', {
      p_client_id: clientId,
      p_query: vectors[i] as unknown as string,
      p_limit: perQuery,
      p_floor: floor,
    })
    // A failed retrieval must NOT read as an empty corpus — that would tell a
    // client "we have nothing on this" when the truth is the search broke.
    if (error) throw new Error(`match_insights("${queries[i]}"): ${error.message}`)
    const hits = ((data ?? []) as { id: string; similarity: number }[]).map((r) => ({
      id: r.id,
      similarity: r.similarity,
    }))
    if (hits.length === 0) emptyQueries.push(queries[i])
    perQueryHits.push(hits)
  }

  const fused = fuseHits(perQueryHits, { limit })
  if (fused.length === 0) {
    return { insights: [], conversationCount: 0, emptyQueries, runId }
  }

  // Entity scoping. A client's own question must never be answered with a
  // competitor's customers — the rule lives in lib/quotes.ts and every other
  // evidence surface obeys it. Themes of the current run are the only place
  // the bucket of an insight is recorded.
  const themeRows = await selectAll<ThemeBucketRow>(() =>
    admin
      .from('themes')
      .select('bucket, supporting_insight_ids')
      .eq('client_id', clientId)
      .eq('run_id', runId)
      .order('id', { ascending: true }),
  )
  const bucketById = bucketByAudienceId(
    themeRows.map((t) => ({ bucket: t.bucket ?? 'industry-other', supporting_insight_ids: t.supporting_insight_ids ?? [] })),
  )
  const scoped = new Set(scopeToClientVoices(fused.map((f) => f.id), bucketById))
  const kept = fused.filter((f) => scoped.has(f.id))
  if (kept.length === 0) {
    return { insights: [], conversationCount: 0, emptyQueries, runId }
  }

  // Base table, not the view: these are id-set lookups, and AGENTS.md keeps
  // those on the base table so a row an in-flight run has superseded but not
  // yet pruned still resolves.
  interface InsightRowLite {
    id: string
    theme: string | null
    description: string | null
    emotion: string | null
    journey_stage: string | null
    source_video_id: string | null
  }
  const rows = await fetchInsightsByIds<InsightRowLite>(
    admin,
    kept.map((k) => k.id),
    'id, theme, description, emotion, journey_stage, source_video_id',
  )
  const rowById = new Map(rows.map((r) => [r.id, r]))
  const quotesById = await fetchQuoteCitationsByAudience(admin, kept.map((k) => k.id))

  const insights: RetrievedInsight[] = []
  for (const hit of kept) {
    const row = rowById.get(hit.id)
    // An id that no longer resolves was pruned between the search and the
    // fetch. Dropping it is right; counting it would inflate the answer.
    if (!row) continue
    insights.push({
      id: row.id,
      theme: row.theme ?? '',
      description: row.description ?? '',
      emotion: row.emotion,
      journeyStage: row.journey_stage,
      videoId: row.source_video_id,
      bucket: bucketById.get(row.id) ?? 'industry-other',
      similarity: hit.bestSimilarity,
      quotes: (quotesById.get(row.id) ?? []).sort((a, b) => a.rank - b.rank),
    })
  }

  return {
    insights,
    conversationCount: countConversations(insights),
    emptyQueries,
    runId,
  }
}
