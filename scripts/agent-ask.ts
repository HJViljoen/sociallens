import { createAdminClient } from '../lib/supabase-admin'
import { answerQuestion } from '../lib/agent/answer'
import { outcomeOf } from '../lib/agent/types'

// Ask the Verbatim Agent from the terminal, without a browser session.
//
//   node --env-file=.env.local --import tsx scripts/agent-ask.ts --client <uuid> "your question"
//
// Nothing is persisted by default (--persist logs the model calls to
// ai_call_log; no thread or message row is ever written from here) so this can
// be run against a real tenant while iterating on prompts.
//
// It prints wall-clock and cost per question, which is the measurement the
// build plan gates the streaming decision on: if a turn is slow enough that a
// spinner is dishonest, the answer is a faster model or streaming, and that is
// a decision to take on numbers rather than on taste.

interface Args { clientId: string | null; question: string; persist: boolean }

function parseArgs(argv: string[]): Args {
  const args: Args = { clientId: null, question: '', persist: false }
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--client') args.clientId = argv[++i]
    else if (argv[i] === '--persist') args.persist = true
    else rest.push(argv[i])
  }
  args.question = rest.join(' ').trim()
  if (!args.clientId) throw new Error('--client <uuid> is required')
  if (!args.question) throw new Error('give me a question')
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const admin = createAdminClient()

  const { data: client } = await admin
    .from('clients').select('company_name').eq('id', args.clientId).maybeSingle()
  const companyName = (client?.company_name as string | undefined) ?? 'the company'

  const started = Date.now()
  const answer = await answerQuestion(admin, {
    clientId: args.clientId!,
    companyName,
    question: args.question,
    allowNearest: true,
    persist: args.persist,
  })
  const elapsed = Date.now() - started

  console.log(`\nQ: ${args.question}`)
  console.log(`   ${companyName} · run ${answer.runId.slice(0, 8)} · ${(elapsed / 1000).toFixed(1)}s · $${answer.costUsd.toFixed(4)} · ${outcomeOf(answer)}`)
  console.log(`   intent=${answer.plan.intent} timeframe=${answer.plan.timeframe} retrieved=${answer.retrievedCount}`)
  console.log(`   queries: ${answer.plan.retrievalQueries.map((q) => `"${q}"`).join(', ')}`)

  console.log(`\nANSWER\n  ${answer.answer}`)

  if (answer.grounded.length) {
    console.log('\nWHAT CUSTOMERS SAID')
    for (const g of answer.grounded) {
      console.log(`  [${g.id}] ${g.text}  (${g.conversationCount} ${g.conversationCount === 1 ? 'conversation' : 'conversations'}, ${g.insightIds.length} ${g.insightIds.length === 1 ? 'finding' : 'findings'})`)
      for (const q of g.quotes.slice(0, 2)) console.log(`      "${q.text}"`)
    }
  }
  if (answer.nearest.length) {
    console.log('\nNOT WHAT YOU ASKED, BUT CLOSE')
    for (const n of answer.nearest) console.log(`  ${n.text}  (${n.conversationCount} conversations)`)
  }
  if (answer.judgement.length) {
    console.log('\nMY READING (not evidence)')
    for (const j of answer.judgement) console.log(`  ${j.text}${j.basedOn.length ? `  ← ${j.basedOn.join(', ')}` : '  ← ungrounded'}`)
  }
  if (answer.silent) console.log('\n(silent — nothing in the corpus relates to this)')
  console.log()
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
