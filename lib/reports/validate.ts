import { z } from 'zod'
import { isStaticKey } from './compose'
import { REPORT_FRAMING_MAX, REPORT_TITLE_MAX, SECTION_PAGES, type ReportSection } from './types'
import { EXPORT_PARAMS_MAX_CHARS, EXPORT_PARAMS_MAX_KEYS, REPORT_MAX_SECTIONS } from '../config'

/** What a browser may put into a report: shared by the server actions and the
 *  routes, so a crafted POST meets the same caps as the Studio. */
export const audienceSchema = z.enum(['leadership', 'marketing', 'sales', 'content', 'general'])

export const sectionSchema = z.object({
  id: z.string().min(1).max(40),
  page: z.enum(SECTION_PAGES as [string, ...string[]]),
  params: z.record(z.string().max(40), z.string().max(EXPORT_PARAMS_MAX_CHARS)).refine((p) => Object.keys(p).length <= EXPORT_PARAMS_MAX_KEYS, 'too many params'),
  keys: z.array(z.string().max(60).refine(isStaticKey, 'not a static tile key')).min(1, 'a section keeps at least one tile').max(40).optional(),
  variant: z.enum(['default', 'full']).optional(),
  framing: z.string().max(REPORT_FRAMING_MAX).optional(),
})

export const sectionsSchema = z.array(sectionSchema).max(REPORT_MAX_SECTIONS, `a report holds at most ${REPORT_MAX_SECTIONS} sections`)

export const reportPatchSchema = z.object({
  title: z.string().trim().min(1, 'a report needs a title').max(REPORT_TITLE_MAX).optional(),
  audience: audienceSchema.optional(),
  coverTitle: z.string().trim().max(REPORT_TITLE_MAX).optional(),
  sections: sectionsSchema.optional(),
})

export type ReportPatch = z.infer<typeof reportPatchSchema>

/** Sections as stored: drop empty framing, keep keys in catalogue order is the caller's job. */
export function tidySections(sections: z.infer<typeof sectionsSchema>): ReportSection[] {
  return sections.map((s) => {
    const out: ReportSection = { id: s.id, page: s.page as ReportSection['page'], params: s.params }
    if (s.keys) out.keys = s.keys
    if (s.variant === 'full') out.variant = 'full'
    const framing = s.framing?.trim()
    if (framing) out.framing = framing
    return out
  })
}
