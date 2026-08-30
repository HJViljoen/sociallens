import { Fragment, type ReactNode } from 'react'
import { DeckFooter } from '@/components/print/report-deck'
import { Slide } from '@/components/print/slide'
import { substituteFigures } from '@/lib/reports/cover'
import { documentSlides } from '@/lib/reports/documents/compose'
import type { DocBlock, DocPage, DocumentSnapshotData } from '@/lib/reports/documents/types'
import type { FigureTable } from '@/lib/reports/types'

// A document's deck from its (hydrated) snapshot data: the cover, then one
// slide per skeleton page, numbered once across the document. The same
// chrome as a report's pages (Heinrich, 2026-08-30): the page's name top
// right, "Created by {company} with Verbatim" and the date at the foot. No
// evidence on paper: the workings never reach this component.
//
// The pages (T6, 2026-08-31): a research report's typography on the print
// tokens. A finding reads left to right: the observation in a wide column,
// the interpretation, the practice lines and the confidence marker beside
// it. Depth on paper is the screen's ambient shadow (tiles), never a grey
// block. Every body is 1168 × ~560 px before the print zoom; the caps in
// lib/config.ts DOCUMENT_BLOCK_MAX are what keep a page on its page.

const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const fmtCount = (n: number) => new Intl.NumberFormat('en-US').format(n)
const PLATFORM: Record<string, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', reddit: 'Reddit' }
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')

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

