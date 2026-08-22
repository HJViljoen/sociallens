import Link from 'next/link'
import { getSessionContext } from '@/lib/auth'
import { Card, CardContent } from '@/components/ui/card'
import { AgentComposer } from '@/components/agent-composer'
import { isPlatformAdmin } from '@/lib/agent/access'

// The Verbatim Agent — arrive with a question from your own work, get an answer
// built from what your customers actually said.
//
// The unit is the THREAD, not the page: each conversation gets its own URL, so
// an answer can be sent to someone who was not in the room and re-read later.
// Same reasoning as the plan checks next door.

interface ThreadRow {
  id: string
  kind: string
  title: string | null
  created_at: string
}

export default async function AgentPage() {
  const { supabase, clientId, userId } = await getSessionContext()
  // Computed server-side and passed down — never a client-side check.
  const canSend = await isPlatformAdmin(userId)

  const { data: rows } = await supabase
    .from('agent_threads')
    .select('id, kind, title, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(30)
  const threads = (rows ?? []) as ThreadRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Verbatim Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask about your customers and get an answer drawn from what they actually said, with the
          conversations behind it. When we have nothing on something, it says so.
        </p>
      </div>

      <Card>
        <CardContent className="py-5">
          <AgentComposer canSend={canSend} />
        </CardContent>
      </Card>

      {threads.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Earlier questions</h2>
          <ul className="space-y-2">
            {threads.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/dashboard/agent/${t.id}`}
                  className="flex items-baseline justify-between gap-3 rounded-lg border border-border/60 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <span className="text-sm text-foreground">{t.title ?? 'Untitled'}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        // Reason-specific, not a generic "no data" — the two situations read
        // very differently to whoever is standing here.
        <p className="text-sm text-muted-foreground">
          {canSend
            ? 'Nothing asked yet. A good first question is one you already have — something you would otherwise decide on instinct.'
            : 'No questions have been asked on this workspace yet.'}
        </p>
      )}
    </div>
  )
}
