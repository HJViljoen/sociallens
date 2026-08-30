import { DOCUMENT_BLOCK_MAX, DOCUMENT_FINDING_MIN_CONVERSATIONS, DOCUMENT_THIN_CONVERSATIONS } from '../../config'
import { readsAsHeroQuote } from '../../quotes'
import type { Quote, Slide } from '../../renderables/types'
import type { FigureTable } from '../types'
import type { Signals } from './signals'
import type { ResearchAnswer, ResearchPoint } from './research'
import { PAGE_TITLE, type DocumentTemplate } from './templates'
import type { WriterOutput } from './write'
import { slug } from './write'
import { SURE_WORDS, calibrateSure, resolveIndices, scrubLine, scrubText, singularise } from './scrub'
import type { BlockWorkings, DocBlock, DocPage, DocumentSettings, DocumentSnapshotData, DocumentWorkings } from './types'

/**
 * From the writer's output and the signals to the frozen document (pure).
 * Code owns what code can own: the figure table and every number, the order
 * of the findings (by the evidence behind them), how sure we are, which
 * quote leads a finding, the finding floor and the thin-week rule, the page
 * count. The model owns the words inside the blocks, and only after scrub.
 */

const cap = (field: string) => DOCUMENT_BLOCK_MAX[field] ?? 400
const prose = (raw: string, figures: FigureTable, max: number) => singularise(scrubText(raw, figures, max).text, figures)
const fmtCount = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n))
const fmtPct = (n: number) => `${Math.round(n * 10) / 10}%`

export function thinWeek(s: Pick<Signals, 'runStatus' | 'run'>): boolean {
  return s.runStatus === 'partial' || s.run.conversations < DOCUMENT_THIN_CONVERSATIONS
}

/** Every figure the writer may cite, computed in code from the signals and
 *  the research: the update's numbers, each competitor's share, the count
 *  behind every grounded point and every concern. */
export function documentFigures(s: Signals, answers: ResearchAnswer[]): FigureTable {
  const f: FigureTable = {
    conversations: { label: 'conversations this update', value: fmtCount(s.run.conversations), kind: 'count' },
    videos: { label: 'videos this update', value: fmtCount(s.run.videos), kind: 'count' },
    client_videos: { label: `${s.company} videos this update`, value: fmtCount(s.run.clientVideos), kind: 'count' },
    competitor_videos: { label: 'competitor videos this update', value: fmtCount(s.run.competitorVideos), kind: 'count' },
  }
  if (s.run.positivePct != null) f.positive_pct = { label: 'positive share of judged conversations', value: fmtPct(s.run.positivePct), kind: 'pct' }
  if (s.run.clientSharePct != null) f.client_share_pct = { label: `${s.company} share of tracked conversation`, value: fmtPct(s.run.clientSharePct), kind: 'pct' }
  for (const c of s.competitors) if (c.shareNow != null) f[`${slug(c.name)}_share_pct`] = { label: `${c.name} share of tracked conversation`, value: fmtPct(c.shareNow), kind: 'pct' }
  if (s.delta?.sentiment) f.prev_positive_pct = { label: 'positive share in the previous update', value: fmtPct(s.delta.sentiment.prev), kind: 'pct' }
  if (s.delta?.conversations) f.prev_conversations = { label: 'conversations in the previous update', value: fmtCount(s.delta.conversations.prev), kind: 'count' }
  if (s.delta?.newThemes) f.new_themes = { label: 'themes new this update', value: fmtCount(s.delta.newThemes.count), kind: 'count' }
  for (const a of answers) for (const p of a.grounded) f[`${p.id.toLowerCase()}_conversations`] = { label: 'conversations', value: fmtCount(p.conversationCount), kind: 'count' }
  for (const c of s.concerns) f[`${c.id.toLowerCase()}_conversations`] = { label: 'conversations', value: fmtCount(c.total), kind: 'count' }
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
}

