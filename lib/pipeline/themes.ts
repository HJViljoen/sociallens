import { createAdminClient, selectAll } from '../supabase-admin'
import { THEME_MATCH_THRESHOLD, REGISTRY_DORMANT_RUNS, themeRegistryEnabled } from '../config'
import { embedTexts, cosine } from './cluster'
import { matchThemes, dormantIds, matchTally, type MatchKind, type RegistryEntry } from './theme-registry'
import type { AggregatedTheme } from './types'

// Theme persistence + mini theme-matching (Redesign Spec 2026-07-03 §8).
// Persists Step A2's clustered themes — with Pass B labels, the single-source
// tier, and a first_seen flag — to the `themes` table, replaced per (client,
// run). first_seen comes from embedding-matching this run's label+description
// against the PREVIOUS run's stored theme embeddings: unmatched = a new theme
// ("New" badges + the weekly-email delta). Deliberately NOT full genealogy —
// one boolean, computed once, no persistent theme identity across runs.

export interface PersistThemesResult {
  inserted: number
  firstSeen: number
  /** Registry match tally when THEME_REGISTRY is on — the run log's read on how
   *  stable identity actually was this week. Absent when the flag is off. */
  registry?: Record<MatchKind, number> & { entries: number; dormant: number }
  /** False on the client's first themed run — every theme is trivially "new",
   *  so pages should suppress the badge (detectable: no earlier themed run). */
  hadPreviousRun: boolean
}

/** Read a run's persisted themes back into the in-memory shape Pass C/D
 *  consume. Lets the synthesis half run in its own Inngest step, decoupled
 *  from Step A2/Pass B via the DB. sampleDescriptions aren't persisted (they
 *  only feed Pass B, which has already run by the time rows exist). */
export async function loadThemes(clientId: string, runId: string): Promise<AggregatedTheme[]> {
  const admin = createAdminClient()
  const rows = await selectAll<{
    label: string; description: string | null; bucket: string; category: string
    member_themes: string[]; supporting_insight_ids: string[]; supporting_video_ids: string[]
    evidence_count: number; strength_score: number | null
    dominant_emotion: string | null; dominant_sentiment_impact: string | null; single_source: boolean
  }>(() =>
    admin
      .from('themes')
      .select('label, description, bucket, category, member_themes, supporting_insight_ids, supporting_video_ids, evidence_count, strength_score, dominant_emotion, dominant_sentiment_impact, single_source')
      .eq('client_id', clientId).eq('run_id', runId)
      .order('strength_score', { ascending: false }).order('id', { ascending: true }),
  )
  return rows.map((r) => ({
    bucket: r.bucket,
    category: r.category,
    theme: r.member_themes[0] ?? r.label,
    memberThemes: r.member_themes,
    supportingVideoIds: r.supporting_video_ids,
    supportingInsightIds: r.supporting_insight_ids,
    evidenceCount: r.evidence_count,
    strengthScore: r.strength_score ?? 0,
    dominantEmotion: r.dominant_emotion ?? 'neutral',
    dominantSentimentImpact: r.dominant_sentiment_impact ?? 'neutral',
    singleSource: r.single_source,
    sampleDescriptions: [],
    label: r.label,
    description: r.description ?? undefined,
  }))
}

