import { DOCUMENT_BLOCK_MAX, DOCUMENT_CITED_COUNT_MIN, DOCUMENT_FINDING_MIN_CONVERSATIONS, DOCUMENT_THIN_CONVERSATIONS } from '../../config'
import { readsAsHeroQuote } from '../../quotes'
import type { Quote, Slide } from '../../renderables/types'
import type { FigureTable } from '../types'
import type { Signals } from './signals'
import type { ResearchAnswer, ResearchPoint } from './research'
import { ASKED_MAX, CLAIMS_PER_PAGE, PAGE_TITLE, PERSONAS_PER_PAGE, type DocumentTemplate } from './templates'
import type { DocPageKind } from './types'
import type { WriterOutput } from './write'
import { bucketWord, slug } from './write'
import { SURE_WORDS, calibrateSure, productTokens, resolveIndices, scrubLine, scrubText, singularise } from './scrub'
import type { BlockWorkings, DocBlock, DocPage, DocumentSettings, DocumentSnapshotData, DocumentWorkings } from './types'

/**
 * From the writer's output and the signals to the frozen document (pure).
 *
 * The page ORDER is the template's skeleton, walked in order (2026-09-02):
 * a template without a competitor page prints none, and a page whose only
 * material is missing (no claims to answer, nothing held back) drops out
 * rather than printing an empty sheet. Findings are resolved before the walk
 * because the overview lists them.
 * Code owns what code can own: the figure table and every number, the order
 * of the findings (by the evidence behind them), where each was heard, how
 * sure the reading is, which quote leads a finding, the finding floor and
 * the thin-week rule, the page count, the method page. The model owns the
 * words inside the blocks, and only after scrub.
 */

const cap = (field: string) => DOCUMENT_BLOCK_MAX[field] ?? 400
const fmtCount = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n))
const fmtPct = (n: number) => `${Math.round(n * 10) / 10}%`
/** Names in the inputs that carry digits, so the writer may repeat them. */
export function allowedTokens(s: Signals, answers: ResearchAnswer[]): string[] {
  return productTokens([
    ...s.competitors.flatMap((c) => c.claims.map((cl) => cl.claim)),
    ...s.themes.flatMap((t) => [t.label, t.description]),
    ...answers.flatMap((a) => a.grounded.map((p) => p.text)),
    ...s.sayVsHear.map((e) => e.you_say),
  ])
}

export function thinWeek(s: Pick<Signals, 'runStatus' | 'run'>): boolean {
  return s.runStatus === 'partial' || s.run.conversations < DOCUMENT_THIN_CONVERSATIONS
}

/** Every figure the writer may cite, computed in code from the signals and
 *  the research: the update's numbers, each competitor's share, the count
 *  behind every grounded point and every concern. */
export function documentFigures(s: Signals, answers: ResearchAnswer[]): FigureTable {
  const f: FigureTable = {
    conversations: { label: 'conversations', value: fmtCount(s.run.conversations), kind: 'count' },
    videos: { label: 'videos', value: fmtCount(s.run.videos), kind: 'count' },
    client_videos: { label: `${s.company} videos`, value: fmtCount(s.run.clientVideos), kind: 'count' },
    competitor_videos: { label: 'competitor videos', value: fmtCount(s.run.competitorVideos), kind: 'count' },
  }
  if (s.run.positivePct != null) f.positive_pct = { label: 'positive share of judged conversations', value: fmtPct(s.run.positivePct), kind: 'pct' }
  if (s.run.clientSharePct != null) f.client_share_pct = { label: `${s.company} share of tracked conversation`, value: fmtPct(s.run.clientSharePct), kind: 'pct' }
  for (const c of s.competitors) if (c.shareNow != null) f[`${slug(c.name)}_share_pct`] = { label: `${c.name} share of tracked conversation`, value: fmtPct(c.shareNow), kind: 'pct' }
  if (s.delta?.sentiment) f.prev_positive_pct = { label: 'positive share in the previous update', value: fmtPct(s.delta.sentiment.prev), kind: 'pct' }
  if (s.delta?.conversations) f.prev_conversations = { label: 'conversations in the previous update', value: fmtCount(s.delta.conversations.prev), kind: 'count' }
  if (s.delta?.newThemes) f.new_themes = { label: 'themes new this update', value: fmtCount(s.delta.newThemes.count), kind: 'count' }
  // A count under three is not worth a number on paper ("one conversation
  // praise…" reads as thin as it is); the point still grounds, the writer
  // names the pattern instead of counting it.
  for (const a of answers) for (const p of a.grounded) if (p.conversationCount >= DOCUMENT_CITED_COUNT_MIN) f[`${p.id.toLowerCase()}_conversations`] = { label: 'conversations', value: fmtCount(p.conversationCount), kind: 'count' }
  for (const c of s.concerns) if (c.total >= DOCUMENT_CITED_COUNT_MIN) f[`${c.id.toLowerCase()}_conversations`] = { label: 'conversations', value: fmtCount(c.total), kind: 'count' }
  return f
}

