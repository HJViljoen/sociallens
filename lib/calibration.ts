// Calibrated language (Calibrated-Language doc 2026-07-04) — the companion to
// lib/curation.ts. Every "how much / how strong / how sure" word shown to a
// client is assigned HERE by rule from measured data, never chosen by the
// model: the model explains, code rates. Badges always carry their evidence
// ("Dominant · 21 of 36 Ossur conversations"), so the same word means the same
// thing on every page, every week. Thresholds are config, not hard-code —
// reviewed on live output alongside the curation gate (spec §10).

// ---- Ladder 1 · Prevalence — how much of the conversation is a theme? -------
// Measured against the theme's own entity group (client / competitor:X /
// industry-other): group sizes differ 5×, so a corpus-wide share would bury
// every client theme under industry noise. Denominator = the group's distinct
// insight-bearing conversations (union of the group's theme evidence).

export const PREVALENCE = {
  /** Dominant: ≥ this share of the group's conversations, and ≥ dominantMin. */
  dominantShare: 0.4,
  dominantMin: 10,
  /** Widespread: ≥ this share of the group's conversations, and ≥ widespreadMin. */
  widespreadShare: 0.15,
  widespreadMin: 5,
} as const

export type PrevalenceTier = 'dominant' | 'widespread' | 'recurring' | 'early_signal'

/** Classify a theme's reach: its distinct conversations vs its group's total. */
export function prevalenceTier(conversations: number, groupConversations: number): PrevalenceTier {
  if (conversations <= 1) return 'early_signal'
  const share = groupConversations > 0 ? conversations / groupConversations : 0
  if (conversations >= PREVALENCE.dominantMin && share >= PREVALENCE.dominantShare) return 'dominant'
  if (conversations >= PREVALENCE.widespreadMin && share >= PREVALENCE.widespreadShare) return 'widespread'
  return 'recurring'
}

export const PREVALENCE_LABEL: Record<PrevalenceTier, string> = {
  dominant: 'Dominant',
  widespread: 'Widespread',
  recurring: 'Recurring',
  early_signal: 'Early signal',
}

// ---- Ladder 2 · Sentiment — measured shares of rated conversations ----------
// Polarized is checked first: strong-both-ways data must never read "balanced".

export const SENTIMENT_LADDER = {
  /** Strongly positive/negative: leading share ≥ strong, opposing ≤ strongOther. */
  strong: 70,
  strongOther: 10,
  /** Leaning: one side leads the other by ≥ this many points. */
  lean: 15,
  /** Polarized: BOTH sides at ≥ this share. */
  polarized: 30,
} as const

export type SentimentTier =
  | 'strongly_positive' | 'leaning_positive' | 'balanced'
  | 'polarized' | 'leaning_negative' | 'strongly_negative'

/** Classify a measured sentiment split (percentages of rated conversations). */
export function sentimentTier(posPct: number, negPct: number): SentimentTier {
  const L = SENTIMENT_LADDER
  if (posPct >= L.polarized && negPct >= L.polarized) return 'polarized'
  if (posPct >= L.strong && negPct <= L.strongOther) return 'strongly_positive'
  if (negPct >= L.strong && posPct <= L.strongOther) return 'strongly_negative'
  if (posPct - negPct >= L.lean) return 'leaning_positive'
  if (negPct - posPct >= L.lean) return 'leaning_negative'
  return 'balanced'
}

export const SENTIMENT_TIER_LABEL: Record<SentimentTier, string> = {
  strongly_positive: 'Strongly positive',
  leaning_positive: 'Leaning positive',
  balanced: 'Balanced',
  polarized: 'Polarized',
  leaning_negative: 'Leaning negative',
  strongly_negative: 'Strongly negative',
}

/** Per-tier rule, reader-facing — chip tooltips on the dashboard sentiment card. */
export const SENTIMENT_TIER_RULE: Record<SentimentTier, string> = {
  strongly_positive: 'At least 70% of rated conversations positive, no more than 10% negative.',
  leaning_positive: 'Positive leads negative by at least 15 points.',
  balanced: 'Neither positive nor negative leads by 15 points.',
  polarized: 'Both positive and negative above 30% — strong feelings both ways.',
  leaning_negative: 'Negative leads positive by at least 15 points.',
  strongly_negative: 'At least 70% of rated conversations negative, no more than 10% positive.',
}

// ---- Glossary — single source for chip tooltips + the page legend -----------
// One reader-facing rule per calibrated term. Chips set it as their title
// (hover explains the word where the confusion happens); the how-to-read
// floating card renders the same lines, so tooltip and legend can never drift.

export const GLOSSARY = {
  conversations: ['Conversations', 'one video and the comments it sparked — the unit behind every "heard in…" and share figure; comments are always counted separately as comments'],
  dominant: ['Dominant', "at least 40% of the group's analysed conversations (minimum 10)"],
  widespread: ['Widespread', "at least 15% of the group's analysed conversations (minimum 5)"],
  recurring: ['Recurring', 'heard in more than one conversation, below Widespread'],
  early_signal: ['Early signal', 'heard in a single conversation so far but scored strong — worth watching, not yet confirmed'],
  strong_evidence: ['Strong evidence', 'high-confidence finding backed by two or more sources'],
  act_now: ['Act now', 'the single top-ranked action this update — never more than one'],
  plan_next: ['Plan next', 'ranked second or third this update'],
  worth_considering: ['Worth considering', 'ranked below the top three this update'],
  new: ['New', 'this theme was not present in your previous update'],
  sentiment: ['Strongly positive → Strongly negative', 'fixed cutoffs on the measured share of rated conversations; Polarized = both sides above 30%'],
  say_vs_hear: ['Say vs hear', "what your own videos claim (from their transcripts), set against what the tracked conversation actually says — 'not talked about yet' means the audience doesn't engage with the claim, not that it's wrong"],
  news: ['In the news', 'published coverage matched to your tracked names by headline — shown as context beside the conversation, never claimed as the cause of anything measured'],
  about_you: ['About you', "what other people's videos claim about your brand — reviewers, clinics, media — quoted verbatim from their transcripts; their words, never yours, and never counted as your audience"],
} as const

export type GlossaryKey = keyof typeof GLOSSARY

/** Tooltip text for a glossary term. */
export const glossaryRule = (key: GlossaryKey): string => GLOSSARY[key][1]

// ---- Ladder 4 · Priority — positional, forced scarcity ----------------------
// The model ranks (relative judgment is reliable); code assigns the words
// (absolute judgment inflates — the 3 Jul run rated 4 of 4 recs "high").
// Position in the client-facing order decides: #1 = Act now, #2–3 = Plan next.
// Pass D-b's stored priority carries the same positions (high/medium/low by
// output rank), so DB values and display order agree from the next run on.

export function priorityWord(rank: number): string {
  if (rank === 0) return 'Act now'
  if (rank <= 2) return 'Plan next'
  return 'Worth considering'
}

/** DB priority value for a D-b output position — rank 0 → high, 1–2 → medium. */
export function priorityForRank(rank: number): 'high' | 'medium' | 'low' {
  if (rank === 0) return 'high'
  if (rank <= 2) return 'medium'
  return 'low'
}
