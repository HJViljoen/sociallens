import { Fragment, type ReactNode } from 'react'
import { BlockSlot } from './block-slot'
import { DeckFooter } from '@/components/print/report-deck'
import { Slide } from '@/components/print/slide'
import { substituteFigures } from '@/lib/reports/cover'
import { documentSlides } from '@/lib/reports/documents/compose'
import { findingHeadlines, overviewTiles, slugOf } from '@/lib/reports/documents/overview'
import type { DocBlock, DocLens, DocPage, DocumentSnapshotData } from '@/lib/reports/documents/types'
import type { FigureTable } from '@/lib/reports/types'

// A document's deck from its (hydrated) snapshot data: the cover, then one
// slide per skeleton page, numbered once across the document. The same
// chrome as a report's pages (Heinrich, 2026-08-30): the page's name top
// right, "Created by {company} with Verbatim" and the date at the foot. No
// evidence on paper: the workings never reach this component.
//
// The pages (T6, 2026-08-31, second pass after Heinrich's read): a research
// report composed to fill a landscape sheet. Type at 15–17px on the 1168px
// body (about 11pt on paper), structured blocks with hairlines, pills for
// audiences, bars for shares, a tinted inner block for the pull quote.
// NO blurred shadow on paper: Chrome prints a box-shadow as a bitmap that
// some PDF viewers draw as a grey slab (Heinrich's screenshots, 2026-08-30).
// Depth on paper is the hairline; the ambient shadow stays on screen.

const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const fmtCount = (n: number) => new Intl.NumberFormat('en-US').format(n)
const PLATFORM: Record<string, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', reddit: 'Reddit' }

const CARD = 'rounded-lg border border-border bg-tile'
const BODY = 'text-[15.5px] leading-[1.55] text-foreground'
const BODY_SM = 'text-[14px] leading-[1.5] text-foreground'

export function Figured({ text, figures }: { text: string; figures: FigureTable }) {
  return (
    <>
      {substituteFigures(text, figures).map((p, i) =>
        'text' in p ? <Fragment key={i}>{p.text}</Fragment> : <span key={i} className="font-mono tabular-nums text-foreground">{p.figure}</span>,
      )}
    </>
  )
}

function Paragraphs({ text, figures, className }: { text: string; figures: FigureTable; className: string }) {
  return (
    <>
      {text.split(/\n\n+/).filter(Boolean).map((p, i) => <p key={i} className={className}><Figured text={p} figures={figures} /></p>)}
    </>
  )
}

