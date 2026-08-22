import { NextResponse } from 'next/server'
import { getRouteSession } from '@/lib/auth'
import { createAdminClient, selectAll } from '@/lib/supabase-admin'
import { answerQuestion } from '@/lib/agent/answer'
import { isPlatformAdmin } from '@/lib/agent/access'
import { outcomeOf } from '@/lib/agent/types'
import { agentEnabled, AGENT_DAILY_LIMIT, AGENT_QUESTION_CHARS } from '@/lib/config'
import { dayStartIso, evaluateQuota } from '@/lib/ask/quota'

// POST /api/agent — ask the Verbatim Agent a question.
//
// A route handler, not a server action: this will grow a document upload, and
// server actions cap a request body at 1 MB. No dot anywhere in the path —
// proxy.ts skips any path whose last segment contains one, and would skip the
// auth check with it.
//
// The tenant comes from the SESSION and never from the body. A request cannot
// ask about someone else's conversation by naming their client id.

export const runtime = 'nodejs'
// One cheap interpret call plus one synthesis call. gpt-5.4 has been measured
// at 165-237s for large pipeline prompts; an agent prompt is far smaller, but
// the ceiling stays generous so a slow answer fails as an answer, not a crash.
export const maxDuration = 300

export async function POST(request: Request) {
  if (!agentEnabled()) {
    return NextResponse.json({ error: 'Not available yet.' }, { status: 404 })
  }
  const session = await getRouteSession()
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  const { clientId, userId } = session

  // Send is operator-only for now (2026-08-22). Everyone in the tenant can read
  // the threads; only a platform admin may spend a model call.
  if (!(await isPlatformAdmin(userId))) {
    return NextResponse.json(
      { error: 'The agent is read-only on this workspace for now. You can read every answer here, but asking is switched off while we are still testing it.' },
      { status: 403 },
    )
  }

  let body: { question?: unknown; threadId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Could not read that request.' }, { status: 400 })
  }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) {
    return NextResponse.json({ error: 'Ask a question first.' }, { status: 400 })
  }
  if (question.length > AGENT_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `That is longer than a question — if it is a plan or a brief, the document check is the right tool for it.` },
      { status: 400 },
    )
  }
  const threadId = typeof body.threadId === 'string' ? body.threadId : null

  const admin = createAdminClient()

  const { count } = await admin
    .from('agent_messages')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('role', 'user')
    .gte('created_at', dayStartIso(new Date()))
  const quota = evaluateQuota(count ?? 0, AGENT_DAILY_LIMIT)
  if (!quota.ok) {
    return NextResponse.json({ error: quota.message }, { status: 429 })
  }

  const { data: client } = await admin
    .from('clients').select('company_name').eq('id', clientId).maybeSingle()
  const companyName = (client?.company_name as string | undefined) ?? 'the company'

  // Continue a thread only if it belongs to this tenant. A thread id in a body
  // is user input like any other.
  let thread: { id: string } | null = null
  let history: { role: 'user' | 'agent'; content: string }[] = []
  if (threadId) {
    const { data } = await admin
      .from('agent_threads').select('id').eq('id', threadId).eq('client_id', clientId).maybeSingle()
    if (data) {
      thread = data as { id: string }
      const prior = await selectAll<{ role: string; content: string }>(() =>
        admin.from('agent_messages').select('role, content')
          .eq('thread_id', (data as { id: string }).id)
          .order('created_at', { ascending: true }),
      )
      history = prior.map((p) => ({ role: p.role === 'user' ? 'user' : 'agent', content: p.content }))
    }
  }

  if (!thread) {
    const { data, error } = await admin
      .from('agent_threads')
      .insert({
        client_id: clientId,
        kind: 'question',
        // The question is the title. Trimmed for the list, never for the log.
        title: question.length > 90 ? `${question.slice(0, 87)}…` : question,
        created_by: userId,
      })
      .select('id')
      .single()
    if (error || !data) {
      return NextResponse.json({ error: 'Could not start that conversation.' }, { status: 500 })
    }
    thread = data as { id: string }
  }

  // The question is stored BEFORE the answer is attempted, on purpose. It is a
  // demand signal in its own right, and a question that made the agent fall
  // over is one of the more interesting rows in the table.
  await admin.from('agent_messages').insert({
    thread_id: thread.id, client_id: clientId, role: 'user', content: question,
  })

  try {
    const answer = await answerQuestion(admin, {
      clientId, companyName, question, history, allowNearest: true,
    })
    await admin.from('agent_messages').insert({
      thread_id: thread.id,
      client_id: clientId,
      run_id: answer.runId,
      role: 'agent',
      content: answer.answer,
      result: {
        answer: answer.answer,
        grounded: answer.grounded,
        judgement: answer.judgement,
        nearest: answer.nearest,
        silent: answer.silent,
        retrievedCount: answer.retrievedCount,
        intent: answer.plan.intent,
        timeframe: answer.plan.timeframe,
      },
      outcome: outcomeOf(answer),
      cost_usd: answer.costUsd,
    })
    return NextResponse.json({ threadId: thread.id, answer })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // The failure is NOT written as a silent answer. "Nothing relates to this"
    // is a claim about the corpus, and a broken call must never wear it.
    return NextResponse.json({ threadId: thread.id, error: message }, { status: 500 })
  }
}
