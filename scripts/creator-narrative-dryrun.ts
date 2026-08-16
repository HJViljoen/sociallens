import { createAdminClient, selectAll } from '../lib/supabase-admin'
import { openai } from '../lib/openai'
import { ANALYSIS_MODEL, ANALYSIS_TEMPERATURE, estimateCost } from '../lib/config'
import { usableTranscript } from '../lib/pipeline/transcript-input'

// Creator-narrative DRY RUN — a decision gate, not a feature.
//
// The proposed creator-narrative pass (Expansion 2026-08-10, Shape C, ~$0.25-0.45/run)
// would summarise what creators SAY across a run's transcripts. Before that gets
// built, this spends ~$0.30 once to answer the only question that matters: is
// the output actually worth reading, or is it a fluent restatement of the
// transcript? Heinrich judges from the printed pairs.
//
// Writes NOTHING — no DB, no ai_call_log. It is not part of a run.
//
//   node --env-file=.env.local --import tsx scripts/creator-narrative-dryrun.ts \
//     --client <uuid> [--run <uuid>] [--limit 12] [--budget 0.35]

interface Args { clientId: string | null; runId: string | null; limit: number; budget: number }

function parseArgs(argv: string[]): Args {
  const a: Args = { clientId: null, runId: null, limit: 12, budget: 0.35 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--client') a.clientId = argv[++i]
    else if (argv[i] === '--run') a.runId = argv[++i]
    else if (argv[i] === '--limit') a.limit = Number(argv[++i])
    else if (argv[i] === '--budget') a.budget = Number(argv[++i])
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  return a
}

const SYSTEM = [
  'You analyse what CREATORS say in short-form video, for a consumer-intelligence platform.',
  '',
  'Given one video transcript, return 2-4 sentences covering:',
  '- the creator\'s actual argument or story, in their framing (not a summary of events)',
  '- what they are implicitly recommending, warning about, or selling',
  '- what it tells a brand about how this category is talked about',
  '',
  'Rules:',
  '- Ground every statement in the transcript. If it is not there, do not say it.',
  '- No restating the transcript back. If the transcript carries no argument worth reporting, say exactly: NOTHING WORTH REPORTING.',
  '- Never invent a brand, product, or claim that is not spoken.',
].join('\n')

async function main() {
  const { clientId, runId, limit, budget } = parseArgs(process.argv.slice(2))
  if (!clientId) throw new Error('--client <uuid> is required')
  const admin = createAdminClient()

  // selectAll requires a FRESH query per call — .order() appends rather than
  // replaces, so a reused builder accumulates duplicate order clauses per page.
  const buildQuery = () => {
    const q = admin
      .from('videos')
      .select('id, platform, account_name, video_url, transcript, transcript_status, is_client, is_competitor')
      .eq('client_id', clientId)
      .eq('transcript_status', 'ok')
    return (runId ? q.eq('run_id', runId) : q).order('id', { ascending: true })
  }
  const rows = await selectAll<{
    id: string; platform: string; account_name: string; video_url: string
    transcript: string | null; transcript_status: string | null
    is_client: boolean; is_competitor: boolean
  }>(buildQuery)

  // Industry creators only — the client's and competitors' own videos are brand
  // voice, which is what video_claims already covers.
  const pool = rows.filter((r) => !r.is_client && !r.is_competitor && usableTranscript(r))
  if (!pool.length) {
    console.log('No usable industry transcripts for this client/run.')
    return
  }
  const sample = pool.slice(0, limit)
  console.log(`\n${pool.length} usable industry transcripts; sampling ${sample.length}. Budget $${budget.toFixed(2)}.\n`)

  let spent = 0
  let nothing = 0
  for (const [i, v] of sample.entries()) {
    if (spent >= budget) {
      console.log(`\n[stopped at ${i}/${sample.length} — budget reached]`)
      break
    }
    const transcript = usableTranscript(v)!
    const completion = await openai.chat.completions.create({
      model: ANALYSIS_MODEL,
      temperature: ANALYSIS_TEMPERATURE,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Account: ${v.account_name}\nPlatform: ${v.platform}\n\nTRANSCRIPT:\n${transcript.slice(0, 4000)}` },
      ],
    })
    const out = completion.choices[0]?.message?.content?.trim() ?? '(no output)'
    const u = completion.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    spent += estimateCost(ANALYSIS_MODEL, u.prompt_tokens, u.completion_tokens)
    if (out.includes('NOTHING WORTH REPORTING')) nothing++

    console.log(`\n─── ${i + 1}. ${v.account_name} (${v.platform})  ${v.video_url}`)
    console.log(`    TRANSCRIPT: ${transcript.replace(/\s+/g, ' ').slice(0, 220)}…`)
    console.log(`    NARRATIVE:  ${out.replace(/\n/g, '\n                ')}`)
  }

  const perRun = sample.length ? (spent / sample.length) * pool.length : 0
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`Spent $${spent.toFixed(4)} on ${sample.length} videos.`)
  console.log(`"Nothing worth reporting": ${nothing}/${sample.length} — a high share means the pass has little to add.`)
  console.log(`Extrapolated to all ${pool.length} industry transcripts: ~$${perRun.toFixed(2)}/run.`)
  console.log(`\nJudge the pairs above: does NARRATIVE tell you something TRANSCRIPT doesn't?`)
  console.log(`If it mostly rephrases, do not build the pass.\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
