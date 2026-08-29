import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../supabase-admin'
import { anchorClaims, type Segment } from '../ask/anchor'
import { createCitedQuotePicker, fetchQuotesByAudience, fetchQuoteTextsByCommentId } from '../quotes'
import { quoteRef } from '../renderables/quotes-freeze'
import type { Quote, Scope, Slide } from '../renderables/types'
import { resolveCitations, type CitationMeta } from '../evidence-cite'
import { ASK_THEMES_PER_CLAIM } from '../config'
import { weekdayDate } from '../format'
import type { ClaimResult, Judgement, AskSummary } from '../ask/types'
import type { AgentAnswer } from '../agent/types'
import type { MethodNoteData } from '../../components/print/method-note'

// The agent thread as a page module (Reports & Exports T11, 2026-08-29) —
// what app/dashboard/agent/[id]/page.tsx used to compute inline, as tile-ready
// data the app page, the print route and a snapshot share.
//
// Stored answers carry comment IDS, not words: the words are resolved here,
// through insight_evidence, so an erased comment stops resolving everywhere
// at once. Every quote travels as { ref, text } (c:<comment> or v:<video>),
// and the evidence appendix — platform · date · link per quote — is numbered
// here so the answer's superscripts and the appendix agree.

export type AgentParams = { thread?: string }

export interface ThreadQuote extends Quote {
  commentId: string | null
  videoId: string | null
  /** Appendix number, assigned across the whole thread. */
  n: number
}

export interface ThreadAnswer extends Omit<AgentAnswer, 'grounded'> {
  grounded: (Omit<AgentAnswer['grounded'][number], 'quotes'> & { quotes: ThreadQuote[] })[]
}

export interface Turn {
  question: string
  askedAt: string
  answer: ThreadAnswer | null
  /** The agent's prose when a turn has no structured result. */
  prose: string | null
  outcome: string | null
}

/** A Quote itself (ref + text at the top level), so the freeze/resolve walk
 *  drops an erased voice from the appendix as it does from the answer. */
export interface Citation extends Quote, CitationMeta {
  n: number
}

export interface DocumentCheck {
  sourceFilename: string | null
  claims: ClaimResult[]
  summary: AskSummary
  judgement: Judgement[]
  quotesByClaim: Record<string, Quote[]>
  segments: Segment[]
  anchored: string[]
}

export interface AgentThreadData {
  threadId: string
  kind: 'question' | 'document'
  title: string
  brand: string
  createdAt: string
  turns: Turn[]
  citations: Citation[]
  /** Questions the corpus did not speak to (silent answers), verbatim. */
  silentQuestions: string[]
  document: DocumentCheck | null
  method: MethodNoteData
}

