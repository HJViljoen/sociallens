'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, Loader2 } from 'lucide-react'
import { CrowdFigure } from '@/components/crowd-figure'

// The ask box. Client state because an answer takes tens of seconds and a form
// post that just hangs reads as broken.
//
// No instructions around it. A hint is useful for about a week and then it is
// furniture — the shape of the control says "type here and press the arrow"
// without being told, and someone who has used this for months should not have
// to read past a sentence they learned the first day.
//
// `canSend` is computed on the SERVER and passed in. When it is false the box
// is visible and disabled rather than hidden: a reader should be able to see
// what this page is and that answers live here. That one line stays, because
// it explains a STATE rather than teaching a mechanism.

export function AgentComposer({
  canSend,
  threadId,
  showFigure = false,
  placeholder = 'Ask about your customers',
}: {
  canSend: boolean
  threadId?: string
  /** The standing figure above the box — the landing state only. Inside a
   *  thread the conversation is the subject and the art would be in the way. */
  showFigure?: boolean
  placeholder?: string
}) {
  const router = useRouter()
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  // A live count, not a promise. The old copy said "an answer takes about half
  // a minute" whether or not it did; this says what is actually happening, and
  // it disappears the moment there is an answer — so it is state, not a hint
  // that outstays its usefulness.
  useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const started = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250)
    return () => clearInterval(id)
  }, [busy])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (q.length < 8) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, threadId }),
      })
      const data = (await res.json()) as { threadId?: string; error?: string }
      if (!res.ok || !data.threadId) {
        setError(data.error ?? 'That did not work. Try again shortly.')
        return
      }
      setQuestion('')
      if (threadId) router.refresh()
      else router.push(`/dashboard/agent/${data.threadId}`)
    } catch {
      setError('That did not work. Try again shortly.')
    } finally {
      setBusy(false)
    }
  }

  const ready = canSend && !busy && question.trim().length >= 8

  return (
    <div className="mx-auto w-full max-w-2xl">
      {showFigure && (
        // Standing on top of the box, the way the profile figure stands on the
        // bottom of its column. Same silhouette family as the crowd backdrop,
        // so the page reads as one world.
        <div className="flex justify-center">
          <CrowdFigure personaKey="verbatim-agent" variant="c" className="h-20 w-auto text-primary" />
        </div>
      )}

      <form onSubmit={onSubmit} className="relative">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy || !canSend}
          placeholder={canSend ? placeholder : 'Asking is switched off on this workspace'}
          aria-label="Ask about your customers"
          className="h-14 w-full rounded-full border border-border bg-card pl-6 pr-16 text-[15px] text-foreground shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!ready}
          aria-label="Ask"
          className="absolute right-2 top-2 grid size-10 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
        </button>
      </form>

      {busy && (
        <p className="mt-3 text-center text-xs text-muted-foreground tabular-nums" aria-live="polite">
          Reading the conversation · {elapsed}s
        </p>
      )}

      {error && <p className="mt-3 text-center text-sm text-clay">{error}</p>}
    </div>
  )
}