/** Text embedded for cross-run matching — the client-facing identity of the theme. */
function matchText(t: AggregatedTheme): string {
  return `${t.label ?? t.theme}. ${t.description ?? ''}`.trim()
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

export async function persistThemes(
  clientId: string,
  runId: string,
  themes: AggregatedTheme[],
): Promise<PersistThemesResult> {
  const admin = createAdminClient()

  // Previous themed run = the most recent themes rows for another run.
  const { data: prevRun } = await admin
    .from('themes')
    .select('run_id, created_at')
    .eq('client_id', clientId)
    .neq('run_id', runId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let prevEmbeddings: number[][] = []
  if (prevRun) {
    const prevRows = await selectAll<{ embedding: number[] | null }>(() =>
      admin
        .from('themes')
        .select('embedding')
        .eq('client_id', clientId)
        .eq('run_id', prevRun.run_id)
        .order('id', { ascending: true }),
    )
    prevEmbeddings = prevRows.map((r) => r.embedding).filter((e): e is number[] => Array.isArray(e) && e.length > 0)
  }

  const embeddings = await embedTexts(themes.map(matchText))
  const firstSeenFlags = embeddings.map((vec) => {
    if (prevEmbeddings.length === 0) return true
    return !prevEmbeddings.some((prev) => cosine(vec, prev) >= THEME_MATCH_THRESHOLD)
  })

  // ---- theme identity (shape B-lite) --------------------------------------
  // Match this run's themes to the client's persistent registry on MEMBERSHIP,
  // not on the label: with Pass A incremental, an unchanged theme carries an
  // identical supporting_insight_ids set, while its label churns ~88% of the
  // time. Off → registryIds stays empty and first_seen keeps the old
  // label-embedding meaning, byte for byte.
  const registryOn = themeRegistryEnabled()
  const registryIds: (string | null)[] = themes.map(() => null)
  const registryKinds: MatchKind[] = themes.map(() => 'new')
  const registryScores: number[] = themes.map(() => 0)
  const registryFirstSeen: boolean[] = themes.map(() => false)
  let registrySummary: PersistThemesResult['registry']
  // Seeding = the client has no registry yet. Every theme is trivially "new",
  // which is TRUE of the data and useless to a reader — so on the seed run the
  // displayed/emailed "new" keeps its old meaning and the registry just fills
  // up quietly. Without this, the first flag-on run would badge all ~537 Voice
  // cards and email "122 new themes" on a week where nothing actually changed.
  let seeding = false

  if (registryOn) {
    const entries = await selectAll<RegistryEntry & { last_seen_run_id: string | null; first_seen_run_id: string | null; observation_count: number | null }>(() =>
      admin.from('theme_registry')
        .select('id, bucket, member_insight_ids, embedding, status, canonical_label, last_seen_run_id, first_seen_run_id, observation_count')
        .eq('client_id', clientId).order('id', { ascending: true }),
    )
    seeding = entries.length === 0
    // A retried step replays this whole block. Anything already written for THIS
    // run must not be counted twice or re-interpreted: entries created by the
    // first attempt now hold this run's membership, so they would match `exact`
    // and silently turn "new" into "unchanged".
    const priorObs = await selectAll<{ theme_id: string }>(() =>
      admin.from('theme_observations').select('theme_id').eq('client_id', clientId).eq('run_id', runId)
        .order('theme_id', { ascending: true }),
    )
    const alreadyObserved = new Set(priorObs.map((o) => o.theme_id))

    const results = matchThemes(
      themes.map((t, i) => ({
        key: String(i),
        bucket: t.bucket,
        memberInsightIds: t.supportingInsightIds,
        label: t.label ?? t.theme,
        embedding: embeddings[i],
      })),
      entries,
      { cosine },
    )
    const nowIso = new Date().toISOString()
    const updates: Record<string, unknown>[] = []
    for (const r of results) {
      const i = Number(r.key)
      const t = themes[i]
      const label = t.label ?? t.theme
      if (r.themeId) {
        // Refresh the entry to this observation: the label is deliberately the
        // LATEST one (display stays fresh, the id carries continuity).
        const prior = entries.find((e) => e.id === r.themeId)
        updates.push({
          id: r.themeId,
          client_id: clientId,
          bucket: t.bucket,
          // observation_count only advances when this run has not already been
          // counted for that entry — a replayed step is a no-op, not a +1.
          observation_count: (prior?.observation_count ?? 0) + (alreadyObserved.has(r.themeId) ? 0 : 1),
          canonical_label: label,
          description: t.description ?? null,
          member_insight_ids: t.supportingInsightIds,
          member_slugs: t.memberThemes,
          embedding: embeddings[i].map(round6),
          status: 'active',
          last_seen_run_id: runId,
          last_seen_at: nowIso,
        })
        registryIds[i] = r.themeId
        // "New" is derived from the entry's own first_seen_run_id, so a retry
        // that re-matches an entry it created a moment ago still reads as new.
        registryFirstSeen[i] = prior?.first_seen_run_id === runId
      } else {
        const { data, error } = await admin.from('theme_registry').insert({
          client_id: clientId,
          bucket: t.bucket,
          canonical_label: label,
          description: t.description ?? null,
          member_insight_ids: t.supportingInsightIds,
          member_slugs: t.memberThemes,
          embedding: embeddings[i].map(round6),
          status: 'active',
          first_seen_run_id: runId,
          last_seen_run_id: runId,
          last_seen_at: nowIso,
          observation_count: 1,
          ...(r.splitFrom ? { parent_theme_id: r.splitFrom } : {}),
        }).select('id').single()
        if (error || !data) throw new Error(`insert theme_registry: ${error?.message ?? 'no row'}`)
        registryIds[i] = data.id as string
        registryFirstSeen[i] = true
      }
      registryKinds[i] = r.kind
      registryScores[i] = r.score
    }
    // One round trip per 200 matched entries instead of ~540 sequential updates.
    for (let i = 0; i < updates.length; i += 200) {
      const { error } = await admin.from('theme_registry').upsert(updates.slice(i, i + 200), { onConflict: 'id' })
      if (error) throw new Error(`update theme_registry: ${error.message}`)
    }

    // One observation per (theme, run). Upsert so a step retry is idempotent.
    if (themes.length) {
      const obs = themes.map((t, i) => ({
        theme_id: registryIds[i],
        client_id: clientId,
        run_id: runId,
        evidence_count: t.evidenceCount,
        strength_score: t.strengthScore,
        dominant_emotion: t.dominantEmotion,
        dominant_sentiment_impact: t.dominantSentimentImpact,
        single_source: t.singleSource,
        category: t.category,
        label: t.label ?? t.theme,
        member_insight_ids: t.supportingInsightIds,
        match_kind: registryKinds[i],
        match_score: registryScores[i],
        merged_from: results.find((r) => Number(r.key) === i)?.mergedFrom ?? [],
        split_from: results.find((r) => Number(r.key) === i)?.splitFrom ?? null,
        run_date: nowIso.slice(0, 10),
      }))
      const { error } = await admin.from('theme_observations').upsert(obs, { onConflict: 'theme_id,run_id' })
      if (error) throw new Error(`insert theme_observations: ${error.message}`)
    }

    // Dormancy: unseen across the last REGISTRY_DORMANT_RUNS runs. The window
    // comes from pipeline_runs (a bounded, tiny query) rather than paging the
    // observations table, which grows ~540 rows per run forever.
    const { data: recent } = await admin.from('pipeline_runs')
      .select('id').eq('client_id', clientId).in('status', ['completed', 'partial'])
      .order('started_at', { ascending: false }).limit(REGISTRY_DORMANT_RUNS)
    const ordered = [runId, ...((recent ?? []) as { id: string }[]).map((r) => r.id).filter((id) => id !== runId)]
    const stale = dormantIds(
      entries.map((e) => ({ id: e.id, last_seen_run_id: registryIds.includes(e.id) ? runId : e.last_seen_run_id, status: e.status })),
      ordered,
      REGISTRY_DORMANT_RUNS,
    )
    if (stale.length) {
      const { error } = await admin.from('theme_registry').update({ status: 'dormant' }).in('id', stale)
      if (error) throw new Error(`mark dormant: ${error.message}`)
    }
    registrySummary = { ...matchTally(results), entries: entries.length + results.filter((r) => !r.themeId).length, dormant: stale.length }
  }

  // Replace per (client, run) — invariant 6.
  const { error: delErr } = await admin.from('themes').delete().eq('client_id', clientId).eq('run_id', runId)
  if (delErr) throw new Error(`clear themes: ${delErr.message}`)

  if (themes.length) {
    const rows = themes.map((t, i) => ({
      client_id: clientId,
      run_id: runId,
      bucket: t.bucket,
      category: t.category,
      label: t.label ?? t.theme,
      description: t.description ?? null,
      member_themes: t.memberThemes,
      supporting_insight_ids: t.supportingInsightIds,
      supporting_video_ids: t.supportingVideoIds,
      evidence_count: t.evidenceCount,
      strength_score: t.strengthScore,
      dominant_emotion: t.dominantEmotion,
      dominant_sentiment_impact: t.dominantSentimentImpact,
      single_source: t.singleSource,
      // With the registry on, "new" means a theme with no prior identity —
      // not "the labeller chose different words", which is what the
      // label-embedding rule actually measured (48 of 58 false positives).
      first_seen: registryOn && !seeding ? registryFirstSeen[i] : firstSeenFlags[i],
      embedding: embeddings[i].map(round6),
      ...(registryOn ? { registry_id: registryIds[i] } : {}),
    }))
    const { error } = await admin.from('themes').insert(rows)
    if (error) throw new Error(`persist themes: ${error.message}`)
  }

  return {
    inserted: themes.length,
    firstSeen: registryOn && !seeding ? registryFirstSeen.filter(Boolean).length : firstSeenFlags.filter(Boolean).length,
    hadPreviousRun: prevEmbeddings.length > 0,
    ...(registrySummary ? { registry: registrySummary } : {}),
  }
}
