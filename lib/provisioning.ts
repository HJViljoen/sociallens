import { deriveCompetitorKeywords, ONBOARDING_MAX_VIDEOS } from './onboarding-config'
import type { Platform } from './gather/types'

/** Every platform the pipeline can store data for. Mirrors the `Platform`
 *  union in lib/gather/types, which is the type the adapters are keyed by —
 *  a value list is needed to validate operator input at runtime. */
const KNOWN_PLATFORMS: readonly Platform[] = ['tiktok', 'youtube', 'instagram', 'reddit']

// Tenant provisioning (Tier 2, 2026-08-18).
//
// Every tenant in production was stood up by hand-written SQL, and the shape
// that produces is easy to get subtly wrong in ways nothing catches until a run
// spends money: competitor_keywords left empty means gather never searches for
// the competitors you just named (the whole competitive half of the product,
// silently absent), max_videos left at the column default of 10 means the
// analysis floors leave almost nothing standing, and a tenant created active
// starts drawing paid runs on the next scheduler tick.
//
// Pure shaping + validation here, IO in scripts/provision-tenant.ts, so the
// rules are testable without a database and the same rules apply wherever a
// tenant is created.

export interface TenantSpec {
  companyName: string
  /** Words that mean "this is about the client". Defaults to the company name. */
  brandKeywords?: string[]
  competitorNames: string[]
  industryKeywords?: string[]
  platforms?: string[]
  reportEmails?: string[]
  reportDay?: string
  reportPeriod?: 'weekly' | 'monthly' | 'paused'
  maxVideos?: number
  commentDepth?: number
  plan?: string
  comped?: boolean
  /** An operator running this IS the approval. Off means the tenant is created
   *  dormant, matching what a self-serve signup gets. */
  approve?: boolean
}

/** Mirrors the tracking_configs CHECK constraints (T0-2) so a bad spec fails
 *  with a sentence instead of a raw constraint name after three writes. */
export const LIMITS = {
  maxVideos: 100,
  commentDepth: 500,
  maxComments: 1000,
  keywordsPerBucket: 15,
  reportEmails: 25,
} as const

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export function validateSpec(spec: TenantSpec): string[] {
  const errors: string[] = []
  const push = (c: boolean, m: string) => { if (c) errors.push(m) }

  push(!spec.companyName?.trim(), 'companyName is required')
  push(!spec.competitorNames?.length, 'at least one competitor is required — half the corpus is found through them, and every competitive surface reads them')
  push((spec.competitorNames ?? []).length > LIMITS.keywordsPerBucket, `at most ${LIMITS.keywordsPerBucket} competitors`)
  push((spec.industryKeywords ?? []).length > LIMITS.keywordsPerBucket, `at most ${LIMITS.keywordsPerBucket} industry keywords`)
  push((spec.brandKeywords ?? []).length > LIMITS.keywordsPerBucket, `at most ${LIMITS.keywordsPerBucket} brand keywords`)
  push((spec.reportEmails ?? []).length > LIMITS.reportEmails, `at most ${LIMITS.reportEmails} report recipients`)
  push((spec.maxVideos ?? 0) > LIMITS.maxVideos, `maxVideos must be at most ${LIMITS.maxVideos}`)
  push((spec.commentDepth ?? 0) > LIMITS.commentDepth, `commentDepth must be at most ${LIMITS.commentDepth}`)
  push(!!spec.reportDay && !DAYS.includes(spec.reportDay), `reportDay must be one of ${DAYS.join(', ')}`)

  const unknown = (spec.platforms ?? []).filter((p) => !KNOWN_PLATFORMS.includes(p as Platform))
  push(unknown.length > 0, `unknown platform(s): ${unknown.join(', ')}`)

  // Reddit is operator-enabled per the platform's own rule; flag it rather than
  // refuse, so an operator can turn it on deliberately and knowingly.
  for (const e of (spec.reportEmails ?? [])) {
    push(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e), `not an email address: ${e}`)
  }
  return errors
}

export interface ProvisionPlan {
  client: {
    company_name: string
    plan: string
    is_comped: boolean
    is_active: boolean
    approved_at: string | null
  }
  config: {
    brand_keywords: string[]
    competitor_names: string[]
    competitor_keywords: string[]
    industry_keywords: string[]
    platforms: string[]
    report_emails: string[]
    report_day: string
    report_period: string
    max_videos: number
    comment_depth: number
  }
  /** Things an operator should see before committing, not errors. */
  warnings: string[]
}

export function buildProvisionPlan(spec: TenantSpec, now = new Date()): ProvisionPlan {
  const competitorNames = (spec.competitorNames ?? []).map((s) => s.trim()).filter(Boolean)
  const brandKeywords = (spec.brandKeywords?.length ? spec.brandKeywords : [spec.companyName])
    .map((s) => s.trim()).filter(Boolean)
  // Derived, never left empty: gather searches competitor_KEYWORDS while
  // tagging matches competitor_NAMES, and nothing in the app ever wrote the
  // former, so a hand-made tenant gathered nothing about its competitors.
  const competitorKeywords = deriveCompetitorKeywords(competitorNames)

  const warnings: string[] = []
  const dropped = competitorNames.filter(
    (n) => !competitorKeywords.some((k) => k.toLowerCase() === n.toLowerCase()),
  )
  if (dropped.length) {
    warnings.push(`too short to search on, so they will tag but not gather: ${dropped.join(', ')}`)
  }
  if ((spec.platforms ?? []).includes('reddit')) {
    warnings.push('reddit is enabled: it is a degradable, operator-enabled platform and spends on every run')
  }
  if (!spec.reportEmails?.length) {
    warnings.push('no recipients: the default schedule will email nobody')
  }
  if (spec.approve) {
    warnings.push('approved and active: the scheduler will pick this tenant up on its next report_day')
  }

  return {
    client: {
      company_name: spec.companyName.trim(),
      plan: spec.plan ?? 'design_partner',
      is_comped: spec.comped ?? true,
      is_active: Boolean(spec.approve),
      approved_at: spec.approve ? now.toISOString() : null,
    },
    config: {
      brand_keywords: brandKeywords,
      competitor_names: competitorNames,
      competitor_keywords: competitorKeywords,
      industry_keywords: (spec.industryKeywords ?? []).map((s) => s.trim()).filter(Boolean),
      platforms: spec.platforms ?? ['tiktok', 'youtube', 'instagram'],
      report_emails: (spec.reportEmails ?? []).map((s) => s.trim()).filter(Boolean),
      report_day: spec.reportDay ?? 'sunday',
      // Paused by default: a new tenant should produce its first read when an
      // operator asks for it, not whenever the next scheduler tick lands.
      report_period: spec.reportPeriod ?? 'paused',
      max_videos: spec.maxVideos ?? ONBOARDING_MAX_VIDEOS,
      comment_depth: spec.commentDepth ?? 50,
    },
    warnings,
  }
}
