import { describe, expect, it } from 'vitest'
import { normaliseRecipients, recipientsSchema, scheduleInputSchema, splitRecipients } from './validate'

describe('recipients', () => {
  it('splits a pasted list on commas, semicolons, newlines and spaces', () => {
    expect(splitRecipients('a@x.com, b@x.com;c@x.com\nd@x.com e@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'])
    expect(splitRecipients('')).toEqual([])
  })
  it('lower-cases and dedupes, keeping first-seen order', () => {
    expect(normaliseRecipients([' Malori@Ossur.com', 'anne@ossur.com', 'malori@ossur.com '])).toEqual(['malori@ossur.com', 'anne@ossur.com'])
  })
  it('rejects a non-address and more than the cap', () => {
    expect(recipientsSchema.safeParse(['not an email']).success).toBe(false)
    const many = Array.from({ length: 26 }, (_, i) => `p${i}@x.com`)
    expect(recipientsSchema.safeParse(many).success).toBe(false)
    expect(recipientsSchema.safeParse(many.slice(0, 25)).success).toBe(true)
  })
})

describe('scheduleInputSchema', () => {
  const base = { name: 'Weekly digest', cadence: 'every_update', recipients: ['a@x.com'], attachPdf: true, shareDays: 30, active: true }
  it('takes exactly one template — a starter key or a report id', () => {
    expect(scheduleInputSchema.safeParse({ ...base, starterKey: 'weekly_digest' }).success).toBe(true)
    expect(scheduleInputSchema.safeParse({ ...base, reportId: '4f6c4a1c-2b2f-4d1a-9d3a-3e3f9a1b2c3d' }).success).toBe(true)
    expect(scheduleInputSchema.safeParse({ ...base }).success).toBe(false)
    expect(scheduleInputSchema.safeParse({ ...base, starterKey: 'weekly_digest', reportId: '4f6c4a1c-2b2f-4d1a-9d3a-3e3f9a1b2c3d' }).success).toBe(false)
  })
  it('share-link life is 7, 30, 90 or never', () => {
    expect(scheduleInputSchema.safeParse({ ...base, starterKey: 'weekly_digest', shareDays: null }).success).toBe(true)
    expect(scheduleInputSchema.safeParse({ ...base, starterKey: 'weekly_digest', shareDays: 14 }).success).toBe(false)
  })
})
