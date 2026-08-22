import type { AgentAnswer, GroundedPoint, JudgementPoint, NearestThing } from './types'
import type { RetrievedInsight } from './retrieve'
import { countConversations } from './rank'
import { AGENT_QUOTES_PER_POINT } from '../config'
import { readsAsHeroQuote } from '../quotes'

// Where "no proof is ever created by the bot" stops being a principle and
// becomes code.
//
// The model proposes; this decides what the client is allowed to see as
// evidence. Nothing here trusts a returned field: ids are checked against rows
// that were actually retrieved, counts are recomputed, quotes are attached from
// the retrieved evidence rather than from anything the model wrote.
//
// DEMOTE, NEVER DROP. A point whose ids do not resolve is not deleted — it
// moves to the judgement register, where it is honestly labelled as the agent's
// own reasoning. Deleting it would be over-restriction, and over-restriction
// shows up to a client as false silence: an answer suppressed when the corpus
// could have spoken. That is the worse failure of the two, and the rule that
// keeps it from happening lives here.

/** What the model is allowed to hand back. Deliberately loose — validation is
 *  this module's job, not the schema's, so a near-miss can be repaired instead
 *  of throwing the whole answer away. */
export interface RawAnswer {
  answer?: string | null
  grounded?: { ref?: string | null; text?: string | null; insightIds?: unknown }[] | null
  judgement?: { text?: string | null; basedOn?: unknown }[] | null
  nearest?: { text?: string | null; insightIds?: unknown }[] | null
}

