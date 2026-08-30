'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditContext } from './edit-context'
import { blockToText } from '@/lib/reports/documents/edits'
import { coverPlainText } from '@/lib/reports/cover'
import type { DocBlock } from '@/lib/reports/documents/types'

// One block of a built document, editable in place (S7, 2026-08-31): the
// printed node until it is clicked; then a textarea in the same type, on the
// same measure, grown to its text, so the operator sees the words where they
// will sit on the sheet. Blur saves what was typed (the numbers already
// substituted, saved literally); Escape puts the printed node back. An
// edited block wears a mark and a way back to the machine's words. With the
// workings shown, a count pill in the margin opens the block's evidence.

export function BlockEditor({ block, textClass, children }: { block: DocBlock; textClass: string; children: ReactNode }) {
  const ctx = useEditContext()!
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const edited = ctx.edited.has(block.id)
  const count = ctx.counts?.get(block.id) ?? null
  const selected = ctx.selectedId === block.id

  const grow = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = '0px'; el.style.height = `${el.scrollHeight}px` } }
  useEffect(() => { if (editing) { grow(ref.current); ref.current?.focus() } }, [editing])

  const initial = () => {
    const raw = blockToText(block)
    return block.items && !block.text ? raw.split('\n').map((l) => coverPlainText(l, ctx.figures)).join('\n') : coverPlainText(raw, ctx.figures)
  }
  const open = () => { setValue(initial()); setEditing(true) }
  const cancel = () => setEditing(false)
  const commit = async () => {
    const next = value.trim()
    setEditing(false)
    if (next === initial().trim()) return
    setSaving(true)
    // An emptied block goes back to the machine's words, never blank.
    if (!next) { if (edited) await ctx.restore(block); setSaving(false); return }
    await ctx.save(block, next)
    setSaving(false)
  }
  const restore = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setSaving(true)
    await ctx.restore(block)
    setSaving(false)
  }

  return (
    <div className={`vb-block group relative -mx-1.5 rounded-[4px] px-1.5 ${editing ? 'ring-1 ring-primary' : 'hover:ring-1 hover:ring-primary/35'} ${selected ? 'bg-primary/5' : ''}`} data-block-id={block.id}>
      {editing ? (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => { setValue(e.target.value); grow(e.target) }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancel() } }}
          className={`vb-edit block w-full resize-none overflow-hidden bg-transparent p-0 outline-none ${textClass}`}
          spellCheck
          aria-label="Edit this text"
        />
      ) : (
        <div onClick={open} className="cursor-text" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') open() }}>{children}</div>
      )}
      {(edited || saving) && !editing && (
        <span className="absolute -top-2.5 right-1 flex items-center gap-1.5 font-mono text-[10px] leading-none">
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-primary-foreground">{saving ? 'saving' : 'edited'}</span>
          {edited && !saving && <button type="button" onClick={restore} className="rounded-full bg-tile px-1.5 py-0.5 text-secondary-foreground ring-1 ring-border hover:bg-inner">restore the original</button>}
        </span>
      )}
      {count !== null && !editing && (
        <button type="button" onClick={(e) => { e.stopPropagation(); ctx.select(block.id) }}
          className={`absolute -right-2 top-0 translate-x-full rounded-full px-2 py-0.5 font-mono text-[10.5px] leading-[1.4] tabular-nums ring-1 ${selected ? 'bg-primary text-primary-foreground ring-primary' : 'bg-tile text-secondary-foreground ring-border hover:bg-inner'}`}
          aria-label={`Show what this rests on: ${count} conversations`}>
          {count}
        </button>
      )}
    </div>
  )
}
