import { inngest } from '@/inngest/client'
import { createAdminClient } from '@/lib/supabase-admin'
import { sendAlertEmail } from '@/lib/email'
import { acceptSnapshot, fetchOwnProfile, supportsOwnedProfile } from '@/lib/gather/owned'
import { billingAccess, type BillingClient } from '@/lib/billing'

// Daily owned-account snapshots (Wave 2, 2026-08-11). Runs at 05:30 SAST —
// before the 06:00 pipeline dispatcher — so a scheduled run's Step 2c always
// sees today's point. Cheap by design: one profile read per configured
// platform per client (~$0.01-0.02 IG/TT, YouTube free); posts/comments stay
// on the weekly pipeline. Snapshots pass the acceptSnapshot glitch guard
// before persisting; a platform going quiet for >2 days alerts the operator
// (silent chart staleness was the failure mode to avoid).

const STALE_DAYS_BEFORE_ALERT = 2

export const ownedSnapshotsDaily = inngest.createFunction(
  {
    id: 'owned-snapshots-daily',
    retries: 2,
    triggers: [{ cron: 'TZ=Africa/Johannesburg 30 5 * * *' }],
  },
  async ({ step }) => {
    const clients = await step.run('find-owned-clients', async () => {
      const admin = createAdminClient()
      const [{ data, error }, { data: clientRows }] = await Promise.all([
        admin.from('tracking_configs')
          .select('client_id, own_handles')
          .not('own_handles', 'eq', '{}'),
        admin.from('clients')
          .select('id, is_active, is_comped, trial_ends_at, subscription_status, approved_at'),
      ])
      if (error) throw new Error(`load own_handles: ${error.message}`)
      // Billing gate (T0-2): this cron reads paid Apify profiles every morning
      // and checked nothing at all, so a deactivated or unpaid tenant kept
      // spending daily. Same rule as the scheduler and the pipeline.
      const allowed = new Set(
        ((clientRows ?? []) as (BillingClient & { id: string })[])
          .filter((c) => billingAccess(c).hasAccess)
          .map((c) => c.id),
      )
      return ((data ?? []) as { client_id: string; own_handles: Record<string, string> }[])
        .filter((r) => {
          if (allowed.has(r.client_id)) return true
          console.log(`[owned-snapshots] skipping ${r.client_id}: no access`)
          return false
        })
        .map((r) => ({
          clientId: r.client_id,
          // Drop handles for platforms with no owned-profile concept (Reddit) —
          // otherwise this daily cron would throw for that tenant every morning.
          handles: Object.entries(r.own_handles ?? {}).filter(([p, h]) => {
            if (!h) return false
            if (!supportsOwnedProfile(p)) {
              console.log(`[owned-snapshots] skipping ${p} for ${r.client_id}: no owned-profile concept`)
              return false
            }
            return true
          }),
        }))
        .filter((r) => r.handles.length > 0)
    })

    let written = 0
    let rejected = 0
    const stale: string[] = []

    for (const { clientId, handles } of clients) {
      for (const [platform, handle] of handles) {
        // One step per (client, platform): retries isolated, failure non-fatal.
        const result = await step
          .run(`snapshot:${clientId.slice(0, 8)}:${platform}`, async () => {
            const admin = createAdminClient()
            const today = new Date().toISOString().slice(0, 10)
            const profile = await fetchOwnProfile(platform, handle, { clientId, runId: '' })

            const { data: prevRow } = await admin
              .from('account_snapshots')
              .select('followers, snapshot_date')
              .eq('client_id', clientId).eq('platform', platform)
              .not('followers', 'is', null)
              .order('snapshot_date', { ascending: false })
              .limit(1).maybeSingle()

            const verdict = acceptSnapshot((prevRow?.followers as number | null) ?? null, profile.followers)
            if (!verdict.ok) {
              return { wrote: false, reason: verdict.reason, lastDate: prevRow?.snapshot_date as string | undefined }
            }
            const { error } = await admin.from('account_snapshots').upsert({
              client_id: clientId,
              platform,
              handle,
              snapshot_date: today,
              followers: profile.followers,
              posts_count: profile.postsCount,
              metrics: null,
            }, { onConflict: 'client_id,platform,snapshot_date' })
            if (error) throw new Error(`snapshot upsert: ${error.message}`)
            return { wrote: true as const }
          })
          .catch(async (e) => {
            // A hard failure (out of retries) must not fake ">2 days stale" —
            // look up when the last accepted snapshot actually landed.
            let lastDate: string | undefined
            try {
              const admin = createAdminClient()
              const { data } = await admin
                .from('account_snapshots')
                .select('snapshot_date')
                .eq('client_id', clientId).eq('platform', platform)
                .order('snapshot_date', { ascending: false })
                .limit(1).maybeSingle()
              lastDate = (data?.snapshot_date as string | undefined) ?? undefined
            } catch { /* leave undefined — alert errs loud, not silent */ }
            return {
              wrote: false as const,
              reason: e instanceof Error ? e.message : String(e),
              lastDate,
            }
          })

        if (result.wrote) written++
        else {
          rejected++
          // Staleness tripwire: no accepted point for >2 days → operator alert.
          const last = 'lastDate' in result ? result.lastDate : undefined
          const daysSince = last ? (Date.now() - Date.parse(last)) / 86_400_000 : Infinity
          if (daysSince > STALE_DAYS_BEFORE_ALERT) stale.push(`${platform} (${clientId.slice(0, 8)}): ${result.reason}`)
        }
      }
    }

    if (stale.length > 0) {
      await step.run('alert-stale', () =>
        sendAlertEmail(
          `Verbatim owned snapshots stale — ${stale.length} platform(s)`,
          `No accepted follower snapshot for >${STALE_DAYS_BEFORE_ALERT} days:\n\n${stale.join('\n')}\n\nLikely a renamed handle or a blocked scrape — check tracking_configs.own_handles.`,
        ),
      )
    }

    return { clients: clients.length, written, rejected, stale: stale.length }
  },
)
