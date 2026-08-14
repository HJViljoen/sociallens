// Shared between the settings form (client) and its server action. Kept in a
// plain module (no 'use server'/'use client') so both sides import one source
// of truth for the allowed values + numeric bounds.

// Every platform the pipeline can store data for — the validation vocabulary.
// Reddit is here so an operator can enable it on a tenant, but see below.
export const PLATFORMS = ['tiktok', 'youtube', 'instagram', 'reddit'] as const

// What onboarding actually OFFERS. Reddit is deliberately absent: it is a
// degradable, operator-enabled platform (Wave 3) and its gather is flag-gated by
// REDDIT_ENABLED, so a self-serve checkbox would promise data we may not deliver.
// Promote it here only once the flag is on in production.
export const SELECTABLE_PLATFORMS = PLATFORMS.filter((p) => p !== 'reddit')
export const PERIODS = ['weekly', 'monthly'] as const
export const DAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const

export type Platform = (typeof PLATFORMS)[number]
