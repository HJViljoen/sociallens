import Link from 'next/link'
import type { BillingAccess } from '@/lib/billing'

/**
 * Workspace-state banner (Tier 0 T0-2, 2026-08-18). billingAccess() gated
 * nothing but the copy on the billing page: an expired trial kept full access
 * to the dashboard and kept drawing scheduled paid runs. The runs are stopped
 * in the scheduler and the pipeline; this is the honest in-app half of it.
 *
 * Soft by design: it explains and links, it does not lock anyone out of data
 * they already paid for.
 */
export function AccessBanner({ access }: { access: BillingAccess }) {
  if (access.hasAccess) return null

  const copy: Record<string, { title: string; body: string; cta?: string }> = {
    pending: {
      title: 'We are setting up your workspace',
      body: 'Your first update starts once we switch it on. You will get an email when it is ready.',
    },
    suspended: {
      title: 'This workspace is paused',
      body: 'Updates are not running. Reply to your last update or contact us and we will switch it back on.',
    },
    none: {
      title: 'Your trial has ended',
      body: 'Updates have stopped. Start a subscription to pick the conversation back up.',
      cta: 'Go to billing',
    },
  }
  const c = copy[access.reason] ?? copy.none

  return (
    <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
      <p className="text-sm font-semibold">{c.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{c.body}</p>
      {c.cta && (
        <Link href="/dashboard/billing" className="mt-2 inline-block cursor-pointer text-sm font-semibold text-foreground underline-offset-4 hover:underline">
          {c.cta}
        </Link>
      )}
    </div>
  )
}