/** An eyebrow: mono, uppercase, with a short rule in the accent. */
function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground ${className}`}>
      <span className="inline-block h-[2px] w-4 rounded-full bg-primary" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function Pill({ tone, children }: { tone: 'you' | 'comp' | 'cat' | 'new' | 'plain'; children: ReactNode }) {
  const cls =
    tone === 'you' ? 'bg-accent text-accent-foreground'
    : tone === 'comp' ? 'bg-comp/15 text-foreground'
    : tone === 'new' ? 'bg-warning/20 text-foreground'
    : tone === 'plain' ? 'border border-border text-secondary-foreground'
    : 'bg-inner text-secondary-foreground'
  return <span className={`inline-flex items-center rounded-full px-2.5 py-[3px] font-mono text-[11px] leading-none ${cls}`}>{children}</span>
}

function audiencePills(audiences: string, company: string) {
  return audiences.split(',').filter(Boolean).map((b) => {
    if (b === 'client') return <Pill key={b} tone="you">{company}&rsquo;s audience</Pill>
    if (b === 'industry-other') return <Pill key={b} tone="cat">the category</Pill>
    if (b.startsWith('competitor:')) return <Pill key={b} tone="comp">{b.slice('competitor:'.length)}&rsquo;s audience</Pill>
    return null
  })
}

function DocumentCover({ data, pages }: { data: DocumentSnapshotData; pages: number }) {
  const sections = new Set(data.pages.map((p) => p.kind)).size
  return (
    <section className="vb-slide">
      <div className="vb-slide-body">
        <div className="flex h-full flex-col justify-center gap-8 px-[6%]">
          <span className="inline-block h-[3px] w-14 rounded-full bg-primary" aria-hidden />
          <h1 className="max-w-[16ch] text-[58px] font-semibold leading-[1.05] tracking-[-0.025em] text-foreground [text-wrap:balance]">{data.title}</h1>
          <p className="font-mono text-[13px] text-muted-foreground">
            {sections} {sections === 1 ? 'section' : 'sections'} · {pages} {pages === 1 ? 'page' : 'pages'}
          </p>
        </div>
      </div>
    </section>
  )
}

// ── overview ───────────────────────────────────────────────────────────────

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className={`${CARD} px-5 py-4`}>
      <p className="font-mono text-[38px] font-medium leading-none tracking-[-0.02em] tabular-nums text-foreground">{value}</p>
      <p className="mt-2 text-[12.5px] leading-[1.35] text-muted-foreground">{label}</p>
    </div>
  )
}

function OverviewPage({ page, data }: { page: DocPage; data: DocumentSnapshotData }) {
  const f = data.figures
  const summary = page.blocks.find((b) => b.field === 'summary')
  // The numbers and the headlines are derived in
  // lib/reports/documents/overview.ts — the email reads the same functions, so
  // the paper and the email cannot drift. (The not-settled list stays local:
  // it is the page's own block, and the email does not carry it.)
  const findings = findingHeadlines(data)
  const notSureBlock = page.blocks.find((b) => b.field === 'not_sure')
  const notSure = notSureBlock?.items ?? []
  const tiles = overviewTiles(data)
  return (
    <div className="grid h-full min-h-0 grid-cols-[7fr_5fr] gap-x-12">
      <div className="flex min-h-0 flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Eyebrow>In short</Eyebrow>
          {summary?.text && <BlockSlot block={summary} textClass="max-w-[66ch] text-[17px] leading-[1.55] text-foreground"><Paragraphs text={summary.text} figures={f} className="max-w-[66ch] text-[17px] leading-[1.55] text-foreground" /></BlockSlot>}
        </div>
        {findings.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <Eyebrow>Findings in this brief</Eyebrow>
            <ol className="flex flex-col gap-2">
              {findings.map((h, i) => (
                <li key={i} className="flex items-baseline gap-4 text-[16px] leading-[1.4] text-foreground">
                  <span className="w-6 shrink-0 font-mono text-[13px] tabular-nums text-primary">{i + 1}</span>
                  <span className="font-medium"><Figured text={h} figures={f} /></span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-col gap-4">
        <div className="flex flex-col gap-3">{tiles.map((t, i) => <StatTile key={i} value={t.value} label={t.label} />)}</div>
        {notSure.length > 0 && (
          <div className="rounded-lg bg-inner px-5 py-4">
            <Eyebrow className="mb-2">Not settled this update</Eyebrow>
            <BlockSlot block={notSureBlock!} textClass="text-[13px] leading-[1.45] text-secondary-foreground">
              <ul className="flex flex-col gap-1.5">
                {notSure.slice(0, 3).map((x, i) => <li key={i} className="text-[13px] leading-[1.45] text-secondary-foreground">{x}</li>)}
              </ul>
            </BlockSlot>
          </div>
        )}
      </div>
    </div>
  )
}

// ── finding ────────────────────────────────────────────────────────────────

function ConfidenceDots({ sure }: { sure: string }) {
  const n = sure === 'solid' ? 3 : sure === 'reasonable' ? 2 : 1
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {[0, 1, 2].map((i) => <span key={i} className={`inline-block h-[9px] w-[9px] rounded-full ${i < n ? 'bg-primary' : 'bg-neutral-seg'}`} />)}
    </span>
  )
}

function FindingPage({ page, figures, company, lens }: { page: DocPage; figures: FigureTable; company: string; lens: DocLens }) {
  const b = (field: string) => page.blocks.find((x) => x.field === field)
  const headline = b('headline')
  const saw = b('saw')
  const means = b('means')
  const practiceBlock = b('practice')
  const practice = practiceBlock?.items ?? []
  const sureWord = page.meta?.sure ?? 'thin'
  const sureNote = (b('sure')?.text ?? '').replace(/^(Solid|Reasonable|Thin):[^.]*\.\s*(Treat it as a lead, not a rule\.\s*)?/, '')
  const history = page.meta?.history ?? ''
  const conversations = Number(page.meta?.conversations ?? 0)
  const strands = Number(page.meta?.strands ?? 0)
  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="flex items-end justify-between gap-8">
        {headline && <BlockSlot block={headline} textClass="max-w-[30ch] text-[32px] font-semibold leading-[1.12] tracking-[-0.02em] text-foreground"><h2 className="max-w-[30ch] text-[32px] font-semibold leading-[1.12] tracking-[-0.02em] text-foreground [text-wrap:balance]"><Figured text={headline.text} figures={figures} /></h2></BlockSlot>}
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5 pb-1">
          {audiencePills(page.meta?.audiences ?? '', company)}
          {history && <Pill tone={history.startsWith('new') ? 'new' : 'plain'}>{history}</Pill>}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[7fr_5fr] gap-x-12">
        <div className="flex min-h-0 flex-col gap-3">
          <Eyebrow>What the conversation shows</Eyebrow>
          {saw?.text && <BlockSlot block={saw} textClass={`max-w-[70ch] ${BODY}`}><Paragraphs text={saw.text} figures={figures} className={`max-w-[70ch] ${BODY}`} /></BlockSlot>}
          {saw?.quote?.text && (
            <blockquote className="mt-1 max-w-[66ch] rounded-lg bg-inner px-5 py-3.5 font-serif text-[15px] italic leading-[1.5] text-secondary-foreground">“{saw.quote.text}”</blockquote>
          )}
        </div>
        <div className={`${CARD} flex min-h-0 flex-col gap-4 px-6 py-5`}>
          <p className="font-mono text-[12px] text-muted-foreground">
            <span className="text-foreground">{fmtCount(conversations)}</span> conversations · <span className="text-foreground">{strands}</span> strands of the research
          </p>
          {means?.text && (
            <div className="flex flex-col gap-2">
              <Eyebrow>{lens.means}</Eyebrow>
              <BlockSlot block={means} textClass={BODY_SM}><Paragraphs text={means.text} figures={figures} className={BODY_SM} /></BlockSlot>
            </div>
          )}
          {practice.length > 0 && (
            <div className="flex flex-col gap-2">
              <Eyebrow>In practice</Eyebrow>
              <BlockSlot block={practiceBlock!} textClass={BODY_SM}>
                <ul className="flex flex-col gap-1.5">
                  {practice.map((x, i) => (
                    <li key={i} className={`flex gap-3 ${BODY_SM}`}>
                      <span className="mt-[9px] inline-block h-[6px] w-[6px] shrink-0 rounded-full bg-primary" aria-hidden />
                      <span><Figured text={x} figures={figures} /></span>
                    </li>
                  ))}
                </ul>
              </BlockSlot>
            </div>
          )}
          <div className="mt-auto flex flex-col gap-1.5 border-t border-border pt-3">
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              Confidence <ConfidenceDots sure={sureWord} /> <span className="normal-case tracking-normal text-foreground">{sureWord}</span>
            </p>
            {sureNote && <p className="text-[12.5px] leading-[1.45] text-muted-foreground">{sureNote}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── competitor ─────────────────────────────────────────────────────────────

function ShareStrip({ data, name }: { data: DocumentSnapshotData; name: string }) {
  const f = data.figures
  const key = `${slugOf(name)}_share_pct`
  const you = f.client_share_pct ? parseFloat(f.client_share_pct.value) : null
  const them = f[key] ? parseFloat(f[key].value) : null
  if (you == null || them == null || Number.isNaN(you) || Number.isNaN(them)) return null
  const max = Math.max(you, them, 1)
  const row = (label: string, pct: number, cls: string) => (
    <div className="flex items-center gap-3">
      <span className="w-[92px] shrink-0 truncate text-[13px] text-foreground">{label}</span>
      <span className="h-[10px] flex-1"><span className={`block h-full rounded-[3px] ${cls}`} style={{ width: `${Math.max(2, (pct / max) * 100)}%` }} /></span>
      <span className="w-[52px] text-right font-mono text-[13px] tabular-nums text-foreground">{pct}%</span>
    </div>
  )
  return (
    <div className={`${CARD} w-[400px] shrink-0 px-5 py-4`}>
      <Eyebrow className="mb-2.5">Share of tracked conversation this update</Eyebrow>
      <div className="flex flex-col gap-2">
        {row(data.company, you, 'bg-you')}
        {row(name, them, 'bg-comp')}
      </div>
    </div>
  )
}

function CompetitorPage({ page, figures, data }: { page: DocPage; figures: FigureTable; data: DocumentSnapshotData }) {
  const b = (field: string) => page.blocks.find((x) => x.field === field)
  const name = page.meta?.name ?? page.title
  const cols: [string, DocBlock | undefined][] = [['What they are pitching', b('pitch')], ['What their users praise', b('praise')], ['Where their users hurt', b('hurt')]]
  const read = b('read')
  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="flex items-start justify-between gap-8">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-foreground">{name}</h2>
          <p className="text-[14px] text-muted-foreground">As their own videos and their audience tell it this update{page.meta?.thin === 'true' ? ', on few videos, read with care' : ''}.</p>
        </div>
        <ShareStrip data={data} name={name} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-x-6">
        {cols.map(([label, block]) => (
          <div key={label} className={`${CARD} flex flex-col gap-2.5 px-5 py-4`}>
            <Eyebrow>{label}</Eyebrow>
            {block?.text && <BlockSlot block={block} textClass={BODY_SM}><Paragraphs text={block.text} figures={figures} className={BODY_SM} /></BlockSlot>}
          </div>
        ))}
      </div>
      {read?.text && (
        <div className="rounded-lg bg-inner px-6 py-4">
          <Eyebrow className="mb-1.5">When {name} comes up</Eyebrow>
          <BlockSlot block={read} textClass={`max-w-[100ch] ${BODY}`}><Paragraphs text={read.text} figures={figures} className={`max-w-[100ch] ${BODY}`} /></BlockSlot>
        </div>
      )}
    </div>
  )
}

// ── standing ───────────────────────────────────────────────────────────────
// The leadership brief's one page of position: the writer's read on the left,
// and on the right the shares as bars and what actually moved, both drawn by
// code from the frozen figures and delta. The verdicts are the pipeline's own
// (T0-8): a change the data cannot carry prints as "about where it was", not
// as a number.

function StandingBars({ data, parties }: { data: DocumentSnapshotData; parties: string[] }) {
  const f = data.figures
  const rows = parties
    .map((name, i) => {
      const key = i === 0 ? 'client_share_pct' : `${slugOf(name)}_share_pct`
      const pct = f[key] ? parseFloat(f[key].value) : NaN
      return Number.isNaN(pct) ? null : { name, pct, you: i === 0 }
    })
    .filter(Boolean) as { name: string; pct: number; you: boolean }[]
  if (!rows.length) return null
  const max = Math.max(...rows.map((r) => r.pct), 1)
  return (
    <div className={`${CARD} px-6 py-5`}>
      <Eyebrow className="mb-3">Share of tracked conversation this update</Eyebrow>
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-3">
            <span className="w-[120px] shrink-0 truncate text-[13.5px] text-foreground">{r.name}</span>
            <span className="h-[11px] flex-1"><span className={`block h-full rounded-[3px] ${r.you ? 'bg-you' : 'bg-comp'}`} style={{ width: `${Math.max(2, (r.pct / max) * 100)}%` }} /></span>
            <span className="w-[54px] text-right font-mono text-[13.5px] tabular-nums text-foreground">{r.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** What moved, in the delta's own verdicts. A metric the update could not
 *  judge says so rather than showing a number that means nothing. */
function movementLines(data: DocumentSnapshotData): { label: string; value: string }[] {
  const d = data.delta
  if (!d) return [{ label: 'Movement', value: 'No earlier update to compare with.' }]
  const out: { label: string; value: string }[] = []
  if (d.sentiment) {
    const dir = d.sentiment.now > d.sentiment.prev ? 'up' : d.sentiment.now < d.sentiment.prev ? 'down' : 'level'
    out.push({
      label: 'Tone',
      value: d.sentiment.verdict.state === 'moved' ? `Moved ${dir}, ${Math.round(d.sentiment.prev * 10) / 10}% to ${Math.round(d.sentiment.now * 10) / 10}% positive`
        : d.sentiment.verdict.state === 'too_little_data' ? 'Too few judged conversations to say'
        : 'About where it was',
    })
  }
  if (d.share) {
    const dir = d.share.now.client > d.share.prev.client ? 'up' : d.share.now.client < d.share.prev.client ? 'down' : 'level'
    out.push({
      label: 'Share',
      value: d.share.verdict.state === 'moved' ? `Moved ${dir}, ${Math.round(d.share.prev.client * 10) / 10}% to ${Math.round(d.share.now.client * 10) / 10}%`
        : d.share.verdict.state === 'too_little_data' ? 'Too few videos to say'
        : 'About where it was',
    })
  }
  if (d.newThemes) out.push({ label: 'New', value: d.newThemes.count ? `${fmtCount(d.newThemes.count)} new: ${d.newThemes.labels.slice(0, 3).join(', ')}` : 'Nothing confirmed new this update' })
  if (d.conversations) out.push({ label: 'Volume', value: `${fmtCount(d.conversations.now)} conversations, against ${fmtCount(d.conversations.prev)} last update` })
  return out
}

/** What the conversation was about this update: the merged concerns with the
 *  conversations behind them and how long each has been running. The findings
 *  pick three; this is the field they were picked from. */
function ConcernField({ meta }: { meta: string }) {
  const rows = meta.split('|').filter(Boolean).map((r) => {
    const [label, total, trajectory] = r.split('~')
    return { label, total: Number(total), trajectory }
  })
  if (!rows.length) return null
  const max = Math.max(...rows.map((r) => r.total), 1)
  return (
    <div className="flex flex-col gap-2.5">
      <Eyebrow>What the conversation was about this update</Eyebrow>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-4">
            <span className="w-[46px] shrink-0 text-right font-mono text-[14px] tabular-nums text-foreground">{fmtCount(r.total)}</span>
            <span className="h-[8px] w-[92px] shrink-0 rounded-[3px] bg-neutral-seg"><span className="block h-full rounded-[3px] bg-primary" style={{ width: `${Math.max(6, (r.total / max) * 100)}%` }} /></span>
            <span className="flex-1 truncate text-[14.5px] text-foreground">{r.label}</span>
            {r.trajectory && <span className="shrink-0"><Pill tone={r.trajectory.startsWith('new') ? 'new' : 'plain'}>{r.trajectory}</Pill></span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function StandingPage({ page, data }: { page: DocPage; data: DocumentSnapshotData }) {
  const block = page.blocks.find((b) => b.field === 'standing')
  const parties = (page.meta?.parties ?? '').split('|').filter(Boolean)
  const moved = movementLines(data)
  const READ = 'text-[17px] leading-[1.55] text-foreground'
  return (
    <div className="grid h-full min-h-0 grid-cols-[7fr_5fr] gap-x-12">
      <div className="flex min-h-0 flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Eyebrow>How it reads</Eyebrow>
          {block?.text && <BlockSlot block={block} textClass={`max-w-[62ch] ${READ}`}><Paragraphs text={block.text} figures={data.figures} className={`max-w-[62ch] ${READ}`} /></BlockSlot>}
        </div>
        <ConcernField meta={page.meta?.concerns ?? ''} />
      </div>
      <div className="flex min-h-0 flex-col gap-4">
        <StandingBars data={data} parties={parties} />
        <div className={`${CARD} px-6 py-5`}>
          <Eyebrow className="mb-3">What moved since the previous update</Eyebrow>
          <dl className="grid grid-cols-[64px_1fr] gap-x-4 gap-y-2.5">
            {moved.map((m) => (
              <Fragment key={m.label}>
                <dt className="pt-[2px] font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{m.label}</dt>
                <dd className="text-[13.5px] leading-[1.4] text-foreground">{m.value}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      </div>
    </div>
  )
}

// ── what is claimed and what comes back ────────────────────────────────────
// The market brief's own page. One card per claim the company makes in its
// videos: the claim as it was made, the verdict the analysis reached, what
// the audience says back, and the researcher's read of the difference.

const VERDICT_WORD: Record<string, { word: string; tone: 'you' | 'comp' | 'new' | 'plain' }> = {
  echoes: { word: 'the audience says it too', tone: 'you' },
  contradicts: { word: 'the audience says otherwise', tone: 'new' },
  silent: { word: 'the audience does not take it up', tone: 'plain' },
}

function SayHearPage({ page, figures, company }: { page: DocPage; figures: FigureTable; company: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <p className="max-w-[92ch] text-[15px] leading-[1.5] text-secondary-foreground">
        {`What ${company} says in its own videos, set against what the conversation does with it. The verdict is the analysis’s; the reading is the researcher’s.`}
      </p>
      <ul className="grid min-h-0 grid-cols-2 items-start gap-6">
        {page.blocks.map((b) => {
          const verdict = VERDICT_WORD[b.items?.[0] ?? ''] ?? null
          const theySay = b.items?.[1] ?? ''
          return (
            <li key={b.id} className={`${CARD} flex min-h-0 flex-col gap-3 px-7 py-5`}>
              <div className="flex items-start justify-between gap-4">
                <p className="max-w-[40ch] font-serif text-[17px] italic leading-[1.4] text-foreground">&ldquo;{b.label}&rdquo;</p>
                {verdict && <span className="shrink-0"><Pill tone={verdict.tone}>{verdict.word}</Pill></span>}
              </div>
              {theySay && (
                <p className="border-l-2 border-border pl-3.5 text-[13.5px] leading-[1.45] text-secondary-foreground">{theySay}</p>
              )}
              {b.text && <BlockSlot block={b} textClass={BODY}><Paragraphs text={b.text} figures={figures} className={BODY} /></BlockSlot>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── what the audience asks ─────────────────────────────────────────────────
// The content brief's page: the questions the conversation puts and nobody
// settles, in the audience's own framing. Written as "the question: what is
// behind it", split the way the language page splits its own lines.

function AskedPage({ page }: { page: DocPage }) {
  const block = page.blocks.find((b) => b.field === 'asked')
  const items = block?.items ?? []
  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <p className="max-w-[86ch] text-[16px] leading-[1.5] text-secondary-foreground">
        Questions the conversation puts and does not settle. Each is asked in the audience&rsquo;s own framing, not the company&rsquo;s; the note says what is behind it.
      </p>
      {block && (
        <BlockSlot block={block} textClass={BODY_SM}>
          <ol className="grid grid-cols-2 gap-x-8 gap-y-4">
            {items.map((x, i) => {
              const m = /^["“]?([^:"”]+)["”]?:\s*(.+)$/.exec(x)
              return (
                <li key={i} className="flex gap-4">
                  <span className="w-5 shrink-0 pt-[3px] font-mono text-[13px] tabular-nums text-primary">{i + 1}</span>
                  <div className="flex flex-col gap-1">
                    <p className="text-[16.5px] font-medium leading-[1.35] text-foreground">{m ? `${m[1].trim()}?`.replace(/\?\?$/, '?') : x}</p>
                    {m && <p className={BODY_SM}>{m[2].replace(/^./, (c) => c.toUpperCase())}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
        </BlockSlot>
      )}
    </div>
  )
}

// ── personas ───────────────────────────────────────────────────────────────

const PERSONA_LABELS = ['Who they are', 'What they want', 'What stops them', 'What moves them']

function PersonaCard({ block, figures, lens }: { block: DocBlock; figures: FigureTable; lens: DocLens }) {
  const [one, ...rest] = block.items ?? []
  return (
    <div className={`${CARD} flex min-h-0 flex-col gap-3 px-7 py-5`}>
      <div className="flex flex-col gap-1.5">
        <p className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{block.label}</p>
        {one && <p className="font-serif text-[15px] italic leading-[1.5] text-secondary-foreground">{one}</p>}
      </div>
      <div className="flex flex-col gap-3">
        {rest.map((it, i) => (
          <div key={i} className="flex gap-4">
            <p className="w-[104px] shrink-0 pt-[3px] font-mono text-[11px] uppercase leading-[1.3] tracking-[0.08em] text-muted-foreground">{PERSONA_LABELS[i + 1]}</p>
            <p className="text-[13.5px] leading-[1.45] text-foreground">{it}</p>
          </div>
        ))}
        {block.text && (
          <div className="flex gap-4 border-t border-border pt-3">
            <p className="w-[104px] shrink-0 pt-[3px] font-mono text-[11px] uppercase tracking-[0.08em] text-primary">{lens.short}</p>
            <BlockSlot block={block} textClass="text-[13.5px] font-medium leading-[1.45] text-foreground"><p className="text-[13.5px] font-medium leading-[1.45] text-foreground"><Figured text={block.text} figures={figures} /></p></BlockSlot>
          </div>
        )}
      </div>
    </div>
  )
}

function PersonasPage({ page, figures, lens }: { page: DocPage; figures: FigureTable; lens: DocLens }) {
  return (
    <div className="grid h-full min-h-0 grid-cols-2 items-start gap-x-8">
      {page.blocks.map((b) => <PersonaCard key={b.id} block={b} figures={figures} lens={lens} />)}
    </div>
  )
}

// ── language ───────────────────────────────────────────────────────────────

function LanguagePage({ page }: { page: DocPage }) {
  const careBlock = page.blocks.find((b) => b.field === 'care')
  const items = careBlock?.items ?? []
  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <p className="max-w-[80ch] text-[16px] leading-[1.5] text-secondary-foreground">Words and claims the conversation pushes back on or contradicts. Each is a phrase a buyer will hear as a promise; the note says what the audience already knows about it.</p>
      <BlockSlot block={careBlock!} textClass={BODY_SM}>
      <ul className="grid grid-cols-2 gap-5">
        {items.map((x, i) => {
          const m = /^["“]?([^:"”]+)["”]?:\s*(.+)$/.exec(x)
          return (
            <li key={i} className={`${CARD} flex flex-col gap-1.5 px-6 py-4`}>
              <p className="flex items-center gap-2.5 text-[18px] font-semibold text-foreground">
                <span className="inline-block h-[10px] w-[10px] shrink-0 rounded-full bg-warning" aria-hidden />
                <span>{m ? m[1].trim() : x}</span>
              </p>
              {m && <p className={BODY_SM}>{m[2].replace(/^./, (c) => c.toUpperCase())}</p>}
            </li>
          )
        })}
      </ul>
      </BlockSlot>
    </div>
  )
}

// ── method ─────────────────────────────────────────────────────────────────

function MethodPage({ page, data }: { page: DocPage; data: DocumentSnapshotData }) {
  const items = page.blocks.find((b) => b.field === 'method')?.items ?? []
  const m = data.method
  const rows: [string, string][] = [
    ['Period', m.period],
    ['Conversations', fmtCount(m.conversations)],
    ['Videos', `${fmtCount(m.videos)} · ${fmtCount(m.clientVideos)} ${data.company} · ${fmtCount(m.competitorVideos)} competitor`],
    ['Sources', m.sources.map((s) => PLATFORM[s] ?? s).join(', ') || 'public video platforms'],
    ['Held back', `${fmtCount(m.heldBack)} phrases in other languages`],
    ['Findings', `${data.pages.filter((p) => p.kind === 'finding').length}${m.thin ? ' (thin update)' : ''}`],
  ]
  return (
    <div className="grid h-full min-h-0 grid-cols-[7fr_5fr] gap-x-12">
      <div className="flex flex-col gap-4">
        <Eyebrow>How this brief was made</Eyebrow>
        {items.map((it, i) => <p key={i} className={`max-w-[66ch] ${BODY}`}>{it}</p>)}
      </div>
      <div className={`${CARD} self-start px-6 py-5`}>
        <Eyebrow className="mb-3">This brief in numbers</Eyebrow>
        <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2.5">
          {rows.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="pt-[3px] font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{k}</dt>
              <dd className="text-[14.5px] leading-[1.4] text-foreground">{v}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </div>
  )
}

// ── deck ───────────────────────────────────────────────────────────────────

/** The lens the document was written under. Older snapshots (before
 *  2026-09-02) carry none: they are all Sales briefs. */
const lensOf = (data: DocumentSnapshotData): DocLens => data.lens ?? { means: 'What it means for a sale', short: 'for a sale' }

function PageBody({ page, data }: { page: DocPage; data: DocumentSnapshotData }) {
  const figures = data.figures
  const lens = lensOf(data)
  switch (page.kind) {
    case 'in_short': return <OverviewPage page={page} data={data} />
    case 'finding': return <FindingPage page={page} figures={figures} company={data.company} lens={lens} />
    case 'competitor': return <CompetitorPage page={page} figures={figures} data={data} />
    case 'personas': return <PersonasPage page={page} figures={figures} lens={lens} />
    case 'standing': return <StandingPage page={page} data={data} />
    case 'say_hear': return <SayHearPage page={page} figures={figures} company={data.company} />
    case 'asked': return <AskedPage page={page} />
    case 'language': return <LanguagePage page={page} />
    case 'method': return <MethodPage page={page} data={data} />
    default: return null
  }
}

export function DocumentDeck({ data, date = fmtDate(new Date()) }: { data: DocumentSnapshotData; date?: string }) {
  const slides = documentSlides(data)
  const pages = slides.length + 1
  const chrome = (title: string) => ({ context: title, footer: <DeckFooter company={data.company} date={date} /> })
  return (
    <>
      <DocumentCover data={data} pages={pages} />
      {slides.map((s, i) => {
        const page = data.pages.find((p) => p.id === s.keys[0])
        if (!page) return null
        const title = page.kind === 'finding' ? `Finding ${page.meta?.n ?? ''}` : page.kind === 'competitor' ? 'Competitor' : page.title
        return (
          <Slide key={page.id} title={title} chrome={chrome(page.title)} page={i + 2} pages={pages} layout="single">
            <PageBody page={page} data={data} />
          </Slide>
        )
      })}
    </>
  )
}
