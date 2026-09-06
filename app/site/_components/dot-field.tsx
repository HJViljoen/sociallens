'use client'

import { useEffect, useRef } from 'react'

const TOTAL = 18440
const GREENS = [1138, 5790, 11130, 17176]

// 18,440 marks, four of them green. Drawn incrementally (only the dots added
// since the last frame) over 2.6s the first time it scrolls into view; the
// whole field at once under reduced motion. Redrawn from scratch on resize.
export function DotField() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const state = { drawn: 0, w: -1 }
    let raf = 0
    let ran = false

    const geom = () => {
      const w = canvas.clientWidth || 1320
      const gap = w < 600 ? 3 : 3.6
      const perRow = Math.max(1, Math.floor(w / gap))
      return { w, gap, perRow, rows: Math.ceil(TOTAL / perRow) }
    }
    const draw = (progress: number) => {
      const dpr = window.devicePixelRatio || 1
      const g = geom()
      const h = g.rows * g.gap
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const shown = Math.floor(TOTAL * progress)
      if (state.w !== g.w || shown < state.drawn) {
        canvas.width = Math.round(g.w * dpr)
        canvas.height = Math.round(h * dpr)
        canvas.style.height = `${h}px`
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, g.w, h)
        state.drawn = 0
        state.w = g.w
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const r = g.gap < 3.5 ? 0.95 : 1.2
      ctx.fillStyle = '#C6CBD0'
      ctx.beginPath()
      for (let i = state.drawn; i < shown; i++) {
        const x = (i % g.perRow) * g.gap + g.gap / 2
        const y = Math.floor(i / g.perRow) * g.gap + g.gap / 2
        ctx.moveTo(x + r, y)
        ctx.arc(x, y, r, 0, 6.2832)
      }
      ctx.fill()
      state.drawn = shown
      for (const gi of GREENS) {
        if (gi >= shown) continue
        const x = (gi % g.perRow) * g.gap + g.gap / 2
        const y = Math.floor(gi / g.perRow) * g.gap + g.gap / 2
        const pop = Math.min(1, (shown - gi) / 900)
        ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x, y, r + 2.6 + 8, 0, 6.2832); ctx.fill()
        ctx.fillStyle = '#0E8A5F'; ctx.beginPath(); ctx.arc(x, y, r + 2.6 * pop, 0, 6.2832); ctx.fill()
        ctx.strokeStyle = 'rgba(14,138,95,.35)'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(x, y, r + 2.6 * pop + 6 * pop, 0, 6.2832); ctx.stroke()
      }
    }

    draw(reduce ? 1 : 0)
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.isIntersecting || ran) continue
        ran = true
        io.disconnect()
        if (reduce) { draw(1); return }
        const start = performance.now()
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / 2600)
          const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
          draw(eased)
          if (p < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      }
    }, { threshold: 0.35 })
    io.observe(canvas)
    let rt = 0
    const ro = new ResizeObserver(() => {
      window.clearTimeout(rt)
      rt = window.setTimeout(() => { state.w = -1; draw(ran ? 1 : 0) }, 150)
    })
    ro.observe(canvas)
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); window.clearTimeout(rt) }
  }, [])

  return <canvas ref={ref} className="dots" role="img" aria-label="18,440 marks, four of them green" />
}
