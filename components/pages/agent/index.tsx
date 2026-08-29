import type { ReactNode } from 'react'
import { platformLabel, weekdayDate } from '@/lib/format'
import type { Verdict } from '@/lib/ask/types'
import {
  agentThreadSlides, loadAgentThread, documentPages, CITATIONS_PER_SLIDE, GROUNDED_PER_SLIDE,
  type AgentThreadData, type ThreadAnswer, type Turn,
} from '@/lib/pages/agent-thread'
import type { PageModule, Renderable } from '@/lib/renderables/types'

// The agent thread on paper (Reports & Exports T11, 2026-08-29). Question
// mode: the question, the answer, "what your customers said" with a
// superscript per quote, then the evidence appendix — every quoted voice
// with platform · date · link — and, honestly, the questions nothing in the
// data spoke to. Document mode: the client's own brief with the verdicts in
// the margin, then claim by claim, then the agent's reading.
//
// The three registers keep their words (components/agent-answer.tsx): what
// the customers said · not what you asked, but close · what I'd take from
// that. A reader must never mistake the third for the first.

type D = AgentThreadData

const VERDICT: Record<Verdict, { label: string; cls: string; mark: string }> = {
  echoes: { label: 'Supported', cls: 'bg-accent text-accent-foreground', mark: 'bg-primary/15' },
  contradicts: { label: 'Contradicted', cls: 'bg-negative/12 text-negative', mark: 'bg-negative/12' },
  silent: { label: 'Untested', cls: 'bg-muted text-muted-foreground', mark: '' },
}

function Sup({ n }: { n: number }) {
  return <sup className="ml-0.5 font-mono text-[9px] text-muted-foreground">{n}</sup>
}

function Question({ t, first, d }: { t: Turn; first: boolean; d: D }) {
  return (
    <div className="mb-4">
      {!first && <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Follow-up</p>}
      <p className="font-serif text-[19px] font-medium leading-snug [text-wrap:pretty]">{t.question}</p>
      <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">{d.brand} · {weekdayDate(t.askedAt)}</p>
    </div>
  )
}

