// Shared between the settings form (client) and its server action. Kept in a
// plain module (no 'use server'/'use client') so both sides import one source
// of truth for the allowed values + numeric bounds.

export const PLATFORMS = ['tiktok', 'youtube', 'instagram', 'reddit'] as const
export const PERIODS = ['weekly', 'monthly'] as const
export const DAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const

export type Platform = (typeof PLATFORMS)[number]
