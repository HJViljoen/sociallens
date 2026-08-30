import type { ReactNode } from 'react'

// The root of anything the export renderer prints. Sets the print tokens
// (app/globals.css §Print mode) and the depth variant: (b) white page,
// hairline tiles, the default since 2026-08-31 (Heinrich: some PDF viewers
// draw a printed box-shadow as an opaque grey slab); (c) the screen's
// ambient shadow; (a) grey page, white tiles.

export type PrintVariantStyle = 'a' | 'b' | 'c'

export const DEFAULT_PRINT_STYLE: PrintVariantStyle = 'b'

export function PrintRoot({ style = DEFAULT_PRINT_STYLE, children }: { style?: PrintVariantStyle; children: ReactNode }) {
  return (
    <div className="vb-print" data-print-variant={style}>
      {children}
    </div>
  )
}

export function printStyleFrom(v: string | undefined): PrintVariantStyle {
  return v === 'a' || v === 'b' || v === 'c' ? v : DEFAULT_PRINT_STYLE
}
