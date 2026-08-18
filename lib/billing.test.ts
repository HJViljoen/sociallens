import { describe, it, expect } from 'vitest'
import { billingAccess } from './billing'

const APPROVED = '2026-08-01T00:00:00Z'
const future = new Date(Date.now() + 5 * 86_400_000).toISOString()
const past = new Date(Date.now() - 86_400_000).toISOString()

describe('billingAccess', () => {
  it('comped tenants always have access (all four live tenants are comped)', () => {
    expect(billingAccess({ approved_at: APPROVED, is_comped: true })).toMatchObject({ hasAccess: true, reason: 'comped' })
  })
  it('a live subscription grants access; past_due keeps it during dunning', () => {
    expect(billingAccess({ approved_at: APPROVED, subscription_status: 'active' }).reason).toBe('subscribed')
    expect(billingAccess({ approved_at: APPROVED, subscription_status: 'past_due' })).toMatchObject({ hasAccess: true, reason: 'past_due' })
    expect(billingAccess({ approved_at: APPROVED, subscription_status: 'canceled' })).toMatchObject({ hasAccess: false, reason: 'none' })
  })
  it('an unexpired trial grants access with days left; an expired one does not', () => {
    expect(billingAccess({ approved_at: APPROVED, trial_ends_at: future })).toMatchObject({ hasAccess: true, reason: 'trialing' })
    expect(billingAccess({ approved_at: APPROVED, trial_ends_at: past })).toMatchObject({ hasAccess: false, reason: 'none' })
  })
  it('a never-approved signup is pending, not suspended, and gets no runs', () => {
    expect(billingAccess({ approved_at: null, is_active: false, trial_ends_at: future }))
      .toMatchObject({ hasAccess: false, reason: 'pending' })
  })
  it('deactivating an approved tenant suspends it even when comped', () => {
    expect(billingAccess({ approved_at: APPROVED, is_active: false, is_comped: true }))
      .toMatchObject({ hasAccess: false, reason: 'suspended' })
  })
  it('a row loaded without approved_at (undefined) is not treated as pending', () => {
    expect(billingAccess({ is_comped: true }).hasAccess).toBe(true)
  })
})
