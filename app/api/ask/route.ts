import { NextResponse } from 'next/server'
import { getRouteSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { runAsk } from '@/lib/ask/engine'
import { extractPdfText, pageWarning, PdfTooLargeError, PdfUnreadableError } from '@/lib/ask/pdf'
import { ASK_PDF_MAX_BYTES, askEnabled } from '@/lib/config'
import { clipInput } from '@/lib/ask/engine'
import { dayStartIso, evaluateQuota } from '@/lib/ask/quota'

// POST /api/ask — check an idea or a plan against the mined conversation.
//
// A route handler rather than a server action because a server action caps its
// request body at 1 MB and this accepts a PDF. Deliberately no file extension
// anywhere in the path: proxy.ts skips any path whose last segment contains a
// dot, which would skip the auth check with it.
//
// The tenant is resolved from the SESSION, never from the body — a request
// cannot ask about someone else's conversation by naming their client id.

export const runtime = 'nodejs'
// Three model calls plus embedding and quote retrieval. Well inside this on a
// normal plan; the cap exists so a pathological document fails cleanly.
export const maxDuration = 300

export async function POST(request: Request) {
  if (!askEnabled()) {
    return NextResponse.json({ error: 'Not available yet.' }, { status: 404 })
  }
  const session = await getRouteSession()
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  const { clientId, userId } = session

  let kind: 'idea' | 'plan' = 'idea'
  let text = ''
  let sourceFilename: string | null = null
  let notice: string | null = null

  const contentType = request.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      kind = form.get('kind') === 'idea' ? 'idea' : 'plan'
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'No file was received.' }, { status: 400 })
      }
      if (file.size > ASK_PDF_MAX_BYTES) {
        return NextResponse.json(
          { error: `That file is ${Math.round(file.size / 1e6)}MB. The limit is ${Math.round(ASK_PDF_MAX_BYTES / 1e6)}MB — paste the text instead for anything larger.` },
          { status: 413 },
        )
      }
      sourceFilename = file.name
      const extraction = await extractPdfText(new Uint8Array(await file.arrayBuffer()))
      if (extraction.imageOnly) {
        return NextResponse.json(
          { error: 'This PDF has no readable text — it looks like scans or images. Paste the text instead.' },
          { status: 422 },
        )
      }
      text = extraction.text
      notice = pageWarning(extraction.pages)
    } else {
      const body = (await request.json()) as { kind?: string; text?: string }
      kind = body.kind === 'plan' ? 'plan' : 'idea'
      text = String(body.text ?? '')
    }
  } catch (e) {
    if (e instanceof PdfTooLargeError) return NextResponse.json({ error: e.message }, { status: 413 })
    if (e instanceof PdfUnreadableError) return NextResponse.json({ error: e.message }, { status: 422 })
    return NextResponse.json({ error: 'Could not read that submission.' }, { status: 400 })
  }

  text = text.trim()
  if (text.length < 20) {
    return NextResponse.json({ error: 'Give me a bit more to work with.' }, { status: 400 })
  }
  // Store exactly what was READ, clipped code-point-safely. Storing more than
  // the engine reads would show a reader the whole document beside verdicts
  // covering only its first part, with nothing marking where the reading
  // stopped. String.slice would also split a surrogate pair and fail the insert
  // after all three calls were paid for.
  const clip = clipInput(text)
  text = clip.text

  // Service-role client for the work and the write, scoped to the tenant the
  // session resolved to — the same shape every other write in this product has.
  const admin = createAdminClient()

  // Per-tenant daily cap. This is the first endpoint where a signed-in user
  // spends real money on demand, and nothing else in the product limits it.
  const { count: usedToday } = await admin
    .from('plan_checks')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('created_at', dayStartIso(new Date()))
  const quota = evaluateQuota(usedToday ?? 0)
  if (!quota.ok) {
    return NextResponse.json({ error: quota.message }, { status: 429 })
  }

  const { data: client } = await admin
    .from('clients').select('company_name').eq('id', clientId).maybeSingle()

  const { data: latestRun } = await admin
    .from('pipeline_runs').select('id')
    .eq('client_id', clientId).in('status', ['completed', 'partial'])
    .order('started_at', { ascending: false }).limit(1).maybeSingle()

  if (!latestRun) {
    return NextResponse.json(
      { error: 'There is no analysed conversation to check this against yet. This works once your first update lands.' },
      { status: 409 },
    )
  }

  let result
  try {
    result = await runAsk(admin, {
      clientId,
      runId: latestRun.id as string,
      kind,
      text,
      companyName: (client?.company_name as string) ?? 'the client',
    })
  } catch (e) {
    console.error('[ask] failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'The check could not be completed. Try again shortly.' }, { status: 502 })
  }

  if (!result.claims.length) {
    return NextResponse.json(
      { error: 'I could not find any claims about customers or the market in that. Try stating what you believe to be true about your buyers.' },
      { status: 422 },
    )
  }

  const { data, error } = await admin
    .from('plan_checks')
    .insert({
      client_id: clientId,
      run_id: latestRun.id as string,
      kind,
      title: result.title || null,
      input_text: text,
      source_filename: sourceFilename,
      claims: result.claims,
      summary: result.summary,
      judgement: result.judgement,
      created_by: userId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[ask] write failed:', (error as { message?: string }).message ?? error)
    return NextResponse.json({ error: 'The check ran but could not be saved.' }, { status: 500 })
  }

  return NextResponse.json({
    id: (data as { id: string }).id,
    summary: result.summary,
    notice: clip.clipped || result.clipped
      ? 'That document was longer than I can read in one go — only the earlier part was checked.'
      : notice,
  })
}