export interface EnforceOptions {
  /** Document mode never offers a nearest thing. */
  allowNearest: boolean
  runId: string
  costUsd: number
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** The one sentence used when the corpus has nothing. Fixed text, not model
 *  prose: "I don't know" is a promise about the data, and a model that phrases
 *  it freshly each time will eventually phrase it as a hedge. */
export const SILENCE_SENTENCE =
  'Nothing in the conversation we have analysed relates to this.'

export function enforceRegisters(
  raw: RawAnswer,
  retrieved: RetrievedInsight[],
  opts: EnforceOptions,
): AgentAnswer {
  const byId = new Map(retrieved.map((i) => [i.id, i]))

  const grounded: GroundedPoint[] = []
  const demoted: JudgementPoint[] = []
  // Quotes are deduplicated ACROSS points. Overlapping insight sets otherwise
  // put the same comment under two different findings, which reads as thinner
  // evidence than there is — the same "no voice repeats on a page" rule
  // createQuotePicker already enforces on the dashboard.
  const usedQuotes = new Set<string>()
  // Did ANY point resolve to real, live analysis — even if it could not be
  // quoted? This is the difference between "the corpus does not speak to this"
  // and "the corpus speaks to this but we cannot quote it", and collapsing the
  // two into silence would tell a client we have nothing when we do.
  let resolvedAnything = false

  for (const [index, point] of (raw.grounded ?? []).entries()) {
    const text = clean(point?.text)
    if (!text) continue

    // Only ids that were actually retrieved count. A model can invent a uuid;
    // it cannot invent one that came back from the database a moment ago.
    const claimed = asStrings(point?.insightIds)
    const live = [...new Set(claimed.filter((id) => byId.has(id)))]

    if (live.length === 0) {
      // The point may still be true and useful — it just isn't evidenced.
      demoted.push({ text, basedOn: [] })
      continue
    }

    resolvedAnything = true
    const insights = live.map((id) => byId.get(id)!)
    const quotes: GroundedPoint['quotes'] = []
    for (const i of insights) {
      // English-first, as a PREFERENCE and never a gate — the same rule the
      // Pass D hero pool and the frontend picker already use (lib/quotes.ts).
      // The corpus is genuinely multilingual and dropping those voices would
      // misrepresent it; but a claim a reader cannot read is a claim they
      // cannot check, and these answers get pasted into slides.
      const ordered = [...i.quotes].sort(
        (x, y) => Number(readsAsHeroQuote(y.quote)) - Number(readsAsHeroQuote(x.quote)) || x.rank - y.rank,
      )
      for (const q of ordered) {
        if (quotes.length >= AGENT_QUOTES_PER_POINT) break
        const key = q.commentId ?? q.quote
        if (usedQuotes.has(key)) continue
        usedQuotes.add(key)
        quotes.push({ text: q.quote, commentId: q.commentId, videoId: q.videoId })
      }
      if (quotes.length >= AGENT_QUOTES_PER_POINT) break
    }

    // Dedup must not become a demotion. If every quote this point could show
    // was already spent on an earlier point, the point is still evidenced —
    // repeating one voice is much better than moving a real finding out of the
    // evidence register because of a display rule.
    if (quotes.length === 0) {
      const fallback = insights
        .flatMap((i) => i.quotes)
        .sort((x, y) => Number(readsAsHeroQuote(y.quote)) - Number(readsAsHeroQuote(x.quote)) || x.rank - y.rank)[0]
      if (fallback) {
        quotes.push({ text: fallback.quote, commentId: fallback.commentId, videoId: fallback.videoId })
      }
    }

    // A grounded point with no quotable comment behind it is the exact shape
    // the 2026-08-19 review caught: structurally grounded, but the sentence the
    // reader reads was unconstrained prose under an evidence badge. It carries
    // real insight ids, so it is not fabricated — but it is not quotable
    // either, so it reads as judgement.
    if (quotes.length === 0) {
      demoted.push({ text, basedOn: [] })
      continue
    }

    const themeRefs = [
      ...new Map(
        insights
          .map((i) => i.themeRef)
          .filter((t): t is NonNullable<typeof t> => Boolean(t))
          .map((t) => [t.themeId, { themeId: t.themeId, registryId: t.registryId, label: t.label }]),
      ).values(),
    ]

    // The model's own ref is the id, so judgement's `based_on` can actually
    // resolve. Falling back to a positional label keeps older/garbled replies
    // renderable rather than throwing the answer away.
    const ref = clean(point?.ref) || `G${index + 1}`
    grounded.push({
      id: ref,
      text,
      insightIds: live,
      themeRefs,
      quotes,
      conversationCount: countConversations(insights),
    })
  }

  const groundedIds = new Set(grounded.map((g) => g.id))

  const judgement: JudgementPoint[] = []
  for (const point of raw.judgement ?? []) {
    const text = clean(point?.text)
    if (!text) continue
    const basedOn = [...new Set(asStrings(point?.basedOn).filter((ref) => groundedIds.has(ref)))]
    // A proposal citing nothing that survived is untethered. It is kept — the
    // register is honest about what it is — but with its dead references
    // stripped rather than shown to a reader as though they led somewhere.
    judgement.push({ text, basedOn })
  }
  judgement.push(...demoted)

  const nearest: NearestThing[] = []
  if (opts.allowNearest) {
    for (const item of raw.nearest ?? []) {
      const text = clean(item?.text)
      if (!text) continue
      const live = [...new Set(asStrings(item?.insightIds).filter((id) => byId.has(id)))]
      // A "nearest thing" that resolves to nothing is not a nearest thing.
      if (live.length === 0) continue
      nearest.push({
        text,
        insightIds: live,
        conversationCount: countConversations(live.map((id) => byId.get(id)!)),
      })
    }
  }

  // TRUE silence is "nothing resolved at all". A point that resolved to real
  // analysis but could not be quoted is NOT silence — saying "nothing relates
  // to this" there would be false, because something does. It becomes an
  // unquotable answer carried in the judgement register instead.
  const silent = grounded.length === 0 && !resolvedAnything
  const answer = silent ? SILENCE_SENTENCE : clean(raw.answer) || SILENCE_SENTENCE

  return {
    answer,
    grounded,
    // Under true silence, whatever the model reasoned its way to it reasoned
    // without any evidence at all, and printing it beneath "nothing relates to
    // this" is padding of exactly the kind this product is trying not to ship.
    judgement: silent ? [] : judgement,
    silent,
    nearest,
    runId: opts.runId,
    costUsd: opts.costUsd,
  }
}
