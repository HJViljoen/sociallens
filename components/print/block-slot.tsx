'use client'

import type { ReactNode } from 'react'
import { useEditContext } from '@/components/documents/edit-context'
import { BlockEditor } from '@/components/documents/block-editor'
import type { DocBlock } from '@/lib/reports/documents/types'

/** The seam between the printed page and the editor (S7, 2026-08-31): the
 *  deck wraps each editable block in one of these. On paper and on a share
 *  page there is no editor, so it is the block as rendered; in the Studio
 *  the block becomes editable in place, at its own size. */
export function BlockSlot({ block, textClass, children }: { block: DocBlock; textClass: string; children: ReactNode }) {
  const ctx = useEditContext()
  if (!ctx) return <>{children}</>
  return <BlockEditor block={block} textClass={textClass}>{children}</BlockEditor>
}
