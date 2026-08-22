// Pure half of the Ask engine: shortlist the themes a claim could possibly be
// about, then validate what the model says about them.
//
// Generalised from say_vs_hear (lib/pipeline/pass-d.ts), which does exactly
// this for the client's own video claims. Three things change: the claims come
// from a user's document instead of transcripts, there is no cap of 3 (a plan
// yields 15–40), and the verdict model is shown theme DESCRIPTIONS and quotes
// rather than labels alone — label-only matching under-recalls badly once the
// claims are as varied as a marketing plan's.

import { cosine } from '../pipeline/cluster'
import { CITATION_RELEVANCE_FLOOR } from '../config'
import type { ClaimResult, ExtractedClaim, Judgement, ThemeRef, Verdict } from './types'
import { VERDICTS } from './types'

/** A theme as the engine handles it: identity, prose, grounding, embedding. */
export interface AskTheme {
  themeId: string
  registryId: string | null
  label: string
  description: string
  bucket: string
  insightIds: string[]
  videoIds: string[]
  embedding: number[] | null
}

/** Themes shortlisted for one claim, ordered best first. */
export interface Shortlist {
  claim: ExtractedClaim
  themes: AskTheme[]
}

/**
 * Shortlist by embedding similarity.
 *
 * Two reasons this exists rather than showing the model every theme. A run
 * carries hundreds of themes — far past what one prompt can weigh — and
 * relevance decided by cosine is reproducible, where relevance decided inside a
 * reasoning model is not.
 *
 * The floor is the same one Pass C/D-a use for citations: a theme that merely
 * exists is not evidence that a claim is echoed.
 */
export function shortlistThemes(
  claims: ExtractedClaim[],
  claimVectors: number[][],
  themes: AskTheme[],
  opts: { perClaim: number; floor?: number },
): Shortlist[] {
  const floor = opts.floor ?? CITATION_RELEVANCE_FLOOR
  const usable = themes.filter((t) => Array.isArray(t.embedding) && t.embedding.length > 0)
  return claims.map((claim, i) => {
    const vec = claimVectors[i]
    if (!vec?.length) return { claim, themes: [] }
    const scored = usable
      .map((t) => ({ t, score: cosine(vec, t.embedding as number[]) }))
      .filter((s) => s.score >= floor)
      .sort((a, b) => b.score - a.score || a.t.themeId.localeCompare(b.t.themeId))
    return { claim, themes: scored.slice(0, opts.perClaim).map((s) => s.t) }
  })
}

/** What the model returns per claim, before validation. */
export interface RawVerdict {
  claim_ref: string
  verdict: string
  they_say: string | null
  theme_refs: string[]
}

/** Normalise a bracket ref the way every pass here does — the model wraps them
 *  in whatever punctuation it likes, and an unresolved ref silently drops a
 *  whole verdict. */