function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground ${className}`}>{children}</p>
}

const BODY = 'text-[12.5px] leading-[1.55] text-foreground'
const BODY_SM = 'text-[11.5px] leading-[1.5] text-foreground'

function DocumentCover({ data, pages }: { data: DocumentSnapshotData; pages: number }) {
  const sections = new Set(data.pages.map((p) => p.kind)).size
  return (
    <section className="vb-slide">
      <div className="vb-slide-body">
        <div className="flex h-full flex-col justify-center gap-7 px-[6%]">
          <h1 className="max-w-[18ch] text-[44px] font-semibold leading-[1.08] tracking-[-0.02em] text-foreground [text-wrap:balance]">{data.title}</h1>
          <p className="font-mono text-[11px] text-muted-foreground">
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
    <div className="rounded-lg bg-tile px-4 py-3 shadow-tile">
      <p className="font-mono text-[26px] font-medium leading-none tracking-[-0.02em] tabular-nums text-foreground">{value}</p>
      <p className="mt-1.5 text-[10.5px] leading-[1.35] text-muted-foreground">{label}</p>
    </div>
  )
}

function OverviewPage({ page, data }: { page: DocPage; data: DocumentSnapshotData }) {
  const f = data.figures
  const summary = page.blocks.find((b) => b.field === 'summary')
  const findings = page.blocks.find((b) => b.field === 'findings')?.items ?? []
  const notSure = page.blocks.find((b) => b.field === 'not_sure')?.items ?? []
  const competitor = data.pages.find((p) => p.kind === 'competitor')?.meta?.name
  const compKey = competitor ? `${slugOf(competitor)}_share_pct` : null
  const tiles = [
    f.conversations && { value: f.conversations.value, label: `conversations read this update${f.videos ? `, on ${f.videos.value} videos` : ''}` },
    f.client_share_pct && { value: f.client_share_pct.value, label: compKey && f[compKey] ? `${data.company} share of tracked conversation · ${competitor} ${f[compKey].value}` : `${data.company} share of tracked conversation` },
    f.positive_pct && { value: f.positive_pct.value, label: 'positive, of the conversations judged for tone' },
  ].filter(Boolean) as { value: string; label: string }[]
  return (
    <div className="grid h-full min-h-0 grid-cols-[7fr_5fr] gap-x-10">
      <div className="flex min-h-0 flex-col gap-5">
        <div className="flex flex-col gap-2.5">
          {summary?.text && <Paragraphs text={summary.text} figures={f} className="max-w-[72ch] text-[13.5px] leading-[1.55] text-foreground" />}
        </div>
        {findings.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>Findings in this brief</Label>
            <ol className="flex flex-col gap-1.5">
              {findings.map((h, i) => (
                <li key={i} className="flex gap-3 text-[13px] leading-[1.4] text-foreground">
                  <span className="w-5 shrink-0 pt-[2px] font-mono text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="font-medium">{h}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-col gap-5">
        <div className="flex flex-col gap-3">{tiles.map((t, i) => <StatTile key={i} value={t.value} label={t.label} />)}</div>
        {notSure.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>Not settled this update</Label>
            <ul className="flex flex-col gap-1">
              {notSure.map((x, i) => <li key={i} className={`border-l border-border pl-3 ${BODY_SM} text-secondary-foreground`}>{x}</li>)}
            </ul>
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
    <span className="inline-flex items-center gap-1 align-middle">
      {[0, 1, 2].map((i) => <span key={i} className={`inline-block h-[7px] w-[7px] rounded-full ${i < n ? 'bg-primary' : 'bg-neutral-seg'}`} />)}
    </span>
  )
}

function FindingPage({ page, figures }: { page: DocPage; figures: FigureTable }) {
  const b = (field: string) => page.blocks.find((x) => x.field === field)
  const headline = b('headline')
  const saw = b('saw')
  const heard = b('heard')
  const means = b('means')
  const practice = b('practice')?.items ?? []
  const sureWord = page.meta?.sure ?? 'thin'
  const sureNote = (b('sure')?.text ?? '').replace(/^(Solid|Reasonable|Thin):[^.]*\.\s*(Treat it as a lead, not a rule\.\s*)?/, '')
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {headline && <h2 className="max-w-[40ch] text-[26px] font-semibold leading-[1.12] tracking-[-0.02em] text-foreground [text-wrap:balance]">{headline.text}</h2>}
      <div className="grid min-h-0 flex-1 grid-cols-[7fr_5fr] gap-x-10">
        <div className="flex min-h-0 flex-col gap-2.5">
          <Label>What the conversation shows</Label>
          {saw?.text && <Paragraphs text={saw.text} figures={figures} className={`max-w-[74ch] ${BODY}`} />}
          {saw?.quote?.text && (
            <blockquote className="mt-1 max-w-[70ch] border-l-2 border-primary/40 pl-3 font-serif text-[12.5px] italic leading-[1.45] text-secondary-foreground">“{saw.quote.text}”</blockquote>
          )}
        </div>
        <div className="flex min-h-0 flex-col gap-4 border-l border-border pl-8">
          {heard?.text && (
            <div className="flex flex-col gap-1">
              <Label>Where it was heard</Label>
              <p className="font-mono text-[10.5px] leading-[1.5] text-secondary-foreground">{heard.text}</p>
            </div>
          )}
          {means?.text && (
            <div className="flex flex-col gap-1">
              <Label>What it means for a sale</Label>
              <Paragraphs text={means.text} figures={figures} className={BODY} />
            </div>
          )}
          {practice.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label>In practice</Label>
              <ul className="flex flex-col gap-1">
                {practice.map((x, i) => <li key={i} className={`border-l-2 border-primary/40 pl-3 ${BODY_SM}`}><Figured text={x} figures={figures} /></li>)}
              </ul>
            </div>
          )}
          <div className="mt-auto flex flex-col gap-1 pt-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground">
              Confidence <span className="ml-1"><ConfidenceDots sure={sureWord} /></span> <span className="ml-1 normal-case tracking-normal text-foreground">{sureWord}</span>
            </p>
            {sureNote && <p className="text-[11px] leading-[1.45] text-muted-foreground">{sureNote}</p>}
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
      <span className="w-[88px] shrink-0 truncate text-[11px] text-foreground">{label}</span>
      <span className="h-[8px] flex-1"><span className={`block h-full rounded-[2px] ${cls}`} style={{ width: `${Math.max(2, (pct / max) * 100)}%` }} /></span>
      <span className="w-[44px] text-right font-mono text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  )
  return (
    <div className="rounded-lg bg-tile px-4 py-3 shadow-tile">
      <Label className="mb-2">Share of tracked conversation this update</Label>
      <div className="flex flex-col gap-1.5">
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
      <div className="grid grid-cols-3 gap-x-8">
        {cols.map(([label, block]) => (
          <div key={label} className="flex flex-col gap-1.5">
            <Label>{label}</Label>
            {block?.text && <Paragraphs text={block.text} figures={figures} className={BODY} />}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[8fr_4fr] gap-x-8 border-t border-border pt-5">
        <div className="flex flex-col gap-1.5">
          <Label>When {name} comes up</Label>
          {read?.text && <Paragraphs text={read.text} figures={figures} className={`max-w-[78ch] ${BODY}`} />}
        </div>
        <ShareStrip data={data} name={name} />
      </div>
    </div>
  )
}

// ── personas ───────────────────────────────────────────────────────────────

const PERSONA_LABELS = ['Who they are', 'What they want', 'What stops them', 'What moves them']

function PersonaCard({ block, figures }: { block: DocBlock; figures: FigureTable }) {
  const [one, ...rest] = block.items ?? []
  return (
    <div className="flex min-h-0 flex-col gap-2.5 rounded-lg bg-tile px-5 py-4 shadow-tile">
      <div className="flex flex-col gap-1">
        <p className="text-[16px] font-semibold tracking-[-0.01em] text-foreground">{block.label}</p>
        {one && <p className="font-serif text-[12px] italic leading-[1.45] text-secondary-foreground">{one}</p>}
      </div>
      <div className="flex flex-col gap-2">
        {rest.map((it, i) => (
          <div key={i} className="flex gap-3">
            <Label className="w-[96px] shrink-0 pt-[3px]">{PERSONA_LABELS[i + 1]}</Label>
            <p className={BODY_SM}>{it}</p>
          </div>
        ))}
        {block.text && (
          <div className="flex gap-3 border-t border-border pt-2">
            <p className="w-[96px] shrink-0 pt-[3px] font-mono text-[9.5px] uppercase tracking-[0.08em] text-primary">For a sale</p>
            <p className={`${BODY_SM} font-medium`}><Figured text={block.text} figures={figures} /></p>
          </div>
        )}
      </div>
    </div>
  )
}

function PersonasPage({ page, figures }: { page: DocPage; figures: FigureTable }) {
  return (
    <div className="grid h-full min-h-0 grid-cols-2 items-start gap-x-8">
      {page.blocks.map((b) => <PersonaCard key={b.id} block={b} figures={figures} />)}
    </div>
  )
}

// ── language ───────────────────────────────────────────────────────────────

function LanguagePage({ page }: { page: DocPage }) {
  const items = page.blocks.find((b) => b.field === 'care')?.items ?? []
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <p className="max-w-[70ch] text-[12.5px] leading-[1.5] text-secondary-foreground">Words and claims the conversation pushes back on or contradicts. Each is a phrase a buyer will hear as a promise; the note says what the audience already knows about it.</p>
      <ul className="grid grid-cols-2 gap-x-10 gap-y-4">
        {items.map((x, i) => {
          const m = /^["“]?([^:"”]+)["”]?:\s*(.+)$/.exec(x)
          return (
            <li key={i} className="flex flex-col gap-0.5 border-l-2 border-warning/70 pl-3">
              <p className="text-[13px] font-semibold text-foreground">{m ? m[1].trim() : x}</p>
              {m && <p className={BODY_SM}>{m[2]}</p>}
            </li>
          )
        })}
      </ul>
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
    <div className="grid h-full min-h-0 grid-cols-[7fr_5fr] gap-x-10">
      <div className="flex flex-col gap-3">
        {items.map((it, i) => <p key={i} className={`max-w-[70ch] ${BODY}`}>{it}</p>)}
      </div>
      <div className="self-start rounded-lg bg-tile px-5 py-4 shadow-tile">
        <Label className="mb-2">This brief in numbers</Label>
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
          {rows.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="pt-[2px] font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{k}</dt>
              <dd className="text-[12px] leading-[1.4] text-foreground">{v}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </div>
  )
}

// ── deck ───────────────────────────────────────────────────────────────────

function PageBody({ page, data }: { page: DocPage; data: DocumentSnapshotData }) {
  const figures = data.figures
  switch (page.kind) {
    case 'in_short': return <OverviewPage page={page} data={data} />
    case 'finding': return <FindingPage page={page} figures={figures} />
    case 'competitor': return <CompetitorPage page={page} figures={figures} data={data} />
    case 'personas': return <PersonasPage page={page} figures={figures} />
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
        const title = page.kind === 'finding' ? `Finding ${page.meta?.n ?? ''}` : page.kind === 'competitor' ? page.meta?.name ?? page.title : page.title
        return (
          <Slide key={page.id} title={title} chrome={chrome(page.title)} page={i + 2} pages={pages} layout="single">
            <PageBody page={page} data={data} />
          </Slide>
        )
      })}
    </>
  )
}
