import { NextResponse } from 'next/server'
import { getRouteSession } from '@/lib/auth'
import { createAdminClient, selectAll } from '@/lib/supabase-admin'
import { answerQuestion } from '@/lib/agent/answer'
import { runAsk, clipInput } from '@/lib/ask/engine'
import { extractPdfText, pageWarning, PdfTooLargeError, PdfUnreadableError } from '@/lib/ask/pdf'
import { latestRunId } from '@/lib/agent/retrieve'
import { isPlatformAdmin } from '@/lib/agent/access'
import { outcomeOf } from '@/lib/agent/types'
import { agentEnabled, AGENT_DAILY_LIMIT, AGENT_QUESTION_CHARS, ASK_PDF_MAX_BYTES } from '@/lib/config'
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

  const admin0 = createAdminClient()

  // Daily cap covers BOTH faces — one tenant, one budget. Counted on questions
  // asked, which a document check also is.
  const { count: usedToday, error: quotaErr } = await admin0
    .from('agent_messages')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('role', 'user')
    .gte('created_at', dayStartIso(new Date()))
  // Fail CLOSED. An unchecked error here made `count` undefined, which
  // evaluateQuota read as 0 — so the only spend limit in the product
  // disappeared exactly when the database was unhealthy.
  if (quotaErr) {
    console.error('[agent] quota read failed:', quotaErr)
    return NextResponse.json({ error: 'Could not start that just now. Try again shortly.' }, { status: 503 })
  }
  const cap = evaluateQuota(usedToday ?? 0, AGENT_DAILY_LIMIT)
  if (!cap.ok) return NextResponse.json({ error: cap.message }, { status: 429 })

  // ── Document mode ────────────────────────────────────────────────────────
  // A campaign or a plan, walked claim by claim. This delegates to the Ask
  // engine that already ships and is already proven on real documents — the
  // agent adds the surface and the thread, not a second engine.
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    return handleDocument(request, { clientId, userId })
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

  const admin = admin0

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
        // NO QUOTE TEXT. A stored answer carries the ids it was grounded in and
        // nothing a commenter said; the words are resolved live when the thread
        // is read. This is the same rule consumer_profiles and plan_checks
        // already keep, and the reason it matters is erasure: a verbatim copy
        // here outlives the comment it came from, escapes erase-commenter, and
        // makes the published privacy promise false. It was written that way
        // first and a fresh-eyes review caught it.
        grounded: answer.grounded.map((g) => ({
          ...g,
          quotes: g.quotes.map((q) => ({ commentId: q.commentId, videoId: q.videoId })),
        })),
        judgement: answer.judgement,
        nearest: answer.nearest,
        notice: answer.notice ?? null,
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
    //
    // But the raw message does not go to the browser either: it carried the
    // Postgres function signature, the model-written retrieval queries and the
    // OpenAI org id straight onto the page. Logged in full, reported plainly.
    // The one exception is the unbuilt-index case, which is written FOR a
    // reader and says the fault is ours.
    console.error('[agent] answer failed:', message)
    const safe = message.startsWith('This workspace has no searchable index')
      ? message
      : 'That did not work — something went wrong on our side, not in your data. Asking again is safe.'
    return NextResponse.json({ threadId: thread.id, error: safe }, { status: 500 })
  }
}

// ── Document mode ──────────────────────────────────────────────────────────
//
// Stored in plan_checks, exactly as the Ask page's checks are, with an
// agent_thread pointing at it. Two reasons for reusing that table rather than
// inventing a parallel one: the weekly re-evaluation step already re-tests
// everything in it, so a document dropped here gets "what moved" for free; and
// erase-commenter already sweeps it.
async function handleDocument(request: Request, ctx: { clientId: string; userId: string }) {
  const { clientId, userId } = ctx
  const admin = createAdminClient()

  let text = ''
  let sourceFilename: string | null = null
  let notice: string | null = null
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (file instanceof File) {
      if (file.size > ASK_PDF_MAX_BYTES) {
        return NextResponse.json({ error: 'That file is too large to read in one go.' }, { status: 413 })
      }
      sourceFilename = file.name
      const out = await extractPdfText(Buffer.from(await file.arrayBuffer()))
      text = out.text
      notice = pageWarning(out.pages)
    } else {
      text = typeof form.get('text') === 'string' ? (form.get('text') as string) : ''
    }
  } catch (e) {
    if (e instanceof PdfTooLargeError || e instanceof PdfUnreadableError) {
      return NextResponse.json({ error: e.message }, { status: 422 })
    }
    return NextResponse.json({ error: 'That document could not be read.' }, { status: 400 })
  }

  text = text.trim()
  if (text.length < 20) {
    return NextResponse.json({ error: 'There was not enough readable text in that.' }, { status: 400 })
  }
  // Store exactly what was READ. Storing more would show a reader the whole
  // document beside verdicts covering only its first part.
  const clip = clipInput(text)
  text = clip.text

  const runId = await latestRunId(admin, clientId)
  if (!runId) {
    return NextResponse.json(
      { error: 'There is no analysed conversation to check this against yet.' },
      { status: 409 },
    )
  }

  const { data: client } = await admin
    .from('clients').select('company_name').eq('id', clientId).maybeSingle()

  let result
  try {
    result = await runAsk(admin, {
      clientId,
      runId,
      kind: 'plan',
      text,
      companyName: (client?.company_name as string) ?? 'the company',
    })
  } catch (e) {
    console.error('[agent:document] failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'That document could not be checked. Try again shortly.' }, { status: 502 })
  }

  if (!result.claims.length) {
    return NextResponse.json(
      { error: 'I could not find any claims about customers or the market in that document.' },
      { status: 422 },
    )
  }

  const { data: check, error: checkErr } = await admin
    .from('plan_checks')
    .insert({
      client_id: clientId, run_id: runId, kind: 'plan',
      title: result.title || sourceFilename || null,
      input_text: text, source_filename: sourceFilename,
      claims: result.claims, summary: result.summary, judgement: result.judgement,
      created_by: userId,
    })
    .select('id')
    .single()
  if (checkErr || !check) {
    return NextResponse.json({ error: 'The check ran but could not be saved.' }, { status: 500 })
  }

  const { data: thread, error: threadErr } = await admin
    .from('agent_threads')
    .insert({
      client_id: clientId, kind: 'document',
      title: result.title || sourceFilename || 'Document',
      plan_check_id: (check as { id: string }).id,
      created_by: userId,
    })
    .select('id')
    .single()
  if (threadErr || !thread) {
    return NextResponse.json({ error: 'The check ran but could not be saved.' }, { status: 500 })
  }

  // The submission counts as a question for the daily cap and for the demand
  // log — what a client brings to be checked is a demand signal like any other.
  await admin.from('agent_messages').insert({
    thread_id: (thread as { id: string }).id,
    client_id: clientId,
    run_id: runId,
    role: 'user',
    content: sourceFilename ? `Checked: ${sourceFilename}` : 'Checked a pasted document',
  })

  return NextResponse.json({
    threadId: (thread as { id: string }).id,
    notice: clip.clipped || result.clipped
      ? 'That document was longer than I can read in one go — only the earlier part was checked.'
      : notice,
  })
}
