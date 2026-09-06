'use client'

import { useEffect, useRef, type ReactNode } from 'react'

// Adds `is-on` to its wrapper the first time it scrolls into view. The CSS in
// site.css does the animating (bars grow, tiles fade in); under reduced motion
// the same rules resolve instantly. One IntersectionObserver per wrapper,
// disconnected after it fires.
export function Reveal({ className, threshold = 0.4, children }: { className?: string; threshold?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add('is-on')
            io.disconnect()
          }
        }
      },
      { threshold },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