function AnswerBody({ a, from, to }: { a: ThreadAnswer; from: number; to: number }) {
  const points = a.grounded.slice(from, to)
  return (
    <div className="space-y-4">
      {from === 0 && a.notice && <p className="rounded-lg border border-dashed border-border/60 px-4 py-3 text-[12.5px] text-muted-foreground">{a.notice}</p>}
      {from === 0 && <p className="text-[15px] leading-relaxed text-foreground">{a.answer}</p>}
      {points.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">What your customers said{from > 0 ? ' (continued)' : ''}</h3>
          <div className="grid grid-cols-2 gap-3">
            {points.map((p, i) => (
              <div key={p.id} className="space-y-2 rounded-lg bg-inner p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 flex-1 text-[13px] leading-snug"><span className="mr-2 font-mono text-[10.5px] font-semibold text-muted-foreground">{from + i + 1}</span>{p.text}</p>
                  <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{p.conversationCount} {p.conversationCount === 1 ? 'conversation' : 'conversations'}</span>
                </div>
                {p.quotes.map((q) => (
                  <blockquote key={q.n} className="border-l-2 border-border pl-2.5 font-serif text-[12.5px] leading-[1.45] text-foreground">“{q.text}”<Sup n={q.n} /></blockquote>
                ))}
                {p.themeRefs.length > 0 && <p className="text-[10.5px] text-muted-foreground">{p.themeRefs.map((t) => t.label).filter(Boolean).join(' · ')}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function MoreBody({ a }: { a: ThreadAnswer }) {
  const numberOf = new Map(a.grounded.map((g, i) => [g.id, i + 1]))
  return (
    <div className="grid h-full min-h-0 grid-cols-2 gap-8">
      {a.nearest.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">Not what you asked, but close</h3>
          {a.nearest.map((n, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 rounded-lg border border-dashed border-border/60 p-3">
              <p className="min-w-0 flex-1 text-[13px] leading-snug text-foreground/90">{n.text}</p>
              <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{n.conversationCount} {n.conversationCount === 1 ? 'conversation' : 'conversations'}</span>
            </div>
          ))}
        </section>
      )}
      {a.judgement.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">What the agent would take from that</h3>
          <div className="space-y-3 rounded-lg bg-muted p-3">
            {a.judgement.map((j, i) => {
              const cites = j.basedOn.map((r) => numberOf.get(r)).filter((n): n is number => !!n).sort((x, y) => x - y)
              return (
                <div key={i} className="space-y-1">
                  <p className="text-[13px] leading-snug text-foreground/85">{j.text}</p>
                  <p className="text-[10.5px] text-muted-foreground">{cites.length ? `Reasoning from ${cites.length === 1 ? 'finding' : 'findings'} ${cites.join(', ')}.` : 'Not drawn from any single finding — this one is inference.'}</p>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function Citations({ d, from, to }: { d: D; from: number; to: number }) {
  const rows = d.citations.slice(from, to)
  return (
    <div className="grid h-full min-h-0 grid-cols-3 gap-x-6 gap-y-3 content-start">
      {rows.map((c) => (
        <div key={c.n} className="flex gap-2 text-[12px] leading-[1.4]">
          <span className="w-5 shrink-0 font-mono text-[10.5px] text-muted-foreground">{c.n}</span>
          <div className="min-w-0">
            <p className="font-serif text-foreground">“{c.text}”</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {[c.platform ? platformLabel(c.platform) : null, c.date].filter(Boolean).join(' · ') || 'source on file'}
              {c.href && <> · <a href={c.href} className="underline decoration-dotted underline-offset-2">{c.commentLevel ? 'the comment' : 'the post'}</a></>}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function Silent({ d }: { d: D }) {
  return (
    <div className="max-w-[46rem] space-y-4">
      <p className="text-[13px] text-secondary-foreground">The conversation analysed for {d.brand} did not speak to these. That is a result, not a gap in the tool: nobody in the tracked audience has said anything about them yet.</p>
      <ul className="space-y-2">
        {d.silentQuestions.map((q, i) => <li key={i} className="font-serif text-[15px] leading-snug">“{q}”</li>)}
      </ul>
    </div>
  )
}

/** The client's brief with the verdicts in the margin. */
function DocumentPage({ d, page }: { d: D; page: number }) {
  const doc = d.document!
  const [from, to] = documentPages(doc.segments)[page] ?? [0, 0]
  const segs = doc.segments.slice(from, to)
  const numberOf = new Map(doc.claims.map((c, i) => [c.ref, i + 1]))
  const refsHere = [...new Set(segs.map((s) => s.ref).filter((r): r is string => !!r))]
  const claimsHere = doc.claims.filter((c) => refsHere.includes(c.ref))
  return (
    <div className="grid h-full min-h-0 grid-cols-[3fr_1.3fr] gap-8">
      <div className="min-h-0 overflow-hidden">
        {page === 0 && (
          <p className="mb-3 font-mono text-[10.5px] text-muted-foreground">
            {doc.summary.supported} supported · {doc.summary.contradicted} contradicted · {doc.summary.untested} untested
          </p>
        )}
        <p className="whitespace-pre-wrap font-serif text-[12.5px] leading-[1.6] text-foreground">
          {segs.map((s, i) => {
            const claim = s.ref ? doc.claims.find((c) => c.ref === s.ref) : null
            if (!claim || claim.verdict === 'silent') return <span key={i}>{s.text}</span>
            return <mark key={i} className={`rounded-[2px] px-0.5 ${VERDICT[claim.verdict].mark}`}>{s.text}<Sup n={numberOf.get(claim.ref) ?? 0} /></mark>
          })}
        </p>
      </div>
      <div className="min-h-0 space-y-2 overflow-hidden">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">In the margin</p>
        {claimsHere.length === 0 && <p className="text-[12px] text-muted-foreground">No claim on this page.</p>}
        {claimsHere.map((c) => (
          <div key={c.ref} className="rounded-lg bg-inner p-2.5">
            <div className="flex items-start gap-2">
              <span className="font-mono text-[10.5px] text-muted-foreground">{numberOf.get(c.ref)}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${VERDICT[c.verdict].cls}`}>{VERDICT[c.verdict].label}</span>
            </div>
            <p className="mt-1 text-[12px] leading-snug">{c.claim}</p>
            {c.verdict !== 'silent' && c.theySay && <p className="mt-1 text-[11px] leading-snug text-secondary-foreground">{c.theySay}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

function ClaimsPage({ d, page }: { d: D; page: number }) {
  const doc = d.document!
  const claims = doc.claims.slice(page * GROUNDED_PER_SLIDE, page * GROUNDED_PER_SLIDE + GROUNDED_PER_SLIDE)
  return (
    <div className="grid h-full min-h-0 grid-cols-2 gap-4 content-start">
      {claims.map((c) => {
        const i = doc.claims.indexOf(c)
        const quotes = doc.quotesByClaim[c.ref] ?? []
        return (
          <div key={c.ref} className="space-y-2 rounded-lg bg-inner p-3">
            <div className="flex items-start gap-3">
              <span className="font-mono text-[10.5px] font-semibold text-muted-foreground">{i + 1}</span>
              <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug">{c.claim}</p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${VERDICT[c.verdict].cls}`}>{VERDICT[c.verdict].label}</span>
            </div>
            {!doc.anchored.includes(c.ref) && <p className="text-[10.5px] text-muted-foreground">Not stated directly in the document.</p>}
            {c.verdict !== 'silent' && (
              <div className="space-y-2 border-l-2 border-border pl-2.5">
                {quotes.map((q, k) => <blockquote key={k} className="font-serif text-[12px] leading-[1.45]">“{q.text}”</blockquote>)}
                {c.theySay && <p className="text-[12px] leading-snug text-foreground/85">{c.theySay}</p>}
                <p className="text-[10.5px] text-muted-foreground">{c.conversationCount} {c.conversationCount === 1 ? 'conversation' : 'conversations'}{c.themeRefs?.length ? ` · ${c.themeRefs.map((t) => t.label).filter(Boolean).join(' · ')}` : ''}</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function DocJudgement({ d }: { d: D }) {
  const doc = d.document!
  const numberOf = new Map(doc.claims.map((c, i) => [c.ref, i + 1]))
  return (
    <div className="max-w-[46rem] space-y-3 rounded-lg bg-muted p-4">
      {doc.judgement.map((j, i) => {
        const cites = (j.basedOnRefs ?? []).map((r) => numberOf.get(r)).filter((n): n is number => !!n).sort((x, y) => x - y)
        return (
          <div key={i} className="space-y-1">
            <p className="text-[13.5px] leading-snug text-foreground/85">{j.text}</p>
            <p className="text-[10.5px] text-muted-foreground">{cites.length ? `Reasoning from ${cites.length === 1 ? 'claim' : 'claims'} ${cites.join(', ')}.` : 'Not drawn from any single claim — this one is inference.'}</p>
          </div>
        )
      })}
    </div>
  )
}

/** One answer as a standalone card (PNG export): the question and the whole answer. */
function AnswerCard({ d, turn }: { d: D; turn: number }) {
  const t = d.turns[turn]
  if (!t) return null
  return (
    <div data-tile="" className="w-[760px] space-y-4 rounded-lg bg-tile p-6">
      <Question t={t} first={turn === 0} d={d} />
      {t.answer ? <AnswerBody a={t.answer} from={0} to={t.answer.grounded.length} /> : <p className="text-[13px]">{t.prose}</p>}
      {t.answer && t.answer.judgement.length > 0 && <MoreBody a={{ ...t.answer, nearest: [] }} />}
      <p className="border-t border-border/70 pt-2 font-mono text-[9.5px] text-muted-foreground">Prepared by {d.brand} · with Verbatim · quoted voices are real comments, on file</p>
    </div>
  )
}

/** Keys are computed (`agent.turn:<i>:<p>`, `agent.citations:<c>`, …), so a
 *  Proxy resolves them; the static map lists what is stable. */
function resolve(key: string): Renderable<D> | undefined {
  const mk = (title: string, render: (d: D) => ReactNode): Renderable<D> => ({ key, title, render })
  let m: RegExpExecArray | null
  if ((m = /^agent\.turn:(\d+):(\d+|more)$/.exec(key))) {
    const i = Number(m[1]); const part = m[2]
    return mk('Answer', (d) => {
      const t = d.turns[i]; if (!t) return null
      if (part === 'more') return t.answer ? <MoreBody a={t.answer} /> : null
      const p = Number(part)
      return (
        <div className="min-h-0 overflow-hidden">
          {p === 0 && <Question t={t} first={i === 0} d={d} />}
          {t.answer ? <AnswerBody a={t.answer} from={p * GROUNDED_PER_SLIDE} to={p * GROUNDED_PER_SLIDE + GROUNDED_PER_SLIDE} /> : <p className="text-[13px]">{t.prose ?? 'That question did not get an answer — something went wrong on our side rather than in the data.'}</p>}
        </div>
      )
    })
  }
  if ((m = /^agent\.citations:(\d+)$/.exec(key))) { const c = Number(m[1]); return mk('Evidence', (d) => <Citations d={d} from={c * CITATIONS_PER_SLIDE} to={c * CITATIONS_PER_SLIDE + CITATIONS_PER_SLIDE} />) }
  if (key === 'agent.silent') return mk('Nothing in the data speaks to this', (d) => <Silent d={d} />)
  if ((m = /^agent\.doc:(\d+)$/.exec(key))) { const p = Number(m[1]); return mk('The brief, checked', (d) => (d.document ? <DocumentPage d={d} page={p} /> : null)) }
  if ((m = /^agent\.claims:(\d+)$/.exec(key))) { const p = Number(m[1]); return mk('Claim by claim', (d) => (d.document ? <ClaimsPage d={d} page={p} /> : null)) }
  if (key === 'agent.judgement') return mk('What the agent would take from that', (d) => (d.document ? <DocJudgement d={d} /> : null))
  if ((m = /^agent\.answer:(\d+)$/.exec(key))) { const i = Number(m[1]); return mk(`Answer ${i + 1}`, (d) => <AnswerCard d={d} turn={i} />) }
  return undefined
}

const renderables: Record<string, Renderable<D>> = new Proxy({} as Record<string, Renderable<D>>, {
  get: (_t, key: string | symbol) => (typeof key === 'string' ? resolve(key) : undefined),
  has: (_t, key: string | symbol) => typeof key === 'string' && !!resolve(key),
})

export const agentPage: PageModule<D> = {
  key: 'agent',
  title: 'Verbatim Agent',
  load: loadAgentThread,
  slides: agentThreadSlides,
  renderables,
  snapshotTitle: (d) => `${d.kind === 'document' ? 'Document check' : 'Agent'} · ${d.title.slice(0, 80)} · ${weekdayDate(d.createdAt)}`,
  printContext: (d) => `${d.kind === 'document' ? 'Document check' : 'Verbatim Agent'} · ${d.brand} · ${weekdayDate(d.createdAt)}`,
}
