import { createAdminClient, selectAll } from '../supabase-admin'
import { fold } from '../gather/util'

// Brand-claims loader (Step 2b; hygiene hardened for real runs 2026-08-08).
// Claims are durable brand messaging captured by Pass A v4 from client/
// competitor video transcripts — sparse per run (a weekly gather may catch 0–2
// brand videos with speech), so consumption ACCUMULATES across runs (decision
// D1). Cross-run reads live here at the orchestrator layer, matching the
// themes-first_seen / report-delta precedent — never inside runPassC/runPassD,
// which stay single-run-scoped.

/** Who is speaking on a client-bucket video. `own` = the client itself (an
 *  owned post, or a discovered video from one of the client's own accounts);
 *  `about` = a third party talking about the client (a reviewer, a clinic, a
 *  news channel). Both are `is_client` — the bucket means "about the brand",
 *  which is why pooling them under "You say" misattributed 10 of Össur's 22
 *  client claims (2026-08-16). Competitor claims carry no voice. */
export type Voice = 'own' | 'about'

export interface BrandClaim {
  /** Named competitor, or null for the client's own claims. */
  competitor: string | null
  claim: string
  quote: string
  /** Client claims only (see Voice). */
  voice?: Voice
  /** Speaker context for the "About you" surface; present when the loader joined the video. */
  account?: string | null
  platform?: string | null
  url?: string | null
}

export interface BrandClaims {
  /** The client speaking — own voice ONLY. This is what say-vs-hear's "You say" quotes. */
  client: BrandClaim[]
  /** Third parties speaking about the client. Never enters say-vs-hear. */
  about: BrandClaim[]
  competitors: BrandClaim[]
  /** Post-hygiene, PRE-cap counts per side — the honest roll-up numbers
   *  ("N claims in your voice · N about you · N from competitors"). */
  counts: { own: number; about: number; competitors: number }
}

/** What Market reads (run_summary.brand_voice) — see the 20260816230000 migration. */
export interface BrandVoiceSnapshot {
  counts: { own: number; about: number; competitors: number }
  about: AboutYouEntry[]
}
export interface AboutYouEntry {
  claim: string
  quote: string
  account: string
  platform: string
  url: string | null
}
export const ABOUT_YOU_MAX = 8

/** Does a claim (or its verbatim quote) actually name the brand? The `about`
 *  bucket is defined negatively (client-bucket video, not the client's own
 *  account), and Pass A extracts EVERY brand claim on such a video — including
 *  claims about the video's OWN third-party brand. Without this gate Sealand's
 *  block showed a shipping company's marketing copy under "What others say
 *  about you" (review, 2026-08-16). Product-only claims that never say the
 *  brand's name are dropped too — under-showing beats misattributing. */
export function mentionsBrand(c: { claim: string; quote: string }, brandKeywords: string[] | null | undefined): boolean {
  const hay = fold(`${c.claim} ${c.quote}`)
  return (brandKeywords ?? []).some((k) => {
    const kw = fold(k)
    return kw.length >= 3 && hay.includes(kw)
  })
}

/** Pure: shape the About-you block from hygiened claims — newest-first (the
 *  loader's order), brand-mention gated, at most 2 per source video (keyed by
 *  url), exact-normalised claim dedupe, capped. Evidence only: quote + who
 *  said it + where. Counts are the roll-up (all-time, post-hygiene, pre-cap). */
export function shapeBrandVoice(claims: BrandClaims, brandKeywords: string[] | null | undefined): BrandVoiceSnapshot {
  const perVideo = new Map<string, number>()
  const seen = new Set<string>()
  const about: AboutYouEntry[] = []
  for (const c of claims.about) {
    if (about.length >= ABOUT_YOU_MAX) break
    if (!mentionsBrand(c, brandKeywords)) continue
    const key = c.url ?? `${c.account ?? ''}::${c.claim}`
    if ((perVideo.get(key) ?? 0) >= 2) continue
    const norm = normClaim(c.claim)
    if (seen.has(norm)) continue
    seen.add(norm)
    perVideo.set(key, (perVideo.get(key) ?? 0) + 1)
    about.push({ claim: c.claim, quote: c.quote, account: c.account ?? 'unknown account', platform: c.platform ?? '', url: c.url ?? null })
  }
  return { counts: { ...claims.counts }, about }
}

/**
 * Pure: is this client-bucket video the client's OWN voice? Owned posts are,
 * by construction; a discovered video is when its account name folds to one
 * of the brand keywords ("ÖSSUR", "Össur Academy", "Össur DE" → yes;
 * "McMorris Prosthetic Services" → no). Name-fold is the v1 rule — YouTube
 * channel ids would be exact, but the videos table doesn't store them.
 */
/** Account-name words that mark a THIRD PARTY even when the brand's name is
 *  in the handle ("Össur Review", "WHOOP Fans", "Ossur vs Ottobock"). Folded
 *  whole-word match. Kept short and obvious on purpose — a long list is a
 *  second tagging system nobody maintains. */
export const THIRD_PARTY_ACCOUNT_WORDS = ['review', 'reviews', 'reviewer', 'unboxing', 'fan', 'fans', 'fanpage', 'vs', 'versus', 'news', 'podcast', 'community']

