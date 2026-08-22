import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSessionContext } from '@/lib/auth'
import { Card, CardContent } from '@/components/ui/card'
import { AgentComposer } from '@/components/agent-composer'
import { AgentAnswerView } from '@/components/agent-answer'
import { isPlatformAdmin } from '@/lib/agent/access'
import type { AgentAnswer } from '@/lib/agent/types'

// One thread, at its own URL. The whole exchange, oldest first, so it reads as
// the conversation it was rather than as a list of results.

interface MessageRow {
  id: string
  role: string
  content: string
  result: AgentAnswer | null
  outcome: string | null
  created_at: string
}

export default async function AgentThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, clientId, userId } = await getSessionContext()
  const canSend = await isPlatformAdmin(userId)

  // RLS already scopes to the tenant; the explicit client_id filter makes a
  // cross-tenant id a 404 rather than an empty page.
  const { data: thread } = await supabase
    .from('agent_threads')
    .select('id, title, created_at')
    .eq('id', id)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!thread) notFound()

  const { data: rows } = await supabase
    .from('agent_messages')
    .select('id, role, content, result, outcome, created_at')
    .eq('thread_id', id)
    .order('created_at', { ascending: true })
  const messages = (rows ?? []) as MessageRow[]

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/agent"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All questions
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{thread.title as string}</h1>
      </div>

      <div className="space-y-5">
        {messages.map((m, i) =>
          // The heading above IS the first question — printing it again
          // directly underneath reads as a stutter. Follow-ups still show,
          // because in a thread they are the turn that changed the answer.
          m.role === 'user' && i === 0 ? null : m.role === 'user' ? (
            <p key={m.id} className="text-[15px] font-medium text-foreground">
              {m.content}
            </p>
          ) : (
            <Card key={m.id}>
              <CardContent className="py-5">
                {m.result ? (
                  <AgentAnswerView answer={m.result} />
                ) : (
                  <p className="text-[15px] leading-relaxed text-foreground">{m.content}</p>
                )}
              </CardContent>
            </Card>
          ),
        )}
        {/* A question with no answer after it: the call failed and was
            deliberately not written as a silent answer. Saying so is better
            than an exchange that just stops. */}
        {messages.length > 0 && messages[messages.length - 1].role === 'user' && (
          <p className="text-sm text-clay">
            That question did not get an answer &mdash; something went wrong on our side rather than in
            your data. Asking it again is safe.
          </p>
        )}
      </div>

      <AgentComposer canSend={canSend} threadId={id} placeholder="Push back, or narrow it down" />
    </div>
  )
}