export async function loadAgentThread(scope: Scope): Promise<AgentThreadData | null> {
  const supabase = scope.supabase as SupabaseClient
  const clientId = scope.clientId
  const id = (scope.params as AgentParams).thread
  if (!id) return null

  const [{ data: thread }, { data: rows }, { data: client }] = await Promise.all([
    // RLS already scopes to the tenant; the explicit client_id filter makes a
    // cross-tenant id a miss rather than an empty page.
    supabase.from('agent_threads').select('id, kind, title, plan_check_id, created_at').eq('id', id).eq('client_id', clientId).maybeSingle(),
    supabase.from('agent_messages').select('id, role, content, result, outcome, created_at').eq('thread_id', id).order('created_at', { ascending: true }),
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
  ])
  if (!thread) return null
  type MessageRow = { id: string; role: string; content: string; result: AgentAnswer | null; outcome: string | null; created_at: string }
  const messages = (rows ?? []) as MessageRow[]
  const brand = client?.company_name ?? 'Your brand'

  // Words for the stored comment ids, through insight_evidence (see header).
  const commentIds = messages.flatMap((m) => (m.result?.grounded ?? []).flatMap((g) => g.quotes.map((q) => q.commentId).filter((c): c is string => Boolean(c))))
  const quoteTextP = commentIds.length ? fetchQuoteTextsByCommentId(supabase, commentIds) : Promise.resolve(new Map<string, string>())
  quoteTextP.catch(() => {})

  // A document thread wraps a plan_check; its quotes resolve from stored
  // insight ids — no quote text is kept in either table.
  let document: DocumentCheck | null = null
  if (thread.kind === 'document' && thread.plan_check_id) {
    const { data: check } = await supabase
      .from('plan_checks')
      .select('claims, summary, judgement, input_text, source_filename')
      .eq('id', thread.plan_check_id as string)
      .eq('client_id', clientId)
      .maybeSingle()
    if (check) {
      const claims = (check.claims ?? []) as ClaimResult[]
      const allIds = [...new Set(claims.flatMap((c) => (c.insightIds ?? []).slice(0, ASK_THEMES_PER_CLAIM)))]
      const byAudience = allIds.length ? await fetchQuotesByAudience(supabase, allIds) : new Map()
      const pick = createCitedQuotePicker(byAudience, new Map())
      const quotesByClaim: Record<string, Quote[]> = {}
      for (const c of claims) {
        if (c.verdict === 'silent' || !c.insightIds?.length) continue
        quotesByClaim[c.ref] = pick(c.insightIds.slice(0, ASK_THEMES_PER_CLAIM), 2, `${c.claim}. ${c.theySay ?? ''}`)
      }
      // Every claim is anchored, including untested ones; non-silent first so
      // a shared sentence goes to the claim that earns a mark.
      const ordered = [...claims.filter((c) => c.verdict !== 'silent'), ...claims.filter((c) => c.verdict === 'silent')]
      const { segments, anchored } = anchorClaims((check.input_text as string) ?? '', ordered)
      document = {
        sourceFilename: (check.source_filename as string | null) ?? null,
        claims,
        summary: (check.summary ?? { supported: 0, contradicted: 0, untested: 0 }) as AskSummary,
        judgement: (check.judgement ?? []) as Judgement[],
        quotesByClaim,
        segments,
        anchored: [...anchored],
      }
    }
  }

  const quoteText = await quoteTextP

  // Turns: each user message with the agent message that answered it.
  const turns: Turn[] = []
  let n = 0
  const cited: { ref: string; commentId: string | null; videoId: string | null; text: string; n: number }[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const reply = messages[i + 1]?.role === 'agent' ? messages[i + 1] : null
    let answer: ThreadAnswer | null = null
    if (reply?.result) {
      const grounded = reply.result.grounded.map((g) => ({
        ...g,
        quotes: g.quotes
          .map((q) => ({ ...q, text: q.text || (q.commentId ? quoteText.get(q.commentId) ?? '' : '') }))
          .filter((q) => q.text)
          .map((q) => {
            n += 1
            const ref = q.commentId ? quoteRef.comment(q.commentId) : quoteRef.video(q.videoId as string)
            cited.push({ ref, commentId: q.commentId, videoId: q.videoId, text: q.text, n })
            return { ref, text: q.text, commentId: q.commentId, videoId: q.videoId, n }
          }),
      }))
      answer = { ...reply.result, grounded }
    }
    turns.push({ question: m.content, askedAt: m.created_at, answer, prose: reply && !reply.result ? reply.content : null, outcome: reply?.outcome ?? null })
  }

  // Where each quoted voice was said — a join the app never needed; the
  // appendix does. Admin client: comments/videos are tenant-scoped rows the
  // session can read too, but the render route (no session) needs this path.
  const admin = createAdminClient()
  const meta = cited.length ? await resolveCitations(admin, cited.map((c) => ({ commentId: c.commentId, videoId: c.videoId }))) : new Map<string, CitationMeta>()
  const citations: Citation[] = cited.map((c) => {
    const m = meta.get(c.ref)
    return { n: c.n, ref: c.ref, text: c.text, platform: m?.platform ?? null, date: m?.date ?? null, href: m?.href ?? null, commentLevel: m?.commentLevel ?? false }
  })

  const silentQuestions = turns.filter((t) => t.answer?.silent).map((t) => t.question)
  const platforms = [...new Set(citations.map((c) => c.platform).filter((p): p is string => !!p))]
  const conversations = new Set(turns.flatMap((t) => (t.answer?.grounded ?? []).flatMap((g) => g.insightIds)))

  return {
    threadId: id,
    kind: thread.kind === 'document' ? 'document' : 'question',
    title: (thread.title as string | null) ?? turns[0]?.question ?? 'Question',
    brand,
    createdAt: thread.created_at as string,
    turns,
    citations,
    silentQuestions,
    document,
    method: {
      company: brand,
      period: `Asked ${weekdayDate(thread.created_at as string)}`,
      platforms,
      videos: null,
      comments: citations.length || null,
      note: document
        ? `${document.summary.supported} supported · ${document.summary.contradicted} contradicted · ${document.summary.untested} untested. A claim is untested when nothing in the conversation speaks to it — the blank is the information.`
        : conversations.size > 0
          ? `Every quoted voice is a real comment, listed in the appendix. Findings rest on ${conversations.size} distinct audience insights; the agent's own reading is marked as such.`
          : 'Nothing in the conversation analysed related to what was asked — a real result, not a gap in the tool.',
    },
  }
}

