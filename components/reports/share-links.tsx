'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { revokeShareLink } from '@/app/dashboard/reports/studio/actions'

export interface ShareLinkView {
  id: string
  url: string | null
  title: string
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  protected: boolean
  views: number
  lastViewedAt: string | null
  buildAt: string
}

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** Create a link to the latest build; list every link with its views; revoke. */
export function ShareLinks({ snapshotId, links }: { snapshotId: string | null; links: ShareLinkView[] }) {
  const router = useRouter()
  const [days, setDays] = useState<'7' | '30' | '90' | 'none'>('30')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<{ url: string; protected: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  async function create() {
    if (!snapshotId) return
    setBusy(true); setError(null); setMade(null)
    try {
      const r = await fetch('/api/share', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ snapshotId, expiresDays: days === 'none' ? null : Number(days), password: password || undefined }) })
      const j = (await r.json().catch(() => ({}))) as { url?: string; protected?: boolean; error?: string }
      if (!r.ok || !j.url) { setError(j.error ?? 'Could not create the link — try again.'); return }
      setMade({ url: j.url, protected: Boolean(j.protected) })
      setPassword('')
      router.refresh()
    } catch {
      setError('Could not create the link — try again.')
    } finally {
      setBusy(false)
    }
  }
  async function copy(url: string, id: string) {
    try { await navigator.clipboard.writeText(url); setCopied(id); setTimeout(() => setCopied(null), 1500) } catch { /* clipboard blocked: the URL is on screen */ }
  }

  return (
    <div className="flex flex-col gap-4 text-[12.5px]">
      {snapshotId ? (
        <div className="flex flex-col gap-2 rounded-[4px] bg-inner px-4 py-3">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">New link to the latest build</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Expires</span>
              <select value={days} onChange={(e) => setDays(e.target.value as typeof days)} className="h-7 rounded-[4px] border border-input bg-tile px-1.5 text-[12px]">
                <option value="7">in 7 days</option><option value="30">in 30 days</option><option value="90">in 90 days</option><option value="none">never</option>
              </select>
            </label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (optional)" autoComplete="off"
              className="h-7 w-44 rounded-[4px] border border-input bg-tile px-2 text-[12px] outline-none focus-visible:border-ring" />
            <button type="button" onClick={create} disabled={busy}
              className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-accent-foreground disabled:opacity-60">
              {busy && <LoaderCircle className="size-3 animate-spin" aria-hidden />} Create link
            </button>
          </div>
          {made && (
            <p className="flex flex-wrap items-center gap-2" aria-live="polite">
              <a href={made.url} target="_blank" rel="noopener" className="font-mono text-[11.5px] underline underline-offset-2">{made.url}</a>
              <button type="button" onClick={() => copy(made.url, 'new')} className="text-muted-foreground hover:text-foreground">{copied === 'new' ? 'Copied' : 'Copy'}</button>
              {made.protected && <span className="text-muted-foreground">· password set — send it separately</span>}
            </p>
          )}
          {error && <p className="text-negative" aria-live="polite">{error}</p>}
          <p className="text-[11px] text-muted-foreground/80">Anyone with the link can read this build — no account. Figures are frozen; quoted voices are read live. Revoke any time.</p>
        </div>
      ) : (
        <p className="text-muted-foreground">Build the report first; a link points at a build.</p>
      )}
      {links.length > 0 && (
        <ul className="flex flex-col gap-2">
          {links.map((l) => {
            const dead = Boolean(l.revokedAt) || (l.expiresAt ? new Date(l.expiresAt).getTime() <= Date.now() : false)
            return (
              <li key={l.id} className={`flex flex-col gap-1 rounded-[4px] bg-inner px-4 py-2.5 ${dead ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {l.url && !dead ? <a href={l.url} target="_blank" rel="noopener" className="truncate font-mono text-[11.5px] underline underline-offset-2">{l.url}</a> : <span className="font-mono text-[11.5px] text-muted-foreground">{l.revokedAt ? 'withdrawn' : 'expired'}</span>}
                  {l.url && !dead && <button type="button" onClick={() => copy(l.url!, l.id)} className="text-muted-foreground hover:text-foreground">{copied === l.id ? 'Copied' : 'Copy'}</button>}
                  {!dead && (
                    <form action={revokeShareLink}><input type="hidden" name="id" value={l.id} /><button type="submit" className="text-muted-foreground hover:text-negative">Revoke</button></form>
                  )}
                </div>
                <p className="font-mono text-[10.5px] text-muted-foreground">
                  build of {fmt(l.buildAt)} · made {fmt(l.createdAt)} · {l.expiresAt ? `expires ${fmtDay(l.expiresAt)}` : 'no expiry'}{l.protected ? ' · password' : ''} · {l.views} view{l.views === 1 ? '' : 's'}{l.lastViewedAt ? `, last ${fmt(l.lastViewedAt)}` : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
