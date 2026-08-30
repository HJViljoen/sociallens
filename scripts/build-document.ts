/**
 * Build a document report for one workspace from the command line — the
 * Session 1 gate for the Sales brief: judge the voice on paper before the
 * Studio has a button for it.
 *
 *   node --env-file=.env.local --import tsx scripts/build-document.ts --client <id> [--template sales_brief]
 *     [--sells-to professionals] [--signals] [--questions] [--research] [--out scratch/document]
 *
 *   --signals    read the update and print the researcher's signals, no model calls
 *   --questions  also print the questions the researcher would ask (no calls)
 *   --research   ask them (agent calls, billed) and write answers.json
 *   (default)    the whole build: research, write, snapshot, PDF into --out
 *
 * Össur is the default client, as in the other per-client scripts.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createAdminClient } from '../lib/supabase-admin'
import { documentSettings, type SellsTo } from '../lib/reports/documents/types'
import { documentTemplate } from '../lib/reports/documents/templates'
import { loadSignals } from '../lib/reports/documents/signals'

const OSSUR = 'e52cac94-30e1-426a-9a36-31b11e0b30b6'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (name: string) => args.includes(`--${name}`)
for (const a of args) {
  if (!a.startsWith('--')) continue
  if (!['client', 'template', 'sells-to', 'signals', 'questions', 'research', 'out', 'run', 'keep', 'no-check'].includes(a.slice(2))) throw new Error(`unknown flag: ${a}`)
}

async function main() {
  const clientId = flag('client') ?? OSSUR
  const template = documentTemplate(flag('template') ?? 'sales_brief')
  if (!template) throw new Error(`unknown template: ${flag('template')}`)
  const settings = documentSettings({ sellsTo: (flag('sells-to') as SellsTo | undefined) ?? 'consumers' })
  const out = flag('out') ?? 'scratch/document'
  mkdirSync(out, { recursive: true })
  const admin = createAdminClient()

  const t0 = Date.now()
  const signals = await loadSignals(admin, { clientId, runId: flag('run') ?? null, settings })
  console.log(`signals: ${Date.now() - t0} ms · run ${signals.runId.slice(0, 8)} (${signals.runStatus}, ${signals.runDate}) · ${signals.company}`)
  console.log(`  ${signals.run.conversations} conversations on ${signals.run.videos} videos · ${signals.run.clientVideos} yours · ${signals.run.competitorVideos} competitors · ${signals.run.positivePct ?? '?'}% positive of ${signals.run.judged}`)
  console.log(`  themes ${signals.themes.length} · concerns ${signals.concerns.length} · competitors ${signals.competitors.map((c) => `${c.name} (${c.claims.length} claims, praise ${c.praise.length}, hurt ${c.hurt.length}${c.thin ? ', thin' : ''})`).join(', ') || 'none'}`)
  console.log(`  say-vs-hear ${signals.sayVsHear.length} · personas ${signals.personas.map((p) => p.name).join(', ')} · phrases ${signals.phrases.length} (${signals.heldBackPhrases} held back) · delta ${signals.delta ? 'yes' : 'no'} · updates ${signals.updatesCount}`)
  for (const c of signals.concerns) {
    console.log(`  ${c.id} ${c.label} · ${c.total} · ${c.buckets.map((b) => `${b.bucket.replace('industry-other', 'category').replace('competitor:', '')} ${b.evidenceCount}`).join(' + ')} · ${c.trajectory || '?'} · ${c.categories.join('/')}`)
  }
  writeFileSync(`${out}/signals.json`, JSON.stringify({ ...signals, themes: signals.themes.map((t) => ({ ...t, embedding: undefined })), trajectoryOf: undefined }, null, 2))
  if (has('signals')) return
  console.log('(questions, research and the build follow in the next tasks)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
