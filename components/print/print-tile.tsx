import type { ReactNode } from 'react'

// A single tile on its own, for a PNG export: the slide grid's column width
// for the tile's own span, the same row unit, no page around it. Chrome
// screenshots the [data-tile] element inside.

export function PrintTile({ children }: { children: ReactNode }) {
  return <div className="vb-print-tile p-3">{children}</div>
}
