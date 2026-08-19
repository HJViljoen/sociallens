import { readFileSync } from 'node:fs'
import { createAdminClient } from '../lib/supabase-admin'
import { runAsk } from '../lib/ask/engine'
import { reevaluatePlanChecks } from '../lib/ask/reevaluate'

// Ask-engine operator lever (2026-08-19).
//
// Runs a plan or an idea against a client's mined conversation and prints the
// three registers separately, so the separation can be SEEN rather than
// trusted. Dry by default — it costs model calls but writes nothing.
//
//   node --env-file=.env.local --import tsx scripts/ask.ts \
//     --client <uuid> --file plan.md
//   … --text "buyers care most about price"     (an idea instead of a file)
//   … --kind idea|plan                          (default: plan for --file)
//   … --run <uuid>                              (default: newest closed run)
//   … --write                                   (store it as a plan_check)

interface Args {
  clientId: string | null
  runId: string | null
  file: string | null
  text: string | null
  kind: 'idea' | 'plan' | null
  write: boolean
  reevaluate: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { clientId: null, runId: null, file: null, text: null, kind: null, write: false, reevaluate: false }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    if (argv[i] === '--client') args.clientId = next()
    else if (argv[i] === '--run') args.runId = next()
    else if (argv[i] === '--file') args.file = next()
    else if (argv[i] === '--text') args.text = next()
    else if (argv[i] === '--kind') args.kind = next() as 'idea' | 'plan'
    else if (argv[i] === '--write') args.write = true
    else if (argv[i] === '--reevaluate') args.reevaluate = true
  }
  return args
}

const VERDICT_MARK: Record<string, string> = {
  echoes: 'ECHOES     ',
  contradicts: 'CONTRADICTS',
  silent: 'SILENT     ',
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.clientId || (!args.file && !args.text && !args.reevaluate)) {
    console.error('usage: --client <uuid> (--file <path> | --text "...") [--kind idea|plan] [--run <uuid>] [--write]')
    process.exit(1)
  }
  const admin = createAdminClient()

  const { data: client } = await admin.from('clients').select('company_name').eq('id', args.clientId).maybeSingle()
  if (!client) {
    console.error(`no client ${args.clientId}`)
    process.exit(1)
  }
  const companyName = (client as { company_name: string }).company_name

  let runId = args.runId
  if (!runId) {
    const { data: run } = await admin
      .from('pipeline_runs')
      .select('id')
      .eq('client_id', args.clientId)
      .in('status', ['completed', 'partial'])
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (!run) {
      console.error('no completed run for this client')
      process.exit(1)
    }
    runId = (run as { id: string }).id
  }

  if (args.reevaluate) {
    // Re-test every stored check against this run — what the pipeline does
    // each week, run by hand so the diff can be seen.
    const results = await reevaluatePlanChecks(admin, {
      clientId: args.clientId,
      runId,
      runDate: new Date().toISOString().slice(0, 10),
      companyName,
    })
    console.log(`\nre-evaluated ${results.length} check(s) against run ${runId}\n`)
    for (const r of results) {
      console.log(`— ${r.title ?? r.planCheckId}`)
      console.log(`  now: ${r.summary.supported} supported · ${r.summary.contradicted} contradicted · ${r.summary.untested} untested  ($${r.costUsd.toFixed(4)})`)
      if (!r.moved.length) console.log('  nothing moved since the last reading')
      for (const m of r.moved) console.log(`  MOVED [${m.ref}] ${m.from} -> ${m.to} — ${m.claim}`)
      console.log('')
    }
    return
  }

  const text = args.file ? readFileSync(args.file, 'utf8') : (args.text as string)
  const kind = args.kind ?? (args.file ? 'plan' : 'idea')

  console.log(`\n${companyName} · run ${runId} · ${kind}`)
  console.log(args.write ? 'MODE: write\n' : 'MODE: dry run (nothing will be written)\n')

  const r = await runAsk(admin, { clientId: args.clientId, runId, kind, text, companyName, persist: args.write })

  console.log(`title: ${r.title || '(none)'}`)
  if (r.clipped) console.log('NOTE: the document was longer than the read limit and was clipped.')
  console.log(
    `\n${r.summary.supported} supported · ${r.summary.contradicted} contradicted · ${r.summary.untested} untested   ($${r.costUsd.toFixed(4)})\n`,
  )

  console.log('— GROUNDED —')
  for (const c of r.claims) {
    console.log(`${VERDICT_MARK[c.verdict]} [${c.ref}] ${c.claim}`)
    if (c.theySay) console.log(`            they say: ${c.theySay}`)
    if (c.conversationCount) {
      console.log(`            ${c.conversationCount} conversations · ${c.themeRefs.map((t) => t.label).join(' · ')}`)
    }
  }

  console.log('\n— JUDGEMENT (the AI\'s own proposals, not evidence) —')
  if (!r.judgement.length) console.log('(none)')
  for (const j of r.judgement) {
    console.log(`• ${j.text}${j.basedOnRefs.length ? `   [from ${j.basedOnRefs.join(', ')}]` : ''}`)
  }

  if (args.write) {
    const { data, error } = await admin
      .from('plan_checks')
      .insert({
        client_id: args.clientId,
        run_id: runId,
        kind,
        title: r.title || null,
        input_text: text,
        source_filename: args.file ?? null,
        claims: r.claims,
        summary: r.summary,
        judgement: r.judgement,
      })
      .select('id')
      .single()
    if (error) {
      console.error('\nwrite failed:', (error as { message?: string }).message ?? error)
      process.exit(1)
    }
    console.log(`\nwritten: plan_checks ${(data as { id: string }).id}`)
  }
  console.log('')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
