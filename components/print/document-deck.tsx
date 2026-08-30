import { Fragment } from 'react'
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
// This is the plain first deck (T5): blocks as paragraphs, so the words can
// be judged before the pages are designed (T6).

const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function Figured({ text, figures }: { text: string; figures: FigureTable }) {
  return (
    <>
      {substituteFigures(text, figures).map((p, i) =>
        'text' in p ? <Fragment key={i}>{p.text}</Fragment> : <span key={i} className="font-mono tabular-nums text-foreground">{p.figure}</span>,
      )}
    </>
  )
}

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

const FIELD_LABEL: Record<string, string> = {
  summary: '', headline: '', saw: 'What we saw', means: 'What it means for a sale', say: 'What to say', sure: 'How sure we are',
  pitch: 'What they are pitching', praise: 'What their users praise', hurt: 'Where their users hurt', read: 'When they come up',
  line: '', borrow: 'Borrow these', care: 'Handle with care', not_sure: 'Not sure yet',
}

function Block({ block, figures }: { block: DocBlock; figures: FigureTable }) {
  const label = FIELD_LABEL[block.field]
  if (block.field === 'headline') {
    return <h2 className="text-[22px] font-semibold leading-[1.15] tracking-[-0.015em] text-foreground [text-wrap:balance]">{block.text}</h2>
  }
  return (
    <div className="flex flex-col gap-1">
      {block.label && <p className="text-[13px] font-semibold text-foreground">{block.label}</p>}
      {label && <p className="font-mono text-[9.5px] uppercase tracking-[0.07em] text-muted-foreground">{label}</p>}
      {block.text && <p className="max-w-[78ch] text-[12.5px] leading-[1.5] text-foreground"><Figured text={block.text} figures={figures} /></p>}
      {block.field === 'line' && block.items?.[0] && (
        <p className="max-w-[78ch] font-serif text-[12px] italic leading-[1.45] text-secondary-foreground">{block.items[0]}</p>
      )}
      {block.field !== 'line' && block.items && block.items.length > 0 && (
        <ul className="flex max-w-[78ch] flex-col gap-1 pl-4 text-[12.5px] leading-[1.5] text-foreground">
          {block.items.map((it, i) => <li key={i} className="list-disc"><Figured text={it} figures={figures} /></li>)}
        </ul>
      )}
      {block.quotes && block.quotes.length > 0 && (
        <ul className="flex max-w-[78ch] flex-col gap-1 font-serif text-[12.5px] italic leading-[1.45] text-secondary-foreground">
          {block.quotes.filter((q) => q.text).map((q) => <li key={q.ref}>“{q.text}”</li>)}
        </ul>
      )}
      {block.quote?.text && (
        <blockquote className="max-w-[70ch] border-l-2 border-primary/30 pl-3 font-serif text-[12.5px] italic leading-[1.45] text-secondary-foreground">“{block.quote.text}”</blockquote>
      )}
    </div>
  )
}

function Page({ page, figures, data }: { page: DocPage; figures: FigureTable; data: DocumentSnapshotData }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {page.kind === 'in_short' && (
        <p className="font-mono text-[11px] text-muted-foreground">
          {[figures.conversations && `${figures.conversations.value} ${figures.conversations.label}`, figures.client_share_pct && `${data.company} share ${figures.client_share_pct.value}`, figures.positive_pct && `${figures.positive_pct.value} positive`].filter(Boolean).join(' · ')}
        </p>
      )}
      {page.blocks.map((b) => <Block key={b.id} block={b} figures={figures} />)}
      {page.kind === 'in_short' && data.notSureYet.length > 0 && (
        <Block block={{ id: 'not_sure', field: 'not_sure', text: '', items: data.notSureYet }} figures={figures} />
      )}
    </div>
  )
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
        const title = page.kind === 'finding' ? `Finding ${i}` : page.kind === 'competitor' ? page.meta?.name ?? page.title : page.title
        return (
          <Slide key={page.id} title={title} chrome={chrome(page.title)} page={i + 2} pages={pages} layout="single">
            <Page page={page} figures={data.figures} data={data} />
          </Slide>
        )
      })}
    </>
  )
}