// ── print pagination (pure) ───────────────────────────────────────────────

export const GROUNDED_PER_SLIDE = 2
export const CITATIONS_PER_SLIDE = 9
export const SEGMENT_CHARS_PER_SLIDE = 2600

/** Split the document's segments into slide-sized runs (never inside a
 *  marked span). Returns index ranges into `segments`. */
export function documentPages(segments: Segment[], chars = SEGMENT_CHARS_PER_SLIDE): [number, number][] {
  const pages: [number, number][] = []
  let start = 0
  let count = 0
  for (let i = 0; i < segments.length; i++) {
    count += segments[i].text.length
    if (count >= chars && i + 1 > start) {
      pages.push([start, i + 1])
      start = i + 1
      count = 0
    }
  }
  if (start < segments.length || pages.length === 0) pages.push([start, segments.length])
  return pages
}

export function agentThreadSlides(d: AgentThreadData): Slide[] {
  const slides: Slide[] = []
  if (d.document) {
    const pages = documentPages(d.document.segments)
    pages.forEach((_, p) => slides.push({ title: p === 0 ? `The brief, checked${d.document?.sourceFilename ? ` · ${d.document.sourceFilename}` : ''}` : 'The brief, checked (continued)', keys: [`agent.doc:${p}`], layout: 'single' }))
    for (let c = 0; c < Math.ceil(d.document.claims.length / GROUNDED_PER_SLIDE); c++) slides.push({ title: c === 0 ? 'Claim by claim' : 'Claim by claim (continued)', keys: [`agent.claims:${c}`], layout: 'single' })
    if (d.document.judgement.length) slides.push({ title: 'What the agent would take from that', keys: ['agent.judgement'], layout: 'single' })
    return slides
  }
  d.turns.forEach((t, i) => {
    const grounded = t.answer?.grounded.length ?? 0
    const parts = Math.max(1, Math.ceil(grounded / GROUNDED_PER_SLIDE))
    for (let p = 0; p < parts; p++) slides.push({ title: i === 0 ? d.title : `Follow-up ${i}`, keys: [`agent.turn:${i}:${p}`], layout: 'single' })
    if (t.answer && (t.answer.nearest.length || t.answer.judgement.length)) slides.push({ title: 'Close to it, and what the agent would take from that', keys: [`agent.turn:${i}:more`], layout: 'single' })
  })
  for (let c = 0; c < Math.ceil(d.citations.length / CITATIONS_PER_SLIDE); c++) slides.push({ title: c === 0 ? 'Evidence — every quoted voice' : 'Evidence (continued)', keys: [`agent.citations:${c}`], layout: 'single' })
  if (d.silentQuestions.length) slides.push({ title: 'Nothing in the data speaks to this', keys: ['agent.silent'], layout: 'single' })
  return slides
}
