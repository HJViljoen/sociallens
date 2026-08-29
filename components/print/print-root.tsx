import type { ReactNode } from 'react'

// The root of anything the export renderer prints. Sets the print tokens
// (app/globals.css §Print mode) and the depth variant — (a) grey page, white
// tiles; (b) white page, hairline tiles — decided on a mock (plan D3).

export type PrintVariantStyle = 'a' | 'b'

export const DEFAULT_PRINT_STYLE: PrintVariantStyle = 'a'

export function PrintRoot({ style = DEFAULT_PRINT_STYLE, children }: { style?: PrintVariantStyle; children: ReactNode }) {
  return (
    <div className="vb-print" data-print-variant={style}>
      {children}
    </div>
  )
}

export function printStyleFrom(v: string | undefined): PrintVariantStyle {
  return v === 'b' ? 'b' : DEFAULT_PRINT_STYLE
}
