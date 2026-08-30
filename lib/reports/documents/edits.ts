import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReportEditRow } from '../types'
import { isDocumentData, type DocBlock } from './types'

/**
 * Operator edits of a built document (decision 5, 2026-08-31): an OVERLAY on
 * the snapshot, never a change to it. `report_edits` holds one row per
 * (snapshot, block); `applyEdits` lays them over the frozen pages wherever
 * the document is read (Studio, /render, the share page), so the PDF, the
 * link and the preview all say what the operator said. The snapshot's own
 * `data` and `evidence_ids` stay as the machine wrote them. An edit is the
 * person's words, saved literally: no scrub, no placeholders.
 */

export type BlockEdit = Pick<ReportEditRow, 'block_id' | 'text'>

export async function loadEdits(admin: SupabaseClient, snapshotId: string): Promise<ReportEditRow[]> {
  const { data, error } = await admin.from('report_edits').select('*').eq('snapshot_id', snapshotId).order('edited_at', { ascending: true })
  if (error) throw new Error(`report_edits: read failed: ${error.message}`)
  return (data ?? []) as ReportEditRow[]
}

/** The text a block shows, and how an edit sets it: a prose block is its
 *  text; an items block (practice lines, the findings list, care, not sure)
 *  is one item per line. */
export function blockToText(b: Pick<DocBlock, 'text' | 'items'>): string {
  return b.items && !b.text ? b.items.join('\n') : b.text
}

export function textToBlock(b: DocBlock, text: string): DocBlock {
  if (b.items && !b.text) {
    return { ...b, items: text.split('\n').map((s) => s.trim()).filter(Boolean) }
  }
  return { ...b, text }
}

/** Lay edits over a document's blocks. Anything that is not a document, or
 *  has no edits, comes back as it was (same reference). */
export function applyEdits<T>(data: T, edits: BlockEdit[]): T {
  if (!edits.length || !isDocumentData(data)) return data
  const byId = new Map(edits.map((e) => [e.block_id, e.text]))
  let touched = false
  const pages = data.pages.map((p) => {
    const blocks = p.blocks.map((b) => {
      const t = byId.get(b.id)
      if (t === undefined) return b
      touched = true
      return textToBlock(b, t)
    })
    return touched ? { ...p, blocks } : p
  })
  return touched ? ({ ...data, pages } as T) : data
}

export const editedBlockIds = (edits: BlockEdit[]): Set<string> => new Set(edits.map((e) => e.block_id))