export function normaliseRef(ref: string): string {
  return String(ref ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** What the verdicts are checked against: which insights still exist, which of
 *  them actually carry a quotable comment, and which video each came from. */
export interface Grounding {
  liveInsightIds: Set<string>
  quotedInsightIds: Set<string>
  videoByInsightId: Map<string, string>
}

/**
 * Turn the model's verdicts into the grounded register.
 *
 * The rules that are ENFORCED, not trusted:
 * - A verdict for a claim that was not asked about is dropped.
 * - One verdict per claim; the first wins.
 * - `silent` carries no audience voice and no themes. The model saying
 *   "silent" and then quoting the audience is the model contradicting itself,
 *   and the silent reading is the conservative one.
 * - A non-silent verdict with no `they_say`, or whose themes all failed to
 *   resolve, becomes `silent`. This is the reverse contract: a claim the model
 *   asserted but could not ground is untested, not supported.
 * - **A non-silent verdict must have at least one real comment behind it.**
 *   Without this the register is only structurally grounded: the verdict, the
 *   count and the theme ids are all checked, while `theySay` — the sentence the
 *   reader actually reads — is free prose. Requiring a quotable insight means a
 *   claim can only be reported as supported or contradicted when a person
 *   really did say something, and the page can show it.
 * - Cited evidence is intersected with the insights that STILL EXIST. Themes
 *   outlive their insights (prune-stale-analysis), so a check re-evaluated
 *   against an older run would otherwise count rows that are gone.
 * - Counts are distinct SOURCE VIDEOS of the surviving cited insights — a
 *   conversation is one video and the comments it sparked. The theme's own
 *   total breadth is not the claim's evidence.
 */
export function validateVerdicts(
  raw: RawVerdict[],
  claims: ExtractedClaim[],
  themesByClaimRef: Map<string, AskTheme[]>,
  grounding?: Grounding,
): ClaimResult[] {
  const byRef = new Map(claims.map((c) => [normaliseRef(c.ref), c]))
  const seen = new Set<string>()
  const results = new Map<string, ClaimResult>()

  for (const item of raw ?? []) {
    const key = normaliseRef(item?.claim_ref ?? '')
    const claim = byRef.get(key)
    if (!claim || seen.has(key)) continue
    seen.add(key)

    const verdict: Verdict = (VERDICTS as readonly string[]).includes(item.verdict)
      ? (item.verdict as Verdict)
      : 'silent'

    if (verdict === 'silent') {
      results.set(key, silentResult(claim))
      continue
    }

    const pool = themesByClaimRef.get(key) ?? []
    const byThemeRef = new Map(pool.map((t, i) => [normaliseRef(`T${i + 1}`), t]))
    const picked: AskTheme[] = []
    const usedThemes = new Set<string>()
    for (const r of item.theme_refs ?? []) {
      const t = byThemeRef.get(normaliseRef(r))
      if (!t || usedThemes.has(t.themeId)) continue
      usedThemes.add(t.themeId)
      picked.push(t)
    }

    const theySay = item.they_say?.trim() || ''
    if (!theySay || picked.length === 0) {
      // Asserted but ungrounded — the honest reading is that the conversation
      // has not tested this claim.
      results.set(key, silentResult(claim))
      continue
    }

    const cited = [...new Set(picked.flatMap((t) => t.insightIds))]
    const live = grounding ? cited.filter((id) => grounding.liveInsightIds.has(id)) : cited
    const quotable = grounding ? live.filter((id) => grounding.quotedInsightIds.has(id)) : live
    if (!quotable.length) {
      // Nobody actually said anything we can show. Supported-with-nothing-to-
      // show is the shape a bluff takes, so it reads as untested instead.
      results.set(key, silentResult(claim))
      continue
    }

    const videos = grounding
      ? new Set(quotable.map((id) => grounding.videoByInsightId.get(id)).filter(Boolean) as string[])
      : new Set(picked.flatMap((t) => t.videoIds))

    results.set(key, {
      ref: claim.ref,
      claim: claim.claim,
      verdict,
      theySay,
      conversationCount: videos.size,
      themeRefs: picked.map(
        (t): ThemeRef => ({ themeId: t.themeId, registryId: t.registryId, label: t.label }),
      ),
      insightIds: quotable,
      // Carried through untouched. The verdict pass has no business editing
      // where a claim came from.
      source: claim.source ?? null,
    })
  }

  // Every submitted claim gets an answer, in submission order.
  return claims.map((c) => results.get(normaliseRef(c.ref)) ?? silentResult(c))
}

function silentResult(claim: ExtractedClaim): ClaimResult {
  return {
    ref: claim.ref,
    claim: claim.claim,
    verdict: 'silent',
    theySay: null,
    conversationCount: 0,
    themeRefs: [],
    insightIds: [],
    source: claim.source ?? null,
  }
}

export function summarise(claims: ClaimResult[]) {
  return {
    supported: claims.filter((c) => c.verdict === 'echoes').length,
    contradicted: claims.filter((c) => c.verdict === 'contradicts').length,
    untested: claims.filter((c) => c.verdict === 'silent').length,
  }
}

/**
 * Keep judgement in its own register.
 *
 * Refs are resolved against the claims so a proposal cannot cite evidence that
 * does not exist, but a judgement whose refs all fail is KEPT with no refs
 * rather than dropped — it is visibly the model's own view either way, and
 * silently deleting the model's reasoning would leave the reader thinking the
 * evidence was all there was.
 */
export function validateJudgement(
  raw: { text?: string; based_on_refs?: string[] }[],
  claims: ClaimResult[],
): Judgement[] {
  const valid = new Set(claims.map((c) => normaliseRef(c.ref)))
  return (raw ?? [])
    .map((j) => ({
      text: (j?.text ?? '').trim(),
      basedOnRefs: [...new Set((j?.based_on_refs ?? []).map(normaliseRef))]
        .filter((r) => valid.has(r))
        .map((r) => claims.find((c) => normaliseRef(c.ref) === r)!.ref),
    }))
    .filter((j) => j.text.length > 0)
}

/** Verdict changes between two evaluations of the same plan — the reason the
 *  evaluations table exists. Claims are matched on ref, which is stable because
 *  re-evaluation re-reads the stored input text. */
export function diffVerdicts(
  previous: ClaimResult[],
  current: ClaimResult[],
): { ref: string; claim: string; from: Verdict; to: Verdict }[] {
  const prev = new Map(previous.map((c) => [normaliseRef(c.ref), c]))
  const moved: { ref: string; claim: string; from: Verdict; to: Verdict }[] = []
  for (const c of current) {
    const before = prev.get(normaliseRef(c.ref))
    if (!before || before.verdict === c.verdict) continue
    moved.push({ ref: c.ref, claim: c.claim, from: before.verdict, to: c.verdict })
  }
  return moved
}
