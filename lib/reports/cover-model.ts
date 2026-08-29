import type { SupabaseClient } from '@supabase/supabase-js'
import { composeFallbackCover } from './cover'
import type { Audience, CoverText, FigureTable } from './types'

export interface CoverArgs {
  admin: SupabaseClient
  clientId: string
  runId: string | null
  register: Audience
  title: string
  company: string
  period: string
  sectionTitles: string[]
  brief: { headline: string; beats: string[] } | null
  figures: FigureTable
}

/** T2: the code cover. T3 adds the model call in front of it. */
export async function generateCover(args: CoverArgs): Promise<CoverText> {
  return composeFallbackCover(args)
}
