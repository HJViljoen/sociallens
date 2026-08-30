'use client'

import { Quotes } from '@/components/quotes'
import type { DocumentWorkings } from '@/lib/reports/documents/types'

// The workings (S7, 2026-08-31): what a block rests on, shown beside the
// page, never on it. The selected block's grounded points (the agent's own
// sentences, the conversations behind them, the themes, the voices resolved
// live), the check's verdict, the headline it carried on; and at the top
// what the researcher asked, what it held back and what it dropped.

const fmt = (n: number) => n.toLocaleString('en-GB')

export function WorkingsDrawer({ workings, selectedId, blockLabel }: { workings: DocumentWorkings; selectedId: string | null; blockLabel: (id: string) => string }) {
  const bw = selectedId ? workings.blocks.find((b) => b.blockId === selectedId) ?? null : null
  const points = bw ? bw.basedOn.map((id) => workings.points.find((p) => p.id === id)).filter((p): p is DocumentWorkings['points'][number] => Boolean(p)) : []
  const concerns = bw ? bw.basedOn.filter((id) => /^S\d+$/.test(id)).map((id) => workings.concerns[Number(id.slice(1)) - 1]).filter(Boolean) : []
  return (
    <aside className="flex h-full min-h-0 w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-tile px-4 py-4 text-[12.5px]" aria-label="The workings">
      {bw ? (
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">{blockLabel(bw.blockId)}</p>
          {bw.continuedFrom && <p className="text-secondary-foreground">Carried on from the previous brief: <span className="text-foreground">{bw.continuedFrom}</span></p>}
          {bw.check && <p className="text-secondary-foreground">Checked against the data: <span className="text-foreground">{bw.check === 'echoes' ? 'the conversation echoes it' : 'the conversation is silent on it'}</span></p>}
          {points.length === 0 && concerns.length === 0 && <p className="text-muted-foreground">This block was written by code or by a person, not by the agent; nothing to show.</p>}
          {points.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 rounded-[4px] bg-inner px-3 py-2.5">
              <p className="leading-[1.45] text-foreground">{p.text}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] text-muted-foreground">
                <span className="rounded-full bg-tile px-1.5 py-0.5 ring-1 ring-border">{fmt(p.conversationCount)} conversation{p.conversationCount === 1 ? '' : 's'}</span>
                {p.themeLabels.slice(0, 3).map((t) => <span key={t}>{t}</span>)}
              </p>
              <Quotes items={p.quotes.map((q) => q.text).filter(Boolean).slice(0, 2)} />
            </div>
          ))}
          {concerns.map((c) => (
            <div key={c.label} className="rounded-[4px] bg-inner px-3 py-2.5">
              <p className="text-foreground">{c.label}</p>
              <p className="font-mono text-[10.5px] text-muted-foreground">{fmt(c.total)} across {c.buckets.map((b) => `${b.label} ${b.evidenceCount}`).join(', ')}{c.trajectory ? ` · ${c.trajectory}` : ''}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">Press a count on the page to see what that block rests on.</p>
      )}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">What the researcher asked</p>
        <ul className="flex flex-col gap-1.5">
          {workings.questions.map((q) => (
            <li key={q.id} className="leading-[1.4]">
              <span className="text-foreground">{q.text}</span>
              <span className="ml-1 font-mono text-[10.5px] text-muted-foreground">{q.outcome}{q.conversationCount ? ` · ${fmt(q.conversationCount)}` : ''}</span>
            </li>
          ))}
        </ul>
        {workings.dropped.length > 0 && (
          <div className="mt-1 flex flex-col gap-1">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-warning">Dropped</p>
            {workings.dropped.map((d, i) => <p key={i} className="leading-[1.4]"><span className="text-foreground">{d.headline}</span> <span className="text-muted-foreground">{d.reason}</span></p>)}
          </div>
        )}
        <p className="font-mono text-[10.5px] text-muted-foreground">{fmt(workings.heldBack)} quotes held back for language · ${workings.costUsd.toFixed(2)} this build</p>
      </div>
    </aside>
  )
}