export function composeDocument(a: ComposeArgs): { data: DocumentSnapshotData; workings: DocumentWorkings } {
  const { signals: s, written: w, figures } = a
  const points = new Map<string, ResearchPoint>()
  for (const ans of a.answers) for (const p of ans.grounded) points.set(p.id, p)
  const known = new Set([...points.keys(), ...s.concerns.map((c) => c.id)])
  const thin = thinWeek(s)
  const pages: DocPage[] = []
  const blocksW: BlockWorkings[] = []
  const dropped: DocumentWorkings['dropped'] = []
  const notSure: string[] = []
  const usedQuotes = new Set<string>()

  // In short.
  const summary = prose(w.in_short?.summary ?? '', figures, cap('summary'))
  pages.push({ id: 'in_short', kind: 'in_short', title: PAGE_TITLE.in_short, blocks: [{ id: 'in_short.summary', field: 'summary', text: summary }] })
  blocksW.push({ blockId: 'in_short.summary', basedOn: [] })

  // Findings: resolve, floor, order by evidence, cap.
  const findingsMax = thin ? Math.min(a.settings.findings, 3) : a.settings.findings
  const candidates = (w.findings ?? []).map((f) => {
    const { ok } = resolveIndices(f.based_on, known)
    const gs = ok.filter((i) => i.startsWith('G')).map((i) => points.get(i)!).filter(Boolean)
    const { sure, conversations } = calibrateSure(gs)
    return { f, ok, gs, sure, conversations }
  })
  const kept = candidates.filter((c) => {
    const headline = scrubLine(c.f.headline, figures, cap('headline'), { headline: true }).text
    if (!headline) { dropped.push({ headline: c.f.headline, reason: 'no headline survived scrub' }); return false }
    if (c.gs.length === 0) { dropped.push({ headline, reason: 'rests on no grounded point' }); notSure.push(headline); return false }
    if (c.conversations < DOCUMENT_FINDING_MIN_CONVERSATIONS) { dropped.push({ headline, reason: `too thin: ${c.conversations} conversations` }); notSure.push(headline); return false }
    return true
  })
  kept.sort((x, y) => y.conversations - x.conversations || y.gs.length - x.gs.length)
  kept.slice(0, findingsMax).forEach((c, i) => {
    const id = `f${i + 1}`
    const headline = scrubLine(c.f.headline, figures, cap('headline'), { headline: true }).text
    const quoteFrom = c.f.quote_from ? resolveIndices([c.f.quote_from], known).ok[0] : undefined
    const quote = pickQuote(quoteFrom ? points.get(quoteFrom) : c.gs[0], usedQuotes)
    const say = (c.f.say ?? []).map((line) => singularise(scrubLine(line, figures, cap('say')).text, figures)).filter(Boolean).slice(0, 4)
    const sureNote = prose(c.f.sure_note ?? '', figures, cap('sure'))
    const blocks: DocBlock[] = [
      { id: `${id}.headline`, field: 'headline', text: headline },
      { id: `${id}.saw`, field: 'saw', text: prose(c.f.saw, figures, cap('saw')), quote },
      { id: `${id}.means`, field: 'means', text: prose(c.f.means, figures, cap('means')) },
      { id: `${id}.say`, field: 'say', text: '', items: say },
      { id: `${id}.sure`, field: 'sure', text: `${SURE_WORDS[c.sure]}${sureNote ? ` ${sureNote}` : ''}` },
    ]
    const continued = c.f.continued_from?.trim() || null
    pages.push({ id, kind: 'finding', title: PAGE_TITLE.finding, blocks, meta: { sure: c.sure, ...(continued ? { continuedFrom: continued } : {}) } })
    for (const b of blocks) blocksW.push({ blockId: b.id, basedOn: c.ok, continuedFrom: continued })
  })

  // Competitors: one page each, from the writer where it wrote one, else from the signals.
  for (const c of s.competitors) {
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
    pages.push({ id, kind: 'competitor', title: PAGE_TITLE.competitor, blocks, meta: { name: c.name, thin: String(c.thin) } })
    for (const b of blocks) blocksW.push({ blockId: b.id, basedOn: ok })
  }

  // Personas: the profile's own words plus the writer's line each.
  if (s.personas.length) {
    const blocks: DocBlock[] = s.personas.slice(0, 5).map((p) => {
      const wl = (w.persona_lines ?? []).find((x) => x.name.trim().toLowerCase() === p.name.toLowerCase())
      return {
        id: `p_${slug(p.key || p.name)}.line`,
        field: 'line' as const,
        label: p.name,
        text: scrubText(wl?.line ?? '', figures, cap('line')).text,
        items: [p.oneLiner, p.wants, p.blockers, p.triggers].map((x) => scrubText(x, figures, 400).text),
      }
    })
    pages.push({ id: 'personas', kind: 'personas', title: PAGE_TITLE.personas, blocks })
    for (const b of blocks) blocksW.push({ blockId: b.id, basedOn: [] })
  }

  // Language: phrases as quotes (code), care lines (writer, scrubbed).
  const care = (w.care ?? []).map((x) => scrubLine(x, figures, 220).text).filter(Boolean).slice(0, 5)
  pages.push({
    id: 'language', kind: 'language', title: PAGE_TITLE.language,
    blocks: [
      { id: 'language.borrow', field: 'borrow', text: '', quotes: s.phrases.slice(0, 10).map((p) => p.quote) },
      { id: 'language.care', field: 'care', text: '', items: care },
    ],
  })
  blocksW.push({ blockId: 'language.borrow', basedOn: [] }, { blockId: 'language.care', basedOn: [] })

  const notSureYet = [...(w.not_sure_yet ?? []).map((x) => scrubLine(x, figures, cap('not_sure')).text).filter(Boolean), ...notSure].slice(0, 6)

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

/** One slide per page, plus the cover. Pagination decided here, never by the browser. */
export function documentSlides(data: DocumentSnapshotData): Slide[] {
  return data.pages.map((p) => ({ title: p.title, keys: [p.id], layout: 'single' as const }))
}
