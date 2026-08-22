import Link from 'next/link'
import { getSessionContext } from '@/lib/auth'
import { AgentComposer } from '@/components/agent-composer'
import { AgentCrowdRing } from '@/components/agent-stage'
import { isPlatformAdmin } from '@/lib/agent/access'

// The Verbatim Agent — arrive with a question from your own work, get an answer
// built from what your customers actually said.
//
// No subheading explaining what the page does. The profile page lost its
// tagline in the July pass for the same reason: a description is read once and
// then it is furniture. The composer is the page, and the crowd stands round it.

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
    <div className="space-y-10">
      {/* The stage is its own box so the ring centres on the COMPOSER rather
          than on the whole scrolling page — with a thread list below, those two
          centres are not the same point and the ring would sit low. */}
      <section className="relative grid min-h-[32rem] place-items-center overflow-hidden py-10 lg:min-h-[48rem]">
        <AgentCrowdRing />
        <div className="agent-centre-in relative z-10 w-full">
          <AgentComposer canSend={canSend} showFigure />
        </div>
      </section>

      {threads.length > 0 && (
        <section className="mx-auto w-full max-w-2xl space-y-2">
          {threads.map((t) => (
            <Link
              key={t.id}
              href={`/dashboard/agent/${t.id}`}
              className="flex items-baseline justify-between gap-3 rounded-lg border border-border/60 px-4 py-3 transition-colors hover:bg-muted/40"
            >
              <span className="text-sm text-foreground">{t.title ?? 'Untitled'}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            </Link>
          ))}
        </section>
      )}
    </div>
  )
}
