/**
 * Stand up a tenant (Tier 2, 2026-08-18).
 *
 * Every tenant in production was created by hand-written SQL, which is how
 * `competitor_keywords` came to be empty on every one of them: gather searches
 * that column while tagging matches `competitor_names`, so a hand-made tenant
 * gathered nothing about the competitors it had just named, silently, forever.
 * The same hand path leaves `max_videos` at the column default of 10 — too thin
 * for the analysis floors to leave anything standing — and creates tenants
 * active, so the next scheduler tick starts spending on them.
 *
 * DRY RUN BY DEFAULT. Nothing is written without --commit.
 *
 * Usage:
 *   npx tsx scripts/provision-tenant.ts \
 *     --name "Dagne Dover" \
 *     --competitors "Away,Beis,Calpak" \
 *     --industry "work bag,laptop bag,commuter backpack" \
 *     --emails "hello@dagnedover.com" \
 *     [--platforms tiktok,youtube,instagram] [--max-videos 30] [--day sunday]
 *     [--period paused|weekly|monthly] [--approve] [--invite owner@brand.com]
 *     [--commit]
 */
import { randomBytes } from 'crypto'
import { createAdminClient } from '../lib/supabase-admin'
import { buildProvisionPlan, validateSpec, type TenantSpec } from '../lib/provisioning'

const csv = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

function parseArgs(argv: string[]): { spec: TenantSpec; commit: boolean; invite?: string } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const spec: TenantSpec = {
    companyName: get('--name') ?? '',
    competitorNames: csv(get('--competitors')),
    industryKeywords: csv(get('--industry')),
    brandKeywords: csv(get('--brand')),
    platforms: csv(get('--platforms')).length ? csv(get('--platforms')) : undefined,
    reportEmails: csv(get('--emails')),
    reportDay: get('--day'),
    reportPeriod: get('--period') as TenantSpec['reportPeriod'],
    maxVideos: get('--max-videos') ? Number(get('--max-videos')) : undefined,
    commentDepth: get('--comment-depth') ? Number(get('--comment-depth')) : undefined,
    plan: get('--plan'),
    approve: argv.includes('--approve'),
  }
  return { spec, commit: argv.includes('--commit'), invite: get('--invite') }
}

async function main() {
  const { spec, commit, invite } = parseArgs(process.argv.slice(2))

  const errors = validateSpec(spec)
  if (errors.length) {
    console.error('Cannot provision:')
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  const plan = buildProvisionPlan(spec)

  console.log(`\n${commit ? 'PROVISIONING' : 'DRY RUN (add --commit to write)'}: ${plan.client.company_name}\n`)
  console.log('  client')
  for (const [k, v] of Object.entries(plan.client)) console.log(`    ${k.padEnd(18)} ${v}`)
  console.log('  tracking_config')
  for (const [k, v] of Object.entries(plan.config)) {
    console.log(`    ${k.padEnd(18)} ${Array.isArray(v) ? (v.length ? v.join(', ') : '(empty)') : v}`)
  }
  if (plan.warnings.length) {
    console.log('\n  worth knowing')
    for (const w of plan.warnings) console.log(`    ! ${w}`)
  }

  if (!commit) {
    console.log('\nNothing written.')
    return
  }

  const admin = createAdminClient()

  // Refuse to create a second tenant with the same name — the usual way a
  // re-run of this command produces a confusing duplicate.
  const { data: existing } = await admin
    .from('clients').select('id').ilike('company_name', plan.client.company_name).maybeSingle()
  if (existing) {
    console.error(`\nA client named "${plan.client.company_name}" already exists (${existing.id}). Refusing to create a second.`)
    process.exit(1)
  }

  const { data: client, error: cErr } = await admin
    .from('clients').insert(plan.client).select('id').single()
  if (cErr || !client) throw new Error(`create client: ${cErr?.message}`)
  const clientId = client.id as string

  const { error: cfgErr } = await admin
    .from('tracking_configs').insert({ client_id: clientId, ...plan.config })
  if (cfgErr) throw new Error(`create tracking_config: ${cfgErr.message}`)

  let inviteUrl: string | null = null
  if (invite) {
    const token = randomBytes(24).toString('base64url')
    const { error: invErr } = await admin.from('invitations').insert({
      client_id: clientId, email: invite.toLowerCase(), role: 'owner', token,
    })
    if (invErr) console.error(`  invite NOT created: ${invErr.message}`)
    else inviteUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.verbatimintel.com').replace(/\/$/, '')}/invite/${token}`
  }

  console.log(`\nCreated. client_id = ${clientId}`)
  if (inviteUrl) console.log(`Owner invite: ${inviteUrl}`)
  console.log(
    plan.client.is_active
      ? `\nActive. The scheduler will run it on ${plan.config.report_day} if report_period is not 'paused'.`
      : `\nDormant (is_active=false, approved_at null). Nothing will run until you approve it.`,
  )
  console.log(`First read on demand:\n  POST /api/admin/trigger-run  {"clientId":"${clientId}"}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