/** The quote that leads a finding: from the grounded point the writer named,
 *  a comment before a transcript line, one that reads as English and fits a
 *  card, the longest of those. Text stays in memory until freeze. */
export function pickQuote(point: ResearchPoint | undefined, used: Set<string>): Quote | null {
  if (!point) return null
  const ok = point.quotes.filter((q) => !used.has(q.ref) && readsAsHeroQuote(q.text))
  const pick = [...ok].sort((a, b) => (b.commentId ? 1 : 0) - (a.commentId ? 1 : 0) || b.text.length - a.text.length)[0]
  if (!pick) return null
  used.add(pick.ref)
  return { ref: pick.ref, text: pick.text }
}

/** Where a finding was heard, written by code from the points and concerns
 *  it rests on: how many conversations across how many strands, which
 *  audiences, the history in words. */
export function heardMeta(args: { points: ResearchPoint[]; concerns: Signals['concerns'] }): { audiences: string[]; history: string; conversations: number; strands: number } {
  const buckets = new Set<string>()
  const words = new Set<string>()
  for (const c of args.concerns) {
    for (const b of c.buckets) buckets.add(b.bucket)
    if (c.trajectory) words.add(c.trajectory)
  }
  const w = [...words]
  const seen = w.map((x) => /seen (\d+)/.exec(x)?.[1]).filter(Boolean).map(Number)
  const history = w.find((x) => x.startsWith('new')) ?? w.find((x) => x === 'rising') ?? w.find((x) => x === 'fading') ?? (seen.length ? `seen ${Math.max(...seen)} updates running` : w[0] ?? '')
  return { audiences: [...buckets], history, conversations: args.points.reduce((n, p) => n + p.conversationCount, 0), strands: args.points.length }
}

export function heardLine(args: { points: ResearchPoint[]; concerns: Signals['concerns']; company: string }): string {
  const buckets = new Set<string>()
  const words = new Set<string>()
  for (const c of args.concerns) {
    for (const b of c.buckets) buckets.add(bucketWord(b.bucket, args.company))
    if (c.trajectory) words.add(c.trajectory)
  }
  const conversations = args.points.reduce((n, p) => n + p.conversationCount, 0)
  const strands = args.points.length
  const parts = [`${fmtCount(conversations)} ${conversations === 1 ? 'conversation' : 'conversations'} across ${strands} ${strands === 1 ? 'strand' : 'strands'} of the research`]
  if (buckets.size) parts.push(`heard from ${[...buckets].join(', ')}`)
  // One history word: new beats rising beats fading beats the longest run.
  const w = [...words]
  const seen = w.map((x) => /seen (\d+)/.exec(x)?.[1]).filter(Boolean).map(Number)
  const history = w.find((x) => x.startsWith('new')) ?? w.find((x) => x === 'rising') ?? w.find((x) => x === 'fading') ?? (seen.length ? `seen ${Math.max(...seen)} updates running` : w[0])
  if (history) parts.push(history)
  return `${parts.join(' · ')}.`
}