export function ownVoice(
  v: { source: string | null | undefined; account_name: string | null | undefined },
  brandKeywords: string[] | null | undefined,
): boolean {
  if (v.source === 'owned') return true
  const acct = fold(v.account_name ?? '')
  if (!acct) return false
  const words = new Set(acct.split(/[^a-z0-9]+/).filter(Boolean))
  if (THIRD_PARTY_ACCOUNT_WORDS.some((w) => words.has(w))) return false
  return (brandKeywords ?? []).some((k) => {
    const kw = fold(k)
    return kw.length >= 3 && acct.includes(kw)
  })
}

/** Cap per entity (client, or each named competitor) after dedupe. */
export const MAX_CLAIMS_PER_ENTITY = 12
/** The about-you side feeds no prompt (evidence-only block), so it can hold
 *  more than the prompt-sized cap — enough that ≤2-per-video still fills 8. */
export const MAX_ABOUT_CLAIMS = 24

interface ClaimRow {
  run_id: string
  source_video_id: string
  entity: string
  competitor_name: string | null
  claim: string
  quote: string
  /** Set by the loader from the joined video; absent = treated as own voice
   *  (pre-voice callers and tests). */
  voice?: Voice
  account?: string | null
  platform?: string | null
  url?: string | null
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
 *  3. Exact-normalized dedupe within what survives, then the per-entity cap.
 *  4. Client claims split by VOICE (own vs about), each side capped separately
 *     — a busy reviewer must never crowd the client's own words out of the
 *     "You say" quota. */
export function selectClaims(rows: ClaimRow[], trackedCompetitors: string[], maxPerEntity: number = MAX_CLAIMS_PER_ENTITY): BrandClaims {
  const newestRunByVideo = new Map<string, string>()
  for (const r of rows) {
    if (!newestRunByVideo.has(r.source_video_id)) newestRunByVideo.set(r.source_video_id, r.run_id)
  }
  const tracked = new Set(trackedCompetitors.map((n) => fold(n)))

  const seen = new Set<string>()
  const perEntity = new Map<string, number>()
  const client: BrandClaim[] = []
  const about: BrandClaim[] = []
  const competitors: BrandClaim[] = []
  const counts = { own: 0, about: 0, competitors: 0 }

  for (const r of rows) {
    if (newestRunByVideo.get(r.source_video_id) !== r.run_id) continue

    const isClient = r.entity === 'client'
    const name = isClient ? null : (r.competitor_name ?? '').trim()
    if (!isClient && (!name || name.toLowerCase() === 'unknown' || !tracked.has(fold(name)))) continue

    const key = `${r.source_video_id}::${normClaim(r.claim)}`
    if (seen.has(key)) continue
    seen.add(key)

    const voice: Voice | undefined = isClient ? (r.voice ?? 'own') : undefined
    if (!isClient) counts.competitors++
    else if (voice === 'about') counts.about++
    else counts.own++
    const entityKey = isClient ? `client:${voice}` : `competitor:${fold(name!)}`
    const count = perEntity.get(entityKey) ?? 0
    if (count >= (voice === 'about' ? Math.max(maxPerEntity, MAX_ABOUT_CLAIMS) : maxPerEntity)) continue
    perEntity.set(entityKey, count + 1)

    const out: BrandClaim = { competitor: isClient ? null : name, claim: r.claim, quote: r.quote }
    if (isClient && r.voice) out.voice = r.voice
    if (r.account !== undefined) out.account = r.account
    if (r.platform !== undefined) out.platform = r.platform
    if (r.url !== undefined) out.url = r.url
    if (!isClient) competitors.push(out)
    else if (voice === 'about') about.push(out)
    else client.push(out)
  }

  return { client, about, competitors, counts }
}

/** All-time claims for a client, newest-first, hygiened per selectClaims. Joins
 *  the source video so client claims can be split by voice (own vs about). */
export async function loadBrandClaims(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  trackedCompetitors: string[],
  brandKeywords: string[] | null | undefined = [],
): Promise<BrandClaims> {
  interface JoinedRow {
    run_id: string
    source_video_id: string
    entity: string
    competitor_name: string | null
    claim: string
    quote: string
    created_at: string
    // PostgREST returns ONE object for a many→one embed; the untyped client
    // infers an array, so accept both and normalise below.
    videos: JoinedVideo | JoinedVideo[] | null
  }
  interface JoinedVideo { source: string | null; account_name: string | null; platform: string | null; video_url: string | null }
  const raw = await selectAll<JoinedRow>(() =>
    admin
      .from('video_claims')
      .select('run_id, source_video_id, entity, competitor_name, claim, quote, created_at, videos:source_video_id(source, account_name, platform, video_url)')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true }),
  )
  const rows: ClaimRow[] = raw.map((r) => {
    const v = (Array.isArray(r.videos) ? r.videos[0] : r.videos) ?? null
    return {
      run_id: r.run_id,
      source_video_id: r.source_video_id,
      entity: r.entity,
      competitor_name: r.competitor_name,
      claim: r.claim,
      quote: r.quote,
      voice: r.entity === 'client'
        ? (ownVoice({ source: v?.source, account_name: v?.account_name }, brandKeywords) ? 'own' : 'about')
        : undefined,
      account: v?.account_name ?? null,
      platform: v?.platform ?? null,
      url: v?.video_url ?? null,
    }
  })
  return selectClaims(rows, trackedCompetitors)
}
