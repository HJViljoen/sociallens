import type { ReactNode } from 'react'

// The root of anything the export renderer prints. Sets the print tokens
// (app/globals.css §Print mode) and the depth variant — (c) the screen's
// ambient shadow (default, Heinrich 2026-08-29); (a) grey page, white tiles;
// (b) white page, hairline tiles.

export type PrintVariantStyle = 'a' | 'b' | 'c'

export const DEFAULT_PRINT_STYLE: PrintVariantStyle = 'c'

export function PrintRoot({ style = DEFAULT_PRINT_STYLE, children }: { style?: PrintVariantStyle; children: ReactNode }) {
  return (
    <div className="vb-print" data-print-variant={style}>
      {children}
    </div>
  )
}

export function printStyleFrom(v: string | undefined): PrintVariantStyle {
  return v === 'a' || v === 'b' ? v : DEFAULT_PRINT_STYLE
}