export interface ComposeArgs {
  template: DocumentTemplate
  settings: DocumentSettings
  reportId: string
  title: string
  period: string
  signals: Signals
  answers: ResearchAnswer[]
  written: WriterOutput
  figures: FigureTable
  model: string
  promptVersion: string
  costUsd: number
  timings: Record<string, number>
  /** The self-check's outcome, when it ran: a verdict per surviving finding
   *  headline and the findings it dropped (lib/reports/documents/check.ts). */
  check?: { verdicts: Record<string, 'echoes' | 'silent'>; dropped: { headline: string; reason: string }[] } | null
}

export function composeDocument(a: ComposeArgs): { data: DocumentSnapshotData; workings: DocumentWorkings } {
  const { signals: s, written: w, figures } = a
  const allow = allowedTokens(s, a.answers)
  const prose = (raw: string, figures: FigureTable, max: number) => singularise(scrubText(raw, figures, max, { allow }).text, figures)
  const line = (raw: string, figures: FigureTable, max: number, headline = false) => singularise(scrubLine(raw, figures, max, { headline, allow }).text, figures)
  const points = new Map<string, ResearchPoint>()
  for (const ans of a.answers) for (const p of ans.grounded) points.set(p.id, p)
  const concernById = new Map(s.concerns.map((c) => [c.id, c]))
  const known = new Set([...points.keys(), ...concernById.keys()])
  const thin = thinWeek(s)
  const pages: DocPage[] = []
  const blocksW: BlockWorkings[] = []
  const dropped: DocumentWorkings['dropped'] = [...(a.check?.dropped ?? [])]
  const notSure: string[] = []
  const usedQuotes = new Set<string>()

  // Findings: resolve, floor, order by evidence, cap.
  const perTemplate = Math.min(a.settings.findings, a.template.findingsMax)
  const findingsMax = thin ? Math.min(perTemplate, 3) : perTemplate
  const candidates = (w.findings ?? []).map((f) => {
    const { ok } = resolveIndices(f.based_on, known)
    const gs = ok.filter((i) => i.startsWith('G')).map((i) => points.get(i)!).filter(Boolean)
    const cs = ok.filter((i) => i.startsWith('S')).map((i) => concernById.get(i)!).filter(Boolean)
    const { sure, conversations } = calibrateSure(gs)
    return { f, ok, gs, cs, sure, conversations }
  })
  const kept = candidates.filter((c) => {
    const headline = line(c.f.headline, figures, cap('headline'), true)
    if (!headline) { dropped.push({ headline: c.f.headline, reason: 'no headline survived scrub' }); return false }
    if (c.gs.length === 0) { dropped.push({ headline, reason: 'rests on no grounded point' }); notSure.push(headline); return false }
    if (c.conversations < DOCUMENT_FINDING_MIN_CONVERSATIONS) { dropped.push({ headline, reason: `too thin: ${c.conversations} conversations` }); notSure.push(headline); return false }
    return true
  })
  kept.sort((x, y) => y.conversations - x.conversations || y.gs.length - x.gs.length)
  const findingPages: DocPage[] = kept.slice(0, findingsMax).map((c, i) => {
    const id = `f${i + 1}`
    const headline = line(c.f.headline, figures, cap('headline'), true)
    const quoteFrom = c.f.quote_from ? resolveIndices([c.f.quote_from], known).ok[0] : undefined
    const quote = pickQuote(quoteFrom ? points.get(quoteFrom) : c.gs[0], usedQuotes)
    const practice = (c.f.practice ?? []).map((x) => line(x, figures, cap('practice'))).filter(Boolean).slice(0, 2)
    const sureNote = prose(c.f.sure_note ?? '', figures, cap('sure'))
    const blocks: DocBlock[] = [
      { id: `${id}.headline`, field: 'headline', text: headline },
      { id: `${id}.saw`, field: 'saw', text: prose(c.f.saw, figures, cap('saw')), quote },
      { id: `${id}.heard`, field: 'heard', text: heardLine({ points: c.gs, concerns: c.cs, company: s.company }) },
      { id: `${id}.means`, field: 'means', text: prose(c.f.means, figures, cap('means')) },
      { id: `${id}.practice`, field: 'practice', text: '', items: practice },
      { id: `${id}.sure`, field: 'sure', text: `${SURE_WORDS[c.sure]}${sureNote ? ` ${sureNote}` : ''}` },
    ]
    const continued = c.f.continued_from?.trim() || null
    const check = a.check ? (a.check.verdicts[c.f.headline] ?? 'silent') : null
    for (const b of blocks) blocksW.push({ blockId: b.id, basedOn: c.ok, continuedFrom: continued, check })
    const heard = heardMeta({ points: c.gs, concerns: c.cs })
    return {
      id, kind: 'finding', title: PAGE_TITLE.finding, blocks,
      meta: { sure: c.sure, n: String(i + 1), audiences: heard.audiences.join(','), history: heard.history, conversations: String(heard.conversations), strands: String(heard.strands), ...(continued ? { continuedFrom: continued } : {}) },
    }
  })

  // The overview's own list: what is not settled, written and derived.
  const notSureYet = [...(w.not_sure_yet ?? []).map((x) => line(x, figures, cap('not_sure'))).filter(Boolean), ...notSure].slice(0, 6)

  // ── one builder per page kind; the skeleton decides which run ───────────
  // A builder returns the pages it has material for. Returning none is a
  // legitimate answer (no claims to answer, nothing to handle with care) and
  // the page simply does not exist in that issue.
  const build: Record<DocPageKind, () => DocPage[]> = {
    in_short: () => {
      const summary = prose(w.in_short?.summary ?? '', figures, cap('summary'))
      const blocks: DocBlock[] = [
        { id: 'in_short.summary', field: 'summary', text: summary },
        { id: 'in_short.findings', field: 'findings', text: '', items: findingPages.map((p) => p.blocks.find((b) => b.field === 'headline')?.text ?? '').filter(Boolean) },
        { id: 'in_short.not_sure', field: 'not_sure', text: '', items: notSureYet },
      ]
      for (const b of blocks) blocksW.push({ blockId: b.id, basedOn: [] })
      return [{ id: 'in_short', kind: 'in_short', title: PAGE_TITLE.in_short, blocks }]
    },

    finding: () => findingPages,

    // One page per included competitor, from the writer where it wrote one,
    // else from the signals.
    competitor: () => s.competitors.map((c) => {
      const id = `c_${slug(c.name)}`
      const wc = (w.competitors ?? []).find((x) => x.name.trim().toLowerCase() === c.name.toLowerCase())
      const { ok } = resolveIndices(wc?.based_on, known)
      const text = (field: 'pitch' | 'praise' | 'hurt' | 'read', fallback: string) => prose(wc?.[field] || fallback, figures, cap(field))
      const blocks: DocBlock[] = [
        { id: `${id}.pitch`, field: 'pitch', text: text('pitch', c.claims.length ? c.claims.slice(0, 4).map((cl) => cl.claim).join(' ') : 'Nothing from their own videos was captured this update.') },
        { id: `${id}.praise`, field: 'praise', text: text('praise', c.praise.length ? c.praise.slice(0, 4).map((t) => `${t.label}: ${t.description}`).join(' ') : 'Nothing their users praised was captured this update.') },
        { id: `${id}.hurt`, field: 'hurt', text: text('hurt', c.hurt.length ? c.hurt.slice(0, 4).map((t) => `${t.label}: ${t.description}`).join(' ') : 'Nothing their users complained about was captured this update.') },
        { id: `${id}.read`, field: 'read', text: text('read', '') },
      ]
      for (const b of blocks) blocksW.push({ blockId: b.id, basedOn: ok })
      return { id, kind: 'competitor' as const, title: PAGE_TITLE.competitor, blocks, meta: { name: c.name, thin: String(c.thin) } }
    }),

    // Where the company stands: the writer's read, printed beside a table the
    // deck draws from the figures and the delta. One page, always, because a
    // leadership brief that cannot say where the company sits has failed.
    standing: () => {
      const block: DocBlock = { id: 'standing.standing', field: 'standing', text: prose(w.standing ?? '', figures, cap('standing')) }
      blocksW.push({ blockId: block.id, basedOn: [] })
      const parties = [s.company, ...s.competitors.map((c) => c.name)]
      return [{
        id: 'standing', kind: 'standing', title: PAGE_TITLE.standing, blocks: [block],
        // The deck draws the bars from the figures; the names and their order
        // are the composer's, because a figure key is a slug and a name is not
        // recoverable from it. The concerns are the FIELD this update, which
        // the three findings deliberately do not cover: a director is asking
        // what the conversation is about, not only what was worth writing up.
        meta: {
          parties: parties.join('|'),
          concerns: s.concerns.slice(0, 5).map((c) => [c.label, String(c.total), c.trajectory || ''].join('~')).join('|'),
        },
      }]
    },

    // What the company claims against what comes back. One block per claim
    // the writer answered, the claim matched back to the pipeline's own
    // say-vs-hear entry so the page cannot print a claim nobody made.
    say_hear: () => {
      const entries = s.sayVsHear
      if (!entries.length) return []
      const blocks: DocBlock[] = []
      for (const written of (w.say_hear ?? []).slice(0, 4)) {
        const claim = written.claim?.trim()
        if (!claim) continue
        const entry = entries.find((e) => e.you_say.trim().toLowerCase() === claim.toLowerCase())
          ?? entries.find((e) => e.you_say.toLowerCase().includes(claim.toLowerCase()) || claim.toLowerCase().includes(e.you_say.toLowerCase()))
        if (!entry) continue
        const read = prose(written.read ?? '', figures, cap('gap'))
        if (!read) continue
        const { ok } = resolveIndices(written.based_on, known)
        // The index keeps the id unique: two claims that open with the same
        // forty characters would otherwise collide, and the second would be
        // dropped without a word. The index is the entry's, not the loop's,
        // so an edit keys to the same block if the writer reorders them.
        const id = `sh${entries.indexOf(entry) + 1}_${slug(entry.you_say).slice(0, 36)}`
        if (blocks.some((b) => b.id === id)) continue
        blocks.push({
          // The claim is PRINTED IN QUOTATION MARKS, so it is scrubbed but not
          // shortened: a claim cut at a character count is a misquote of the
          // company. Its length is the pipeline's to bound, not this page's.
          id, field: 'gap', label: scrubLine(entry.you_say, figures, entry.you_say.length + 1, { allow }).text || entry.you_say,
          text: read,
          // Positional, like a persona card: [0] the pipeline's own verdict
          // word (echoes | contradicts | silent), [1] what the audience says
          // back, [2] the gap it named. Never filtered, so a missing middle
          // does not shift the gap into its place.
          items: [entry.audience, entry.they_say ?? '', entry.gap].map((x) => scrubText(x, figures, 300, { allow }).text),
        })
        blocksW.push({ blockId: id, basedOn: ok })
      }
      // Two a page, like personas. A claim is the company's own sentence and
      // is printed whole; four of them on one sheet ran off the bottom, and a
      // claim cut to fit is a misquote (found by rendering, 2026-09-02).
      const out: DocPage[] = []
      for (let i = 0; i < blocks.length; i += CLAIMS_PER_PAGE) {
        const n = Math.floor(i / CLAIMS_PER_PAGE) + 1
        out.push({ id: `say_hear_${n}`, kind: 'say_hear', title: PAGE_TITLE.say_hear, blocks: blocks.slice(i, i + CLAIMS_PER_PAGE) })
      }
      return out
    },

    // The questions the conversation puts and nobody settles.
    asked: () => {
      const items = (w.asked ?? []).map((x) => line(x, figures, cap('asked'))).filter(Boolean).slice(0, ASKED_MAX)
      if (!items.length) return []
      blocksW.push({ blockId: 'asked.asked', basedOn: [] })
      return [{ id: 'asked', kind: 'asked' as const, title: PAGE_TITLE.asked, blocks: [{ id: 'asked.asked', field: 'asked' as const, text: '', items }] }]
    },

    // Who is in the conversation: the profile's own words in full, two a
    // page, and the writer's line on what each means for this reader.
    personas: () => {
      const personaBlocks: DocBlock[] = s.personas.slice(0, 6).map((p) => {
        const wl = (w.persona_lines ?? []).find((x) => x.name.trim().toLowerCase() === p.name.toLowerCase())
        return {
          id: `p_${slug(p.key || p.name)}`,
          field: 'persona' as const,
          label: p.name,
          text: prose(wl?.line ?? '', figures, cap('persona')),
          items: [p.oneLiner, p.wants, p.blockers, p.triggers].map((x) => scrubText(x, figures, 300, { allow }).text),
        }
      })
      for (const b of personaBlocks) blocksW.push({ blockId: b.id, basedOn: [] })
      const out: DocPage[] = []
      for (let i = 0; i < personaBlocks.length; i += PERSONAS_PER_PAGE) {
        const n = Math.floor(i / PERSONAS_PER_PAGE) + 1
        out.push({ id: `personas_${n}`, kind: 'personas', title: PAGE_TITLE.personas, blocks: personaBlocks.slice(i, i + PERSONAS_PER_PAGE) })
      }
      return out
    },

    language: () => {
      const care = (w.care ?? []).map((x) => line(x, figures, cap('care'))).filter(Boolean).slice(0, 6)
      if (!care.length) return []
      blocksW.push({ blockId: 'language.care', basedOn: [] })
      return [{ id: 'language', kind: 'language' as const, title: PAGE_TITLE.language, blocks: [{ id: 'language.care', field: 'care' as const, text: '', items: care }] }]
    },

    method: () => {
      blocksW.push({ blockId: 'method.method', basedOn: [] })
      return [{ id: 'method', kind: 'method' as const, title: PAGE_TITLE.method, blocks: [{ id: 'method.method', field: 'method' as const, text: '', items: methodItems(s, a.period, thin, s.updatesCount, a.template.skeleton.map((p) => p.kind)) }] }]
    },
  }

  // The walk. A kind that repeats is emitted once by its builder, which
  // returns every page of that kind; a kind listed twice is built once.
  const done = new Set<DocPageKind>()
  for (const page of a.template.skeleton) {
    if (done.has(page.kind)) continue
    done.add(page.kind)
    pages.push(...build[page.kind]())
  }

  const data: DocumentSnapshotData = {
    version: 1,
    kind: 'document',
    template: a.template.key,
    reportId: a.reportId,
    title: a.title,
    audience: a.template.audience,
    company: s.company,
    period: a.period,
    runId: s.runId,
    figures,
    delta: s.delta,
    pages,
    lens: { means: a.template.lens.means, short: a.template.lens.short },
    method: {
      conversations: s.run.conversations,
      videos: s.run.videos,
      clientVideos: s.run.clientVideos,
      competitorVideos: s.run.competitorVideos,
      period: a.period,
      sources: sourcesOf(s),
      heldBack: s.heldBackPhrases,
      thin,
    },
    notSureYet,
    generatedAt: new Date().toISOString(),
    model: a.model,
    promptVersion: a.promptVersion,
  }
  const workings: DocumentWorkings = {
    version: 1,
    questions: a.answers.map((ans) => ({ id: ans.question.id, text: ans.question.text, purpose: ans.question.purpose, outcome: ans.outcome === 'failed' || ans.outcome === 'unasked' ? 'silent' : ans.outcome, conversationCount: ans.conversationCount, costUsd: ans.costUsd })),
    points: [...points.values()].map((p) => ({ id: p.id, text: p.text, insightIds: p.insightIds, conversationCount: p.conversationCount, themeLabels: p.themeLabels, quotes: p.quotes.slice(0, 3).map((q) => ({ ref: q.ref, text: q.text })), questionId: p.questionId })),
    blocks: blocksW,
    concerns: s.concerns.map((c) => ({ label: c.label, buckets: c.buckets.map((b) => ({ bucket: b.bucket, label: b.label, evidenceCount: b.evidenceCount })), total: c.total, trajectory: c.trajectory })),
    dropped,
    heldBack: s.heldBackPhrases,
    costUsd: a.costUsd,
    timings: a.timings,
  }
  return { data, workings }
}

