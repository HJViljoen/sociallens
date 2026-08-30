'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'

// Build a WRITTEN report (T8, 2026-08-31): POST /api/reports/[id]/build
// answers 202 {buildId} and the agent works for minutes, so this control
// polls GET /api/reports/[id]/builds/[buildId] every three seconds and says
// where the build is in words, with the elapsed time. A build already in
// flight when the page loads is picked up and followed. Done → the page
// refreshes and the PDF link shows; failed → the error, plainly.

type Status = 'queued' | 'researching' | 'writing' | 'checking' | 'rendering' | 'delivering' | 'done' | 'failed'
interface BuildStatus { id: string; status: Status; phase: string; needsReview: boolean; error: string | null; artifactId: string | null; url: string | null; startedAt: string; costUsd: number }

type State =
  | { phase: 'idle' }
  | { phase: 'starting'; started: number }
  | { phase: 'busy'; buildId: string; started: number; words: string }
  | { phase: 'done'; artifactId: string | null; needsReview: boolean }
  | { phase: 'error'; message: string }

const POLL_MS = 3000

export function DocumentBuildControl({ reportId, inFlight = null, primary = true, className = '' }: { reportId: string; inFlight?: { id: string; status: Status; startedAt: string } | null; primary?: boolean; className?: string }) {
  const router = useRouter()
  const [state, setState] = useState<State>(() => (inFlight && !['done', 'failed'].includes(inFlight.status) ? { phase: 'busy', buildId: inFlight.id, started: new Date(inFlight.startedAt).getTime(), words: 'Picking up the build' } : { phase: 'idle' }))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (state.phase !== 'busy' && state.phase !== 'starting') return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [state.phase])

  // One poll loop per build id; it dies with the effect (unmount, id change,
  // StrictMode re-run) so nothing keeps fetching after the page moves on.
  const buildId = state.phase === 'busy' ? state.buildId : null
  useEffect(() => {
    if (!buildId) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        const r = await fetch(`/api/reports/${reportId}/builds/${buildId}`, { cache: 'no-store' })
        const j = (await r.json().catch(() => ({}))) as Partial<BuildStatus> & { error?: string }
        if (!alive) return
        if (!r.ok) { setState({ phase: 'error', message: j.error ?? 'Lost sight of the build. Reload the page.' }); return }
        if (j.status === 'done') { setState({ phase: 'done', artifactId: j.artifactId ?? null, needsReview: Boolean(j.needsReview) }); router.refresh(); return }
        if (j.status === 'failed') { setState({ phase: 'error', message: j.error ?? 'The build failed.' }); router.refresh(); return }
        setState((prev) => (prev.phase === 'busy' ? { ...prev, words: j.phase ?? 'Working' } : prev))
      } catch { /* transient; try again */ }
      if (alive) timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [buildId, reportId, router])

  async function start() {
    const started = Date.now()
    setState({ phase: 'starting', started })
    try {
      const r = await fetch(`/api/reports/${reportId}/build`, { method: 'POST' })
      const j = (await r.json().catch(() => ({}))) as { buildId?: string; inFlight?: boolean; error?: string }
      if ((r.status === 202 || r.status === 409) && j.buildId) {
        setState({ phase: 'busy', buildId: j.buildId, started, words: j.inFlight ? 'Picking up the build already running' : 'Queued' })
        return
      }
      setState({ phase: 'error', message: j.error ?? 'Couldn’t start the build. Try again.' })
    } catch {
      setState({ phase: 'error', message: 'Couldn’t start the build. Try again.' })
    }
  }

  const busy = state.phase === 'busy' || state.phase === 'starting'
  const elapsed = busy ? Math.max(0, Math.floor((now - (state as { started: number }).started) / 1000)) : 0
  const mm = Math.floor(elapsed / 60), ss = String(elapsed % 60).padStart(2, '0')
  const cls = primary
    ? 'bg-primary text-primary-foreground hover:bg-accent-foreground'
    : 'bg-tile text-secondary-foreground ring-1 ring-border hover:bg-inner'
  return (
    <div className={`flex flex-col items-end gap-1 ${className}`}>
      <button type="button" onClick={start} disabled={busy}
        className={`inline-flex h-[26px] items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70 ${cls}`}>
        {busy && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
        {busy ? `Building · ${mm}:${ss}` : state.phase === 'done' ? 'Build again' : 'Build'}
      </button>
      {busy && <p className="text-right text-[11.5px] text-muted-foreground" aria-live="polite">{state.phase === 'busy' ? state.words : 'Starting'}. A build takes three to five minutes.</p>}
      {state.phase === 'done' && (
        <p className="text-right text-[11.5px] text-muted-foreground" aria-live="polite">
          Built.{' '}
          {state.artifactId && <a href={`/api/artifacts/${state.artifactId}`} className="font-medium text-foreground underline underline-offset-2">Download the PDF</a>}
          {state.needsReview && <span className="block text-warning">A finding was dropped after a check against the data. Read before sending.</span>}
        </p>
      )}
      {state.phase === 'error' && <p className="text-right text-[11.5px] text-negative" aria-live="polite">{state.message}</p>}
    </div>
  )
}
