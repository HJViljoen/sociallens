'use client'

import { useEffect, useRef } from 'react'
import { murmurLines } from '../_data/sample'

// The hero's background: a field of voices that drift on their own and lean
// away from the cursor. Layout needs the container's size, so the spans are
// placed after mount from a seeded generator (the same arrangement on every
// visit). One rAF loop drives every span; it idles when the hero is off-screen
// or the tab is hidden, and everything is torn down on unmount.
export function Murmur() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const box = ref.current
    if (!box) return
    const hero = box.parentElement as HTMLElement
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const W = box.clientWidth
    const H = box.clientHeight
    let seed = 7
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }

    const cols = W < 700 ? 2 : W < 1100 ? 4 : 6
    const rows = W < 700 ? 10 : 12
    const cellW = W / cols
    const cellH = (H - 24) / rows
    const items: { el: HTMLSpanElement; depth: number; op: number; phase: number; amp: number; speed: number }[] = []
    let idx = 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rnd() < 0.14) continue
        const el = document.createElement('span')
        el.textContent = '“' + murmurLines[idx++ % murmurLines.length] + '”'
        const depth = 0.3 + rnd() * 0.7
        const size = 12 + Math.round(depth * 11)
        el.style.left = `${c * cellW + rnd() * Math.max(0, cellW - 320)}px`
        el.style.top = `${12 + r * cellH + rnd() * Math.max(0, cellH - size - 6)}px`
        el.style.fontSize = `${size}px`
        box.appendChild(el)
        items.push({ el, depth, op: 0.07 + depth * 0.22, phase: rnd() * 6.283, amp: 6 + 16 * depth, speed: 0.25 + 0.35 * (1 - depth) })
      }
    }

    const timers: number[] = []
    let raf = 0
    let live = true
    let io: IntersectionObserver | null = null
    const onMove = (e: MouseEvent) => { tx = e.clientX / W - 0.5; ty = e.clientY / H - 0.5 }
    const onLeave = () => { tx = 0; ty = 0 }
    let tx = 0, ty = 0, cx = 0, cy = 0

    if (reduce) {
      for (const it of items) it.el.style.opacity = String(it.op)
    } else {
      items.forEach((it, i) => { timers.push(window.setTimeout(() => { it.el.style.opacity = String(it.op) }, 250 + i * 28)) })
      io = new IntersectionObserver((es) => { for (const e of es) live = e.isIntersecting })
      io.observe(hero)
      hero.addEventListener('mousemove', onMove)
      hero.addEventListener('mouseleave', onLeave)
      const t0 = performance.now()
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame)
        if (!live || document.hidden) return
        cx += (tx - cx) * 0.045
        cy += (ty - cy) * 0.045
        const t = (now - t0) / 1000
        for (const it of items) {
          const dy = Math.sin(t * it.speed + it.phase) * it.amp
          const dx = Math.cos(t * it.speed * 0.7 + it.phase) * it.amp * 0.35
          it.el.style.transform = `translate3d(${(dx + cx * -90 * it.depth).toFixed(1)}px,${(dy + cy * -60 * it.depth).toFixed(1)}px,0)`
        }
      }
      raf = requestAnimationFrame(frame)
    }

    return () => {
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      io?.disconnect()
      hero.removeEventListener('mousemove', onMove)
      hero.removeEventListener('mouseleave', onLeave)
      box.replaceChildren()
    }
  }, [])

  return <div ref={ref} className="murmur" aria-hidden="true" />
}