/** The platforms the update's phrases came from: the honest list of what was read. */
function sourcesOf(s: Signals): string[] {
  const platforms = new Set<string>()
  for (const p of s.phrases) if (p.platform) platforms.add(p.platform)
  return [...platforms].sort()
}

const PLATFORM_NAME: Record<string, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', reddit: 'Reddit' }

/** The report's basis, in code: what was read, how findings are ordered,
 *  how confidence is judged, what was held back. Not evidence per line; the
 *  page a professional report ends on. */
export function methodItems(s: Signals, period: string, thin: boolean, updatesCount: number, kinds: DocPageKind[] = ['competitor', 'personas']): string[] {
  const sources = sourcesOf(s).map((p) => PLATFORM_NAME[p] ?? p)
  const competitors = s.competitors.map((c) => c.name)
  const has = (k: DocPageKind) => kinds.includes(k)
  // The third paragraph explains the pages this brief ACTUALLY has. It used
  // to describe competitor pages and personas unconditionally, which on a
  // leadership brief (neither) was a method note for a different document.
  const wherePagesComeFrom = [
    has('competitor') ? "Competitor pages read each competitor's own videos for what it pitches and its audience's comments for praise and complaint." : '',
    has('standing') ? 'Standing is measured as share of the tracked video conversation, and movement is called only where the numbers can carry it.' : '',
    has('say_hear') ? "The claims page sets what the company says in its own videos against what the tracked conversation does with it; a claim it does not take up is recorded as not taken up, never answered on its behalf." : '',
    has('personas') ? 'Personas come from the consumer profile, which groups the whole conversation by who is speaking and where they are in the journey.' : '',
    has('asked') ? 'The questions page carries what the conversation asks and does not settle, in the wording the audience uses.' : '',
  ].filter(Boolean).join(' ')
  return [
    `This brief is written from public conversation around ${s.company}, ${competitors.length ? `${competitors.join(', ')} ` : ''}and the wider category: ${fmtCount(s.run.conversations)} conversations on ${fmtCount(s.run.videos)} videos in the ${period.replace(/^Update/, 'update')}${sources.length ? `, on ${sources.join(', ')}` : ''}. A conversation is one comment or spoken line the analysis cited; the analysis reads what people said in public, not sales calls or surveys.`,
    `Findings are the researcher's readings of that conversation, ordered by the evidence behind them. Each rests on grounded points the analysis extracted and verified; confidence is judged from how many conversations and how many independent strands support the reading (solid, reasonable or thin), never by the writer.${thin ? ' This update was thin, so fewer findings were written rather than stretch the evidence.' : ''}`,
    `${wherePagesComeFrom}${wherePagesComeFrom && s.heldBackPhrases ? ' ' : ''}${s.heldBackPhrases ? `${fmtCount(s.heldBackPhrases)} phrases in other languages were read for the counts but not quoted.` : ''}`,
    updatesCount > 1
      ? `This is update ${updatesCount} for ${s.company}. Where a finding carries from the previous brief it says so; "new this update" means the theme was first seen now. Movement is called only after three updates.`
      : `This is the first update for ${s.company}; there is nothing yet to compare with.`,
  ].filter(Boolean)
}

/** One slide per page, plus the cover. Pagination decided here, never by the browser. */
export function documentSlides(data: DocumentSnapshotData): Slide[] {
  return data.pages.map((p) => ({ title: p.title, keys: [p.id], layout: 'single' as const }))
}
