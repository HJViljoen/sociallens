'use client'

import { createContext, useContext } from 'react'
import type { DocBlock } from '@/lib/reports/documents/types'
import type { FigureTable } from '@/lib/reports/types'

/** What the Studio's document editor hands every block on the page. Absent
 *  (the print route, the share page) a BlockSlot renders its children as
 *  they are. */
export interface EditContextValue {
  snapshotId: string
  figures: FigureTable
  /** Block ids carrying an operator's edit. */
  edited: Set<string>
  /** Conversation count per block id, for the margin pill; only when the workings are shown. */
  counts: Map<string, number> | null
  selectedId: string | null
  select: (id: string) => void
  save: (block: DocBlock, text: string) => Promise<boolean>
  restore: (block: DocBlock) => Promise<boolean>
}

export const EditContext = createContext<EditContextValue | null>(null)
export const useEditContext = () => useContext(EditContext)
