import { z } from 'zod'
import { SCHEDULE_NAME_MAX, SCHEDULE_RECIPIENTS_MAX } from '../config'

/** A pasted list — commas, semicolons, newlines or spaces between addresses. */
export function splitRecipients(text: string): string[] {
  return text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
}

/** Lower-cased, deduplicated, in first-seen order. */
export function normaliseRecipients(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const e = raw.trim().toLowerCase()
    if (!e || seen.has(e)) continue
    seen.add(e)
    out.push(e)
  }
  return out
}

export const recipientsSchema = z
  .array(z.string().trim().toLowerCase().max(120).pipe(z.email('That is not an email address.')))
  .transform(normaliseRecipients)
  .refine((r) => r.length <= SCHEDULE_RECIPIENTS_MAX, `Send to at most ${SCHEDULE_RECIPIENTS_MAX} addresses.`)

export const shareDaysSchema = z.union([z.literal(7), z.literal(30), z.literal(90), z.null()])

/** What a browser may put into a schedule — the form and the routes share it. */
export const scheduleInputSchema = z
  .object({
    name: z.string().trim().min(1, 'A schedule needs a name.').max(SCHEDULE_NAME_MAX),
    starterKey: z.string().trim().max(60).nullable().default(null),
    reportId: z.uuid().nullable().default(null),
    cadence: z.enum(['every_update', 'monthly']),
    recipients: recipientsSchema,
    attachPdf: z.boolean(),
    shareDays: shareDaysSchema,
    active: z.boolean(),
  })
  .refine((s) => Boolean(s.starterKey) !== Boolean(s.reportId), { message: 'Pick one template.', path: ['starterKey'] })

export type ScheduleInput = z.infer<typeof scheduleInputSchema>
