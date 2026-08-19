import { PERSONA_MATCH_MIN } from '../config'
import type { GroundedPersona } from './persona-assembly'

// Persona identity across runs.
//
// A profile is not a weekly report. "Caregiver" should still be Caregiver in
// three months — what changes underneath is what that person wants, what stops
// them and how loud they are. Regenerating the cast from scratch every run
// would rename and re-cut them constantly, which is the same failure the theme
// registry was built to fix: gpt-5.4 takes no temperature, so identical input
// still produces different labels, and a reader cannot tell a real shift from
// a re-wording.
//
// Two mechanisms, belt and braces:
//   1. The prompt is shown the standing cast and told to keep it (pass-e.ts).
//   2. This file matches what came back to what was there before, by EVIDENCE
//      rather than by name, and carries the old identity forward. The model
//      cooperating is a nicety; the match is the guarantee.
//
// Matching on the insight sets mirrors theme_registry, which measured
// membership as the stable signal and labels as the unstable one.

export interface PriorPersona {
  key: string
  name: string
  insightIds: string[]
}

export interface CarriedPersona extends GroundedPersona {
  /** True when this person was already in the profile last run. */
  carried: boolean
  /** The name the model proposed, kept when it differs from the one in use —
   *  a drifting proposal is the early signal that a persona is really changing. */
  proposedName?: string
}

/** Jaccard over the evidence two personas rest on. */
export function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  let shared = 0
  for (const id of new Set(a)) if (setB.has(id)) shared++
  const union = new Set([...a, ...b]).size
  return union === 0 ? 0 : shared / union
}

/**
 * Carry identity forward from the previous run's profile.
 *
 * Greedy best-match, one prior to one current: the strongest pairing wins, so
 * two similar personas cannot both claim the same predecessor and split a
 * history in half.
 *
 * A match adopts the prior KEY and NAME. The key keeps the URL and the figure
 * stable; the name is what makes the profile feel like the same cast month to
 * month. The model's own proposal is kept alongside when it differs, because a
 * persona whose proposed name drifts run after run is genuinely changing and an
 * operator should be able to see that before the product renames it.
 */
export function carryPersonas(
  current: GroundedPersona[],
  prior: PriorPersona[],
  minOverlap = PERSONA_MATCH_MIN,
): CarriedPersona[] {
  if (!prior.length) return current.map((p) => ({ ...p, carried: false }))

  const pairs: { ci: number; pi: number; score: number }[] = []
  current.forEach((c, ci) => {
    prior.forEach((p, pi) => {
      const score = overlap(c.insightIds, p.insightIds)
      if (score >= minOverlap) pairs.push({ ci, pi, score })
    })
  })
  // Strongest first; ties broken deterministically so a re-run cannot reshuffle.
  pairs.sort((a, b) => b.score - a.score || a.ci - b.ci || a.pi - b.pi)

  const takenCurrent = new Set<number>()
  const takenPrior = new Set<number>()
  const matchOf = new Map<number, PriorPersona>()
  for (const { ci, pi } of pairs) {
    if (takenCurrent.has(ci) || takenPrior.has(pi)) continue
    takenCurrent.add(ci)
    takenPrior.add(pi)
    matchOf.set(ci, prior[pi])
  }

  return current.map((c, ci) => {
    const match = matchOf.get(ci)
    if (!match) return { ...c, carried: false }
    return {
      ...c,
      key: match.key,
      name: match.name,
      carried: true,
      ...(match.name !== c.name ? { proposedName: c.name } : {}),
    }
  })
}

/** Read the standing cast out of a stored profile row's `personas` jsonb. */
export function priorFromProfile(personas: unknown): PriorPersona[] {
  if (!Array.isArray(personas)) return []
  return personas
    .map((p) => p as { key?: unknown; name?: unknown; insightIds?: unknown })
    .filter((p) => typeof p.key === 'string' && typeof p.name === 'string')
    .map((p) => ({
      key: p.key as string,
      name: p.name as string,
      insightIds: Array.isArray(p.insightIds) ? (p.insightIds as string[]) : [],
    }))
}
