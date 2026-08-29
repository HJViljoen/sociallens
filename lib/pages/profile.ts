import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchInsightsByIds, fetchQuotesByAudience, createCitedQuotePicker, type QuoteRow } from '../quotes'
import type { Quote, Scope } from '../renderables/types'
import { weekdayDate } from '../format'
import { normalisePersona, shareOf, platformTotals, platformRows, platformsFromRows, shareSeries, type Persona } from '../profile-tiles'
import type { PlatformRow, ShareSeries } from '../../components/profile-stats'
import type { MethodNoteData } from '../../components/print/method-note'
import { EXPORT_FULL_MAX_ITEMS } from '../config'

// Consumer Profile loader — the data half of the old app/dashboard/profile/page.tsx
// (split 2026-08-29, Reports & Exports T7). "Who is actually talking?" — a few
// personas built from the run's insight population, the one on screen (or, in
// `full`, every one) in full: a description, a real voice per block, where they
// turn up, how the mix has moved.
//
// Rules kept: `consumer_profiles` is deliberately NOT pinned to the latest run
// (Pass E is flag-gated / can be written offline — pinning would blank the page
// the moment a run completes without one); `isStale` says which update the
// profile is actually from instead. Personas are matched across updates on
// their `key`, not their name (a reasoning model takes no temperature — the
// same input still gets reworded).

export type ProfileParams = { persona?: string }

/** The switcher pill row — every persona in the cast, in the profile's order. */
export interface PersonaCard {
  key: string
  name: string
}

/** One persona in full — the "who this is" + three blocks a switcher pick (or
 *  a `full`-export slide) renders. */
export interface PersonaDetail {
  key: string
  name: string
  oneLiner: string
  scope: 'category' | 'client'
  wants: string
  blockers: string
  triggers: string
  sourceVideoCount: number
  prevalence: string
  /** This persona's share of the profile it appears in (lib/profile-tiles.shareOf). */
  share: number
  drivesQuote: Quote | null
  stopsQuote: Quote | null
  worksQuote: Quote | null
}

export interface ProfileData {
  brand: string
  /** The stored profile's OWN update date — not necessarily the latest run's
   *  (see the header comment); what "Update of …" and the snapshot title use. */
  runDate: string
  personas: PersonaCard[]
  activeKey: string
  active: PersonaDetail
  /** True when the stored profile is from an earlier update than the latest
   *  one (Pass E can lag or run offline — see the header comment). */
  isStale: boolean
  staleRunDate: string | null
  platformMix: { rows: PlatformRow[]; platforms: string[] }
  shareOverTime: { dates: string[]; series: ShareSeries[] }
  /** `full` variant only: every persona in full, one slide each. */
  full?: PersonaDetail[]
  method: MethodNoteData
}

/** Two distinct empty states the old page told apart: no analysed update yet,
 *  vs. an update with too little conversation to describe who is talking. */
export type ProfileEmpty = { empty: true; reason: 'no-run' | 'no-personas' }

export const isProfileEmpty = (d: ProfileData | ProfileEmpty): d is ProfileEmpty => 'empty' in d

