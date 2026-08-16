import { zodResponseFormat } from 'openai/helpers/zod'
import { openai } from '../openai'
import { createAdminClient } from '../supabase-admin'
import { ANALYSIS_MODEL, ANALYSIS_TEMPERATURE, SUBREDDIT_PROBES_PER_RUN, SUBREDDIT_TARGET_ACTIVE, SUBREDDIT_MAX_KNOWN, SUBREDDIT_STRIKE_LIMIT } from '../config'
import { logAiCall } from '../pipeline/ai-log'
import { SubredditProposalSchema, type SubredditProposalOutput } from '../pipeline/schemas'
import { subredditKey, knownSubreddits, applyStrikes, subredditLabel, type RedditYields } from './subreddits'
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

/** Discovery is finished for this tenant when it has enough active communities,
 *  or has already considered enough candidates to conclude the category doesn't
 *  have more. Without this the proposal prompt — which excludes everything
 *  already known — returns the NEXT plausible names every single week, forever,
 *  each costing a paid probe, and eventually starts inventing them. */
export function discoveryConverged(entries: SubredditEntry[]): boolean {
  const active = entries.filter((e) => e.status === 'active').length
  return active >= SUBREDDIT_TARGET_ACTIVE || entries.length >= SUBREDDIT_MAX_KNOWN
}

/**
 * Full discovery pass for one tenant: top up candidates → probe a few → persist.
 *
 * Deliberately incremental. Probing is sequential I/O inside one Inngest step
 * against a 300s cap, so only SUBREDDIT_PROBES_PER_RUN are probed per run and
 * discovery ramps over a few weeks rather than trying to settle at once. That
 * same cap bounds per-run spend.
 *
 * Unprobed candidates are probed FIRST, before any new proposal. That is what
 * gives a candidate whose probe errored another chance — otherwise it would sit
 * in the config forever, excluded from future proposals as "already known" and
 * never re-probed.
 *
 * Caller must treat this as non-fatal — Reddit is a degradable platform.
 */
/** Gate survivors per Reddit source for the most recent run that gathered.
 *  keyword_performance already records this — a community harvest is stored
 *  under its label ('r/amputee') — so dead-community detection costs no extra
 *  query at gather time and no new table. Null when the tenant has never
 *  gathered Reddit. */
async function loadLastRedditYields(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
): Promise<RedditYields | null> {
  const { data } = await admin
    .from('keyword_performance')
    .select('run_id, keyword, gate_survived, created_at')
    .eq('client_id', clientId)
    .eq('platform', 'reddit')
    .order('created_at', { ascending: false })
    .limit(200)
  const rows = (data ?? []) as { run_id: string; keyword: string; gate_survived: number | null }[]
  if (!rows.length) return null
  // Anchor on the newest run that actually gathered — analysis-only re-runs
  // write no keyword rows, so run recency alone would read an empty set.
  const latest = rows[0].run_id
  const out: RedditYields = new Map()
  for (const r of rows) if (r.run_id === latest) out.set(r.keyword, r.gate_survived ?? 0)
  return out
}

export async function discoverSubreddits(opts: {
  clientId: string
  runId: string
  config: GatherConfig
  today: string
}): Promise<SubredditEntry[]> {
  const admin = createAdminClient()

  // 0. Retire communities that have gone quiet. Runs BEFORE the convergence
  //    check, so a demotion frees a slot and this same run proposes a
  //    replacement instead of waiting a week.
  const yields = await loadLastRedditYields(admin, opts.clientId)
  const strikeResult = applyStrikes(opts.config.subreddits, yields, SUBREDDIT_STRIKE_LIMIT)
  let entries = [...strikeResult.entries]
  if (strikeResult.demoted.length || strikeResult.struck.length) {
    console.log(
      `[reddit] strikes: ${strikeResult.struck.map(subredditLabel).join(', ') || 'none'} struck` +
        `${strikeResult.demoted.length ? ` · demoted ${strikeResult.demoted.map(subredditLabel).join(', ')} → candidate (re-probe queued)` : ''}`,
    )
  }
  const strikesChanged = strikeResult.demoted.length > 0 || strikeResult.struck.length > 0

  // 1. Carry-over first: anything still unprobed (including probes that errored
  //    on an earlier run) is ahead of anything newly proposed.
  let pending = entries.filter((e) => e.status === 'candidate')

  // 2. Top up only if there is room in this run's probe budget AND discovery
  //    hasn't converged.
  if (pending.length < SUBREDDIT_PROBES_PER_RUN && !discoveryConverged(entries)) {
    const fresh = await proposeSubreddits({ ...opts, config: { ...opts.config, subreddits: entries } })
    entries = [...entries, ...fresh]
    pending = [...pending, ...fresh]
  }

  if (!pending.length) {
    // Strike bookkeeping is still a change worth keeping even when there is
    // nothing to probe — otherwise a strike is recounted from zero every week
    // and a dying community never reaches the limit.
    if (strikesChanged) {
      const { error } = await admin.from('tracking_configs').update({ subreddits: entries }).eq('client_id', opts.clientId)
      if (error) throw new Error(`persist subreddit strikes: ${error.message}`)
    }
    console.log(
      discoveryConverged(entries)
        ? `[reddit] discovery: converged (${entries.filter((e) => e.status === 'active').length} active)`
        : '[reddit] discovery: no candidates to probe',
    )
    return entries
  }

  const batch = pending.slice(0, SUBREDDIT_PROBES_PER_RUN)
  const resolved = await probeSubreddits({
    clientId: opts.clientId,
    runId: opts.runId,
    config: opts.config,
    candidates: batch,
    today: opts.today,
  })

  // Fold results back in by canonical name. Only probed entries change; a probe
  // that errored comes back unchanged and stays a candidate for next run.
  const byName = new Map(resolved.map((e) => [e.name, e]))
  const merged = entries.map((e) => byName.get(e.name) ?? e)

  const { error } = await admin
    .from('tracking_configs')
    .update({ subreddits: merged })
    .eq('client_id', opts.clientId)
  if (error) throw new Error(`persist subreddits: ${error.message}`)

  const active = merged.filter((e) => e.status === 'active').map((e) => e.name)
  const stillPending = merged.filter((e) => e.status === 'candidate').length
  console.log(
    `[reddit] discovery: probed ${batch.length} → ${active.length} active total` +
      `${active.length ? ` (${active.join(', ')})` : ''}, ${stillPending} candidate(s) queued`,
  )
  return merged
}
