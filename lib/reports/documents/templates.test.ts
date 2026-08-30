import { describe, it, expect } from 'vitest'
import { DOCUMENT_TEMPLATES, PAGE_FIELDS, SALES_BRIEF, documentTemplate } from './templates'
import { documentSettings, isDocumentData, DEFAULT_DOCUMENT_SETTINGS } from './types'

describe('document templates', () => {
  it('the sales brief skeleton is fixed and in the agreed order', () => {
    expect(SALES_BRIEF.skeleton.map((p) => p.kind)).toEqual(['in_short', 'finding', 'competitor', 'personas', 'language'])
    expect(SALES_BRIEF.skeleton.find((p) => p.kind === 'finding')?.repeat).toBe('findings')
    expect(SALES_BRIEF.skeleton.find((p) => p.kind === 'competitor')?.repeat).toBe('competitors')
  })

  it('every page kind names its fields, and a finding carries the five', () => {
    for (const p of SALES_BRIEF.skeleton) expect(PAGE_FIELDS[p.kind].length).toBeGreaterThan(0)
    expect(PAGE_FIELDS.finding).toEqual(['headline', 'saw', 'means', 'say', 'sure'])
  })

  it('anchors outnumber the register questions and carry the placeholders the composer fills', () => {
    const always = SALES_BRIEF.anchors.filter((a) => !a.sellsTo)
    expect(always.length).toBeGreaterThanOrEqual(5)
    for (const a of SALES_BRIEF.anchors) expect(a.text).toMatch(/\{market\}|\{competitor\}/)
    expect(SALES_BRIEF.anchors.find((a) => a.id === 'competitor')?.perCompetitor).toBe(true)
  })

  it('looks templates up by key and never uses the word agent as one', () => {
    expect(documentTemplate('sales_brief')).toBe(SALES_BRIEF)
    expect(documentTemplate('agent')).toBeNull()
    expect(documentTemplate(null)).toBeNull()
    for (const t of DOCUMENT_TEMPLATES) expect(t.key).not.toBe('agent')
  })

  it('no dashes between clauses in the copy the model or the picker sees', () => {
    const copy = [SALES_BRIEF.description, SALES_BRIEF.role, SALES_BRIEF.brief, ...SALES_BRIEF.anchors.map((a) => a.text)].join(' ')
    expect(copy).not.toMatch(/[—–]/)
  })
})

describe('documentSettings', () => {
  it('fills defaults and drops junk', () => {
    expect(documentSettings(null)).toEqual(DEFAULT_DOCUMENT_SETTINGS)
    expect(documentSettings({ sellsTo: 'professionals', competitors: ['Ottobock', '', 3 as unknown as string], findings: 3 })).toEqual({
      sellsTo: 'professionals', competitors: ['Ottobock'], language: 'en', findings: 3,
    })
    expect(documentSettings({ sellsTo: 'nope' as never })).toEqual(DEFAULT_DOCUMENT_SETTINGS)
  })
})

describe('isDocumentData', () => {
  it('recognises a document snapshot and nothing else', () => {
    expect(isDocumentData({ kind: 'document', pages: [] })).toBe(true)
    expect(isDocumentData({ version: 1, sections: [] })).toBe(false)
    expect(isDocumentData(null)).toBe(false)
  })
})