export async function loadProfile(scope: Scope): Promise<ProfileData | ProfileEmpty> {
  const supabase = scope.supabase as SupabaseClient
  const clientId = scope.clientId
  const sp = scope.params as ProfileParams
  const full = scope.variant === 'full'

  // All four reads are keyed on the client alone, so they go out together —
  // round trips, not rows, are the cost here (the DB pays a ~0.5s wake-up on
  // the first requests after idle, and every sequential wave pays it again).
  // `client` (company name, for the method note) is new here — the old page
  // never fetched it, because it never printed one.
  const [{ data: client }, { data: latestRun }, { data: profileRow }, { data: historyRows }] = await Promise.all([
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    // Latest closed run, same anchor as every other page — an in-flight run has
    // no profile yet, so the previous one keeps serving.
    supabase
      .from('pipeline_runs').select('id')
      .eq('client_id', clientId).in('status', ['completed', 'partial'])
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    // Newest stored profile, not "the newest run's profile". Pass E is
    // flag-gated and profiles can be written offline, so pinning to the latest
    // run would blank this page the moment a run completes without one — and the
    // empty state would claim there is too little conversation, which would be a
    // false statement about the data rather than about the pass.
    supabase
      .from('consumer_profiles')
      .select('headline, personas, run_date, run_id')
      .eq('client_id', clientId)
      .order('run_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // How the mix has moved (used further down). Personas are matched across
    // runs on their key, which continuity keeps stable — matching on name
    // would break the moment a persona was reworded.
    supabase
      .from('consumer_profiles')
      .select('run_date, personas')
      .eq('client_id', clientId)
      .order('run_date', { ascending: true })
      .limit(12),
  ])

  const brand = client?.company_name ?? 'your brand'

  if (!latestRun) return { empty: true, reason: 'no-run' }

  const profile = profileRow as { headline: string | null; personas: Partial<Persona>[]; run_date: string; run_id: string } | null
  const personas = (profile?.personas ?? [])
    .map((p) => normalisePersona(p as Partial<Persona>))
    .filter((p): p is Persona => Boolean(p))
  const isStale = Boolean(profile) && profile?.run_id !== (latestRun.id as string)

  if (!profile || !personas.length) return { empty: true, reason: 'no-personas' }

  // Each persona's share of the conversation this profile covers (lib/profile-tiles).
  const profileVideoTotal = personas.reduce((n, p) => n + (p.sourceVideoCount || 0), 0)

  const activeIndex = Math.max(0, personas.findIndex((p) => p.key === sp.persona))
  const active = personas[activeIndex]

  // Where each persona turns up. Platform lives on the insight, so this is a
  // read over the ids the personas already carry — the base table, not the
  // view, because these ids must resolve even where a newer run has superseded
  // the rows but not yet pruned them.
  // Personas written since 2026-08-29 carry their own mix; only the older
  // ones need the join, and only for them are the ids fetched.
  const allInsightIds = [...new Set(personas.filter((p) => !p.platformMix).flatMap((p) => p.insightIds))]
  // The voices (below) hang off the same personas — fetched in the same wave.
  // In the `full` export every persona's voices are wanted; one chunked pass
  // over their combined insight ids (fetchQuotesByAudience already chunks
  // internally), never one round trip per persona.
  // The active persona first, so its voices are the ones the reader saw and
  // slide 1 is the persona on screen even past the cap.
  const wantedPersonas = full ? [active, ...personas.filter((p) => p.key !== active.key)].slice(0, EXPORT_FULL_MAX_ITEMS) : [active]
  const voiceIds = wantedPersonas.flatMap((p) => p.insightIds.slice(0, 60))
  const [insightRows, quotesByAudience] = await Promise.all([
    allInsightIds.length
      ? fetchInsightsByIds<{ id: string; platform: string | null; source_video_id: string | null }>(
          supabase,
          allInsightIds,
          'id, platform, source_video_id',
        )
      : Promise.resolve([]),
    voiceIds.length ? fetchQuotesByAudience(supabase, voiceIds) : Promise.resolve(new Map<string, QuoteRow[]>()),
  ])
  const insightMeta = new Map(insightRows.map((r) => [r.id, r]))

  // Which platforms the card draws, biggest first. Counted in DISTINCT
  // conversations so the ordering is by real reach rather than by how many
  // personas happen to mention a platform.
  const rows = platformRows(personas, insightMeta)
  const totals = platformTotals(insightRows)
  const platforms = insightRows.length
    ? [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
    : platformsFromRows(rows)

  // How the mix has moved (rows fetched in the first wave above).
  const history = (historyRows ?? []) as { run_date: string; personas: Partial<Persona>[] }[]
  const shareDates = history.map((h) => h.run_date)
  const series = shareSeries(personas, history)

  // One real voice per block. The page describes people; without their words
  // the description is a claim the reader has to take on trust — and the
  // product is called Verbatim. The picker de-duplicates across calls, so each
  // block (and, in `full`, each persona) gets a different person rather than
  // the same quote twice.
  const pickVoice = createCitedQuotePicker(quotesByAudience, new Map())
  const voiceFor = (ids: string[], text: string): Quote | null => {
    if (!ids.length) return null
    const [q] = pickVoice(ids, 1, text)
    return q ?? null
  }
  const detailOf = (p: Persona): PersonaDetail => {
    const ids = p.insightIds.slice(0, 60)
    return {
      key: p.key, name: p.name, oneLiner: p.oneLiner, scope: p.scope,
      wants: p.wants, blockers: p.blockers, triggers: p.triggers,
      sourceVideoCount: p.sourceVideoCount, prevalence: p.prevalence,
      share: shareOf(p, profileVideoTotal),
      drivesQuote: voiceFor(ids, p.wants),
      stopsQuote: voiceFor(ids, p.blockers),
      worksQuote: voiceFor(ids, p.triggers),
    }
  }
  const details = wantedPersonas.map(detailOf)
  const activeDetail = details.find((d) => d.key === active.key) ?? details[0]

  return {
    brand,
    runDate: profile.run_date,
    personas: personas.map((p) => ({ key: p.key, name: p.name })),
    activeKey: active.key,
    active: activeDetail,
    isStale,
    staleRunDate: isStale ? profile.run_date : null,
    platformMix: { rows, platforms },
    shareOverTime: { dates: shareDates, series },
    full: full ? details : undefined,
    method: {
      company: brand,
      // The profile's own update, not the latest run's — the same reason it
      // isn't pinned to latestRun above: this is honestly what the shown
      // personas are FROM.
      period: `Update of ${weekdayDate(profile.run_date)}`,
      platforms,
      videos: null,
      comments: null,
      note: `${personas.length} ${personas.length === 1 ? 'persona' : 'personas'} built from this update's insight population — each one's share is of this profile, not of the whole tracked category.`,
    },
  }
}
