import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSessionContext } from '@/lib/auth'
import { Card, CardContent } from '@/components/ui/card'
import { AgentComposer } from '@/components/agent-composer'
import { AgentAnswerView } from '@/components/agent-answer'
import { AgentDocumentSplit } from '@/components/agent-document-split'
import { anchorClaims } from '@/lib/ask/anchor'
import { createQuotePicker, fetchQuotesByAudience, fetchQuoteTextsByCommentId } from '@/lib/quotes'
import { ASK_THEMES_PER_CLAIM } from '@/lib/config'
import type { ClaimResult, Judgement, AskSummary } from '@/lib/ask/types'
import { isPlatformAdmin } from '@/lib/agent/access'
import type { AgentAnswer } from '@/lib/agent/types'

// One thread, at its own URL. The whole exchange, oldest first, so it reads as
// the conversation it was rather than as a list of results.

interface MessageRow {
  id: string
  role: string
  content: string
  result: AgentAnswer | null
  outcome: string | null
  created_at: string
}

export default async function AgentThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, clientId, userId } = await getSessionContext()
  // Admin check, the thread, and its turns all key on what the request already
  // knows, so they go out in one wave — round trips, not rows, are the cost
  // (the DB pays a ~0.5s wake-up on the first requests after idle, and every
  // sequential wave pays it again). The turns are read through RLS too, and
  // are discarded below if the thread is not this tenant's.
  const [canSend, { data: thread }, { data: rows }] = await Promise.all([
    isPlatformAdmin(userId),
    // RLS already scopes to the tenant; the explicit client_id filter makes a
    // cross-tenant id a 404 rather than an empty page.
    supabase
      .from('agent_threads')
      .select('id, kind, title, plan_check_id, created_at')
      .eq('id', id)
      .eq('client_id', clientId)
      .maybeSingle(),
    supabase
      .from('agent_messages')
      .select('id, role, content, result, outcome, created_at')
      .eq('thread_id', id)
      .order('created_at', { ascending: true }),
  ])
  if (!thread) notFound()
  const messages = (rows ?? []) as MessageRow[]

  // Stored answers carry comment IDS, not words. Resolve the words now, through
  // insight_evidence — so a comment the erasure sweep removed simply stops
  // resolving and disappears from every stored answer at once. A quote that no
  // longer resolves is dropped rather than shown blank. Kicked off here so it
  // overlaps the document's own quote fetch below; awaited after.
  const commentIds = messages.flatMap((m) =>
    (m.result?.grounded ?? []).flatMap((g) => g.quotes.map((q) => q.commentId).filter((c): c is string => Boolean(c))),
  )
  const quoteTextP = commentIds.length ? fetchQuoteTextsByCommentId(supabase, commentIds) : Promise.resolve(new Map<string, string>())
  // A rejection is surfaced at the await below; this only stops it counting as
  // unhandled while the document branch is still in flight.
  quoteTextP.catch(() => {})

  // A document thread wraps a plan_check. Quotes are resolved live from the
  // stored insight ids — no quote text is kept in either table, so an erased
  // comment cannot survive inside a saved check.
  let doc: {
    claims: ClaimResult[]
    summary: AskSummary
    judgement: Judgement[]
    quotesByClaim: Map<string, string[]>
    segments: import('@/lib/ask/anchor').Segment[]
    anchored: string[]
  } | null = null
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
      const pick = createQuotePicker(byAudience, new Map())
      const quotesByClaim = new Map<string, string[]>()
      for (const c of claims) {
        if (c.verdict === 'silent' || !c.insightIds?.length) continue
        // The same slice that was fetched — asking the picker for ids nobody
        // loaded would quietly return fewer voices than exist.
        quotesByClaim.set(c.ref, pick(c.insightIds.slice(0, ASK_THEMES_PER_CLAIM), 2, `${c.claim}. ${c.theySay ?? ''}`))
      }
      // EVERY claim is anchored, including untested ones. Two different
      // questions were being answered by one set: "does this claim get a
      // highlight" (non-silent only — silence is clean space) and "is this
      // claim written in the document at all" (a fact about the document,
      // true or false regardless of the verdict). Filtering here answered the
      // first and was then read as the second, so every untested claim was
      // labelled "not stated directly in the document" even when it was there
      // word for word.
      //
      // Non-silent claims go FIRST so that if two claims share a sentence, the
      // one that earns a mark wins the overlap. Rendering still skips silent
      // ones: the mark styles are keyed by verdict and there is none for
      // 'silent', so those spans fall through as ordinary text.
      const ordered = [
        ...claims.filter((c) => c.verdict !== 'silent'),
        ...claims.filter((c) => c.verdict === 'silent'),
      ]
      const { segments, anchored } = anchorClaims((check.input_text as string) ?? '', ordered)
      doc = {
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
  for (const m of messages) {
    if (!m.result?.grounded) continue
    for (const g of m.result.grounded) {
      g.quotes = g.quotes
        .map((q) => ({ ...q, text: q.text || (q.commentId ? quoteText.get(q.commentId) ?? '' : '') }))
        .filter((q) => q.text)
    }
  }

  // A document thread takes over the pane: the check on the left, their
  // document on the right, each scrolling independently. Same shape as an
  // artifact panel, and the reason Heinrich's idea works — the annotation is
  // markup over text WE rendered, so their file is never stored or edited.
  if (doc) {
    return (
      <div className="agent-fixed relative flex min-h-0 flex-1 flex-col gap-4">
        <div>
          <Link
            href="/dashboard/agent"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All questions
          </Link>
          <h1 className="mt-2 text-xl font-semibold">{thread.title as string}</h1>
        </div>
        <AgentDocumentSplit {...doc} notice={null} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/agent"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All questions
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{thread.title as string}</h1>
      </div>


      <div className="space-y-5">
        {messages.map((m, i) =>
          // The heading above IS the first question — printing it again
          // directly underneath reads as a stutter. Follow-ups still show,
          // because in a thread they are the turn that changed the answer.
          (m.role === 'user' && i === 0) || doc ? null : m.role === 'user' ? (
            <p key={m.id} className="text-[15px] font-medium text-foreground">
              {m.content}
            </p>
          ) : (
            <Card key={m.id} className="bg-popover">
              <CardContent className="py-5">
                {m.result ? (
                  <AgentAnswerView answer={m.result} />
                ) : (
                  <p className="text-[15px] leading-relaxed text-foreground">{m.content}</p>
                )}
              </CardContent>
            </Card>
          ),
        )}
        {/* A question with no answer after it: the call failed and was
            deliberately not written as a silent answer. Saying so is better
            than an exchange that just stops. */}
        {/* !doc: a document thread's only message is the "Checked: x.pdf"
            marker and its answer is the annotated document above, so the
            last-turn-is-a-question test would otherwise report every
            successful check as a failure. */}
        {!doc && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
          <p className="text-sm text-clay">
            That question did not get an answer &mdash; something went wrong on our side rather than in
            your data. Asking it again is safe.
          </p>
        )}
      </div>

      <AgentComposer canSend={canSend} threadId={id} placeholder="Push back, or narrow it down" />
    </div>
  )
}
