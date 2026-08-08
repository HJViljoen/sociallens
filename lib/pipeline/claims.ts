import { createAdminClient, selectAll } from '../supabase-admin'
import { fold } from '../gather/util'

// Brand-claims loader (Step 2b; hygiene hardened for real runs 2026-08-08).
// Claims are durable brand messaging captured by Pass A v4 from client/
// competitor video transcripts — sparse per run (a weekly gather may catch 0–2
// brand videos with speech), so consumption ACCUMULATES across runs (decision
// D1). Cross-run reads live here at the orchestrator layer, matching the
// themes-first_seen / report-delta precedent — never inside runPassC/runPassD,
// which stay single-run-scoped.

export interface BrandClaim {
  /** Named competitor, or null for the client's own claims. */
  competitor: string | null
  claim: string
  quote: string
}

export interface BrandClaims {
  client: BrandClaim[]
  competitors: BrandClaim[]
}

/** Cap per entity (client, or each named competitor) after dedupe. */
export const MAX_CLAIMS_PER_ENTITY = 12

interface ClaimRow {
  run_id: string
  source_video_id: string
  entity: string
  competitor_name: string | null
  claim: string
  quote: string
}

const normClaim = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Pure core, exported for tests. Rows must arrive newest-first.
 *  1. NEWEST-RUN-WINS per video: Pass A re-analysis of the same video under a
 *     new run rewrites its claim set, but older runs' rows persist in the
 *     table with paraphrase-variant wording that defeats text dedupe — so a
 *     video's claims are taken ONLY from its newest run.
 *  2. Competitor claims must belong to a CURRENTLY-tracked competitor
 *     (fold-compared; stored names are config-cased) — an untracked brand
 *     must not keep feeding Pass C. Unnamed ('unknown') rows are excluded:
 *     a prompt that names brands can't use them.
 *  3. Exact-normalized dedupe within what survives, then the per-entity cap. */
export function selectClaims(rows: ClaimRow[], trackedCompetitors: string[], maxPerEntity: number = MAX_CLAIMS_PER_ENTITY): BrandClaims {
  const newestRunByVideo = new Map<string, string>()
  for (const r of rows) {
    if (!newestRunByVideo.has(r.source_video_id)) newestRunByVideo.set(r.source_video_id, r.run_id)
  }
  const tracked = new Set(trackedCompetitors.map((n) => fold(n)))

  const seen = new Set<string>()
  const perEntity = new Map<string, number>()
  const client: BrandClaim[] = []
  const competitors: BrandClaim[] = []

  for (const r of rows) {
    if (newestRunByVideo.get(r.source_video_id) !== r.run_id) continue

    const isClient = r.entity === 'client'
    const name = isClient ? null : (r.competitor_name ?? '').trim()
    if (!isClient && (!name || name.toLowerCase() === 'unknown' || !tracked.has(fold(name)))) continue

    const key = `${r.source_video_id}::${normClaim(r.claim)}`
    if (seen.has(key)) continue
    seen.add(key)

    const entityKey = isClient ? 'client' : `competitor:${fold(name!)}`
    const count = perEntity.get(entityKey) ?? 0
    if (count >= maxPerEntity) continue
    perEntity.set(entityKey, count + 1)

    const out = { competitor: isClient ? null : name, claim: r.claim, quote: r.quote }
    if (isClient) client.push(out)
    else competitors.push(out)
  }

  return { client, competitors }
}

/** All-time claims for a client, newest-first, hygiened per selectClaims. */
export async function loadBrandClaims(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  trackedCompetitors: string[],
): Promise<BrandClaims> {
  const rows = await selectAll<ClaimRow & { created_at: string }>(() =>
    admin
      .from('video_claims')
      .select('run_id, source_video_id, entity, competitor_name, claim, quote, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true }),
  )
  return selectClaims(rows, trackedCompetitors)
}
