'use client'

import { useRef, useState } from 'react'
import { AgentDocumentView } from '@/components/agent-document'
import type { ClaimResult, Judgement, AskSummary } from '@/lib/ask/types'
import type { Segment } from '@/lib/ask/anchor'

// The check on the left, their document on the right — the artifact-panel
// shape, and Heinrich's idea. It resolves the thing that made "notes inside the
// document" hard: because the document renders in OUR panel, the annotation is
// just markup. No PDF coordinates, no need to store their file, and the privacy
// position (we keep what we read, never the document itself) survives untouched.
//
// Nothing is written back. The right-hand pane is a rendering of the text we
// extracted, with marks laid over it — their document is not edited and never
// leaves their machine in the first place.
//
// SILENT CLAIMS ARE NOT MARKED. Same rule as the list: silence is clean space.
// It also makes the marks mean something — every highlight is a passage the
// conversation actually speaks to, so a document with three marks has three
// places worth looking, not nine of which six say "nothing here".

export function AgentDocumentSplit({
  claims,
  summary,
  judgement,
  quotesByClaim,
  segments,
  anchored,
  notice,
}: {
  claims: ClaimResult[]
  summary: AskSummary
  judgement: Judgement[]
  quotesByClaim: Map<string, string[]>
  segments: Segment[]
  anchored: string[]
  notice: string | null
}) {
  const [active, setActive] = useState<string | null>(null)
  const [pane, setPane] = useState<'check' | 'document'>('check')
  const docRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const anchoredSet = new Set(anchored)

  function focusClaim(ref: string, from: 'list' | 'document') {
    setActive(ref)
    const target = (from === 'list' ? docRef : listRef).current?.querySelector(
      `[data-ref="${CSS.escape(ref)}"]`,
    )
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // On a narrow screen the two panes are tabs, so following a mark means
    // switching to the pane that holds the thing you asked to see.
    if (window.innerWidth < 1024) setPane(from === 'list' ? 'document' : 'check')
  }

  const verdictMark: Record<string, string> = {
    echoes: 'bg-primary/15 hover:bg-primary/25',
    contradicts: 'bg-clay/15 hover:bg-clay/25',
  }
  const verdictOf = new Map(claims.map((c) => [c.ref, c.verdict]))

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Tabs below lg, where two columns would each be too narrow to read. */}
      <div className="flex gap-1 lg:hidden">
        {(['check', 'document'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPane(p)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              pane === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/60'
            }`}
          >
            {p === 'check' ? 'The check' : 'Your document'}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-2">
        <div
          ref={listRef}
          className={`min-h-0 overflow-y-auto pr-1 ${pane === 'check' ? '' : 'hidden'} lg:block`}
        >
          <AgentDocumentView
            claims={claims}
            summary={summary}
            judgement={judgement}
            quotesByClaim={quotesByClaim}
            activeRef={active}
            anchored={anchoredSet}
            onSelect={(ref) => focusClaim(ref, 'list')}
          />
        </div>

        <div
          ref={docRef}
          className={`min-h-0 overflow-y-auto rounded-2xl border border-border/60 bg-card p-6 ${
            pane === 'document' ? '' : 'hidden'
          } lg:block`}
        >
          {notice && <p className="mb-4 text-xs text-muted-foreground">{notice}</p>}
          {/* whitespace-pre-wrap: the extracted text carries the document's own
              line and paragraph breaks, and they are the only structure that
              survived extraction. Losing them would turn a brief into a wall. */}
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">
            {segments.map((seg, i) =>
              seg.ref && verdictMark[verdictOf.get(seg.ref) ?? ''] ? (
                <mark
                  key={i}
                  data-ref={seg.ref}
                  onClick={() => focusClaim(seg.ref!, 'document')}
                  className={`cursor-pointer rounded px-0.5 text-foreground transition-colors ${
                    verdictMark[verdictOf.get(seg.ref) ?? '']
                  } ${active === seg.ref ? 'ring-2 ring-primary/40' : ''}`}
                >
                  {seg.text}
                </mark>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
