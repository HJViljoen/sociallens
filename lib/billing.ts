// Single source of truth for "does this tenant have access?". Centralises the
// comp bypass so pages and the pipeline never re-implement the rule. Pure (no IO,
// no Next deps) so it's safe to import from server components and actions alike.

// Stripe statuses that grant access. `past_due` keeps access during the dunning
// grace window (Stripe retries the charge); `canceled`/`unpaid` do not.
const ACTIVE_SUB_STATUSES = new Set(['active', 'trialing', 'past_due'])

export interface BillingClient {
  is_active?: boolean | null
  is_comped?: boolean | null
  trial_ends_at?: string | null
  subscription_status?: string | null
  /** Null on a tenant that signed up but was never admitted to paid runs
   *  (T0-2, 2026-08-18). Distinct from suspension: nothing went wrong, the
   *  workspace has simply not been switched on yet. */
  approved_at?: string | null
}

export type AccessReason =
  | 'comped'      // complimentary — partners / Ossur, never billed
  | 'subscribed'  // live paid (or Stripe-trial) subscription
  | 'trialing'    // inside the built-in signup trial window
  | 'past_due'    // subscription behind on payment, still in grace
  | 'pending'     // signed up, awaiting operator approval — never yet run
  | 'suspended'   // superadmin deactivated the tenant
  | 'none'        // trial expired, no subscription → must subscribe

export interface BillingAccess {
  hasAccess: boolean
  reason: AccessReason
  trialDaysLeft?: number
}

export function billingAccess(c: BillingClient): BillingAccess {
  // Never approved outranks suspended: a new signup has not been switched off,
  // it has not been switched on. Both deny access; only the wording differs.
  if (c.approved_at === null) return { hasAccess: false, reason: 'pending' }
  if (c.is_active === false) return { hasAccess: false, reason: 'suspended' }
  if (c.is_comped) return { hasAccess: true, reason: 'comped' }

  const status = c.subscription_status ?? undefined
  if (status && ACTIVE_SUB_STATUSES.has(status)) {
    return {
      hasAccess: true,
      reason: status === 'past_due' ? 'past_due' : 'subscribed',
    }
  }

  if (c.trial_ends_at) {
    const msLeft = new Date(c.trial_ends_at).getTime() - Date.now()
    if (msLeft > 0) {
      return {
        hasAccess: true,
        reason: 'trialing',
        trialDaysLeft: Math.ceil(msLeft / 86_400_000),
      }
    }
  }

  return { hasAccess: false, reason: 'none' }
}
