'use client'

import { useEffect, useRef, useState } from 'react'

/** Scales a fixed-width child (a 297 mm slide = 1123 px) to the pane it sits
 *  in with CSS zoom, so the Studio preview is the print layout, smaller. */
export function FitWidth({ base, min = 0, children }: { base: number; /** Never scale below this (the pane scrolls sideways instead). */ min?: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setZoom(Math.max(min, Math.min(1, el.clientWidth / base)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [base, min])
  return (
    <div ref={ref} className="w-full">
      <div style={{ zoom: zoom ?? 0.5, width: base }}>{children}</div>
    </div>
  )
}
