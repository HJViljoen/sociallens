import { zodResponseFormat } from 'openai/helpers/zod'
import { openai } from '../openai'
import { createAdminClient } from '../supabase-admin'
import { ANALYSIS_MODEL, ANALYSIS_TEMPERATURE } from '../config'
import { logAiCall } from '../pipeline/ai-log'
import { SubredditProposalSchema, type SubredditProposalOutput } from '../pipeline/schemas'
import { subredditKey, knownSubreddits } from './subreddits'
import { probeSubreddits } from './subreddit-probe'
import type { GatherConfig, SubredditEntry } from './types'

// Subreddit auto-discovery, step 1 of 2: PROPOSE.
//
// Heinrich's requirement is no human curation — nobody hand-picks communities.
// But a proposal is not a decision: GPT knows which subreddits plausibly exist
// for a category and is confidently wrong about whether they carry the client's
// customers. So this step only ever produces a SHORTLIST TO TEST; the live
// relevance probe (step 2) is what promotes a candidate to 'active'.
//
// That split is the Poler/Patagonia lesson made structural — the failure there
// was trusting a name at face value ("Patagonia" the brand vs the region), and a
// model proposing r/Patagonia for an outdoor brand would repeat it exactly.

export const SUBREDDIT_DISCOVERY_PROMPT_VERSION = 'subreddit_discovery_v1'

/** How many candidates one proposal call may return. Each one costs a probe
 *  (an Apify run + a gate call), so this is a spend lever, not just tidiness. */
export const MAX_PROPOSALS = 8

export function buildDiscoverySystemPrompt(): string {
  return [
    'You help a consumer-intelligence platform find Reddit communities where a brand\'s customers actually talk.',
    '',
    'Given a brand, its competitors, and its industry keywords, propose subreddits worth SAMPLING.',
    '',
    'Rules:',
    '- Propose communities where CUSTOMERS and PROSPECTS talk about the product, the category, or the lived experience. Not marketing, PR, or industry-insider subreddits.',
    '- Prefer specific communities over huge general ones. r/AskReddit will always contain something and is never the right answer.',
    '- Never propose a subreddit whose name merely matches a brand word. A brand name is often also a place, a common word, or another product entirely — the name matching proves nothing about whether the customers are there.',
    '- Only propose communities you actually believe exist. A plausible-sounding invented name wastes a paid sample.',
    '- Do not propose a brand\'s own promotional subreddit.',
    `- Return at most ${MAX_PROPOSALS}, best first. Fewer is better than padding.`,
    '',
    'For each: "name" is the bare subreddit name with no "r/" prefix, and "reason" is one short sentence on why the client\'s customers would be there. If you are unsure a community exists or fits, leave it out.',
  ].join('\n')
}

export function buildDiscoveryUserPrompt(config: GatherConfig, exclude: Set<string>): string {
  const list = (xs: string[] | undefined) => (xs ?? []).filter(Boolean).join(', ') || '(none provided)'
  const lines = [
    `Brand: ${list(config.brand_keywords)}`,
    `Competitors: ${list(config.competitor_names)}`,
    `Industry: ${list(config.industry_keywords)}`,
  ]
  if (exclude.size) {
    lines.push(
      '',
      `Already known — do NOT propose these again: ${[...exclude].sort().join(', ')}`,
    )
  }
  return lines.join('\n')
}

/**
 * Pure: turn raw model output into new candidate entries.
 *
 * Drops anything unusable (bad name, a user profile, a duplicate) and anything
 * the tenant already knows — including previously REJECTED communities, so a
 * failed probe isn't re-proposed every week.
 */
export function toCandidates(
  parsed: SubredditProposalOutput | null,
  existing: SubredditEntry[],
  today: string,
  max = MAX_PROPOSALS,
): SubredditEntry[] {
  const known = knownSubreddits(existing)
  const out: SubredditEntry[] = []
  const seen = new Set<string>()
  for (const p of parsed?.subreddits ?? []) {
    const name = subredditKey(p?.name ?? '')
    if (!name || known.has(name) || seen.has(name)) continue
    seen.add(name)
    out.push({ name, status: 'candidate', discovered_at: today })
    if (out.length >= max) break
  }
  return out
}

/** Propose candidate subreddits for a tenant. Returns new CANDIDATES only —
 *  nothing is searched until the probe promotes it. */
export async function proposeSubreddits(opts: {
  clientId: string
  runId: string
  config: GatherConfig
  today: string
  callIndex?: number
}): Promise<SubredditEntry[]> {
  const admin = createAdminClient()
  const systemPrompt = buildDiscoverySystemPrompt()
  const userPrompt = buildDiscoveryUserPrompt(opts.config, knownSubreddits(opts.config.subreddits))
  const startedAt = Date.now()

  const completion = await openai.chat.completions.parse({
    model: ANALYSIS_MODEL,
    temperature: ANALYSIS_TEMPERATURE,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: zodResponseFormat(SubredditProposalSchema, 'subreddit_proposals'),
  })
  const parsed = (completion.choices[0]?.message?.parsed ?? null) as SubredditProposalOutput | null
  const candidates = toCandidates(parsed, opts.config.subreddits, opts.today)

  await logAiCall(admin, {
    clientId: opts.clientId,
    runId: opts.runId,
    pass: 'subreddit_discovery',
    callIndex: opts.callIndex ?? 1,
    model: ANALYSIS_MODEL,
    promptVersion: SUBREDDIT_DISCOVERY_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    response: { proposed: parsed?.subreddits ?? [], kept: candidates.map((c) => c.name) },
    error: null,
    usage: completion.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
    durationMs: Date.now() - startedAt,
    validationStatus: parsed ? 'ok' : 'unparsed',
  })

  return candidates
}

/**
 * Full discovery pass for one tenant: propose → probe → persist.
 *
 * Returns the tenant's subreddit list AFTER discovery. Safe to call on every
 * run: proposals exclude everything already known, so a settled tenant proposes
 * nothing and probes nothing, and the whole pass costs one cheap GPT call.
 *
 * Caller must treat this as non-fatal — Reddit is a degradable platform.
 */
export async function discoverSubreddits(opts: {
  clientId: string
  runId: string
  config: GatherConfig
  today: string
}): Promise<SubredditEntry[]> {
  const admin = createAdminClient()
  const candidates = await proposeSubreddits(opts)
  if (!candidates.length) {
    console.log('[reddit] discovery: no new candidates')
    return opts.config.subreddits
  }

  const resolved = await probeSubreddits({
    clientId: opts.clientId,
    runId: opts.runId,
    config: opts.config,
    candidates,
    today: opts.today,
  })

  // Merge by canonical name; existing entries win over a re-proposal of the
  // same community so a probe result is never silently downgraded.
  const merged = [...opts.config.subreddits]
  const known = knownSubreddits(opts.config.subreddits)
  for (const entry of resolved) if (!known.has(entry.name)) merged.push(entry)

  const { error } = await admin
    .from('tracking_configs')
    .update({ subreddits: merged })
    .eq('client_id', opts.clientId)
  if (error) throw new Error(`persist subreddits: ${error.message}`)

  const active = resolved.filter((e) => e.status === 'active').map((e) => e.name)
  console.log(
    `[reddit] discovery: ${candidates.length} probed → ${active.length} active${active.length ? ` (${active.join(', ')})` : ''}`,
  )
  return merged
}
