'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileUp, Loader2 } from 'lucide-react'

// The one interactive surface in the product besides the Voice filters.
// Everything else here is server-rendered; this needs client state because a
// check takes ~30s and a form post that just hangs reads as broken.

export function AskForm() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function send(body: BodyInit, headers?: HeadersInit) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/ask', { method: 'POST', body, headers })
      const data = (await res.json()) as { id?: string; error?: string; notice?: string | null }
      if (!res.ok || !data.id) {
        setError(data.error ?? 'That did not work. Try again shortly.')
        return
      }
      // The notice says part of the document was not read. Carried into the
      // result page rather than dropped — a reader must never be shown verdicts
      // over part of a document without being told it was part.
      const qs = data.notice ? `?notice=${encodeURIComponent(data.notice)}` : ''
      router.push(`/dashboard/ask/${data.id}${qs}`)
    } catch {
      setError('That did not work. Try again shortly.')
    } finally {
      setBusy(false)
    }
  }

  async function onSubmitText(e: React.FormEvent) {
    e.preventDefault()
    if (text.trim().length < 20) {
      setError('Give me a bit more to work with.')
      return
    }
    await send(JSON.stringify({ kind: text.trim().length > 400 ? 'plan' : 'idea', text }), {
      'content-type': 'application/json',
    })
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.set('file', file)
    form.set('kind', 'plan')
    await send(form)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <form onSubmit={onSubmitText} className="space-y-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        rows={5}
        placeholder="Tell me what you believe about your buyers, or paste a plan. I'll check each claim against what people actually said."
        className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {busy ? 'Checking' : 'Check it'}
        </button>

        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/40">
          <FileUp className="size-4" aria-hidden />
          Upload a PDF
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            onChange={onFile}
            disabled={busy}
            className="sr-only"
          />
        </label>

        <span className="text-xs text-muted-foreground">
          A plan takes about half a minute.
        </span>
      </div>
      {error && <p className="text-sm text-clay">{error}</p>}
    </form>
  )
}
