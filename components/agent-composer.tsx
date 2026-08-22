'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

// The ask box. Client state because an answer takes tens of seconds and a form
// post that just hangs reads as broken.
//
// `canSend` is computed on the SERVER and passed in. When it is false the box
// is visible and disabled rather than hidden — a reader should be able to see
// what this page is and that answers live here, and be told plainly why they
// cannot ask yet. A missing feature is confusing; a disabled one is honest.

export function AgentComposer({
  canSend,
  threadId,
  placeholder = 'Ask about your customers — a question you actually have, in your own words.',
}: {
  canSend: boolean
  threadId?: string
  placeholder?: string
}) {
  const router = useRouter()
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (q.length < 8) {
      setError('Give me a bit more to work with.')
      return
    }
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

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        disabled={busy || !canSend}
        rows={3}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || !canSend}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {busy ? 'Reading the conversation' : threadId ? 'Ask a follow-up' : 'Ask'}
        </button>
        <span className="text-xs text-muted-foreground">
          {canSend
            ? 'An answer takes about half a minute.'
            : 'Asking is switched off on this workspace while we are still testing. Every answer below is readable.'}
        </span>
      </div>
      {error && <p className="text-sm text-clay">{error}</p>}
    </form>
  )
}
