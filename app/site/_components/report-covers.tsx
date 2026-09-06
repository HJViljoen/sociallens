'use client'

import { useEffect, useRef, useState } from 'react'
import { reportCovers } from '../_data/sample'

// Five report covers. One lifts at a time on a timer while the section is in
// view; hovering, focusing or tapping a cover picks it and stops the cycle.
export function ReportCovers() {
  const [on, setOn] = useState(0)
  const [manual, setManual] = useState(false)
  const fanRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fan = fanRef.current
    if (!fan) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || manual) return
    let timer = 0
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        if (e.isIntersecting) {
          if (!timer) timer = window.setInterval(() => setOn((i) => (i + 1) % reportCovers.length), 4200)
        } else if (timer) { window.clearInterval(timer); timer = 0 }
      }
    }, { threshold: 0.3 })
    io.observe(fan)
    return () => { io.disconnect(); if (timer) window.clearInterval(timer) }
  }, [manual])

  const pick = (i: number) => { setManual(true); setOn(i) }
  const active = reportCovers[on]

  return (
    <>
      <div className="fan" ref={fanRef}>
        {reportCovers.map((c, i) => (
          <div
            key={c.title}
            className={`cover${i === on ? ' on' : ''}`}
            tabIndex={0}
            onMouseEnter={() => pick(i)}
            onFocus={() => pick(i)}
            onClick={() => pick(i)}
          >
            <div>
              <div className="ct">{c.title}</div>
              <div className="for">{c.audience}</div>
            </div>
            <div className="tiles">
              {c.tiles.map((t, j) => <i key={j} className={t || undefined} />)}
            </div>
            <div className="foot">
              <span>{c.sections} {c.sections === 1 ? 'section' : 'sections'}</span>
              <span>{c.pages} pages</span>
            </div>
          </div>
        ))}
      </div>
      <p className="sending">
        {active.send.before}<b>{active.send.bold}</b>{active.send.after}
      </p>
    </>
  )
}
