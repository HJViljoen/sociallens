import { describe, it, expect } from 'vitest'
import { CONTENT_BRIEF, DOCUMENT_TEMPLATES, LEADERSHIP_BRIEF, MARKET_BRIEF, PAGE_FIELDS, PAGE_TITLE, SALES_BRIEF, documentTemplate, promptVersion, skeletonOrder } from './templates'
import { DOCUMENT_BLOCK_MAX } from '../../config'
import { documentSettings, isDocumentData, DEFAULT_DOCUMENT_SETTINGS } from './types'

describe('document templates', () => {
  it('the sales brief skeleton is fixed and in the agreed order', () => {
    expect(SALES_BRIEF.skeleton.map((p) => p.kind)).toEqual(['in_short', 'finding', 'competitor', 'personas', 'language', 'method'])
    expect(SALES_BRIEF.skeleton.find((p) => p.kind === 'finding')?.repeat).toBe('findings')
    expect(SALES_BRIEF.skeleton.find((p) => p.kind === 'competitor')?.repeat).toBe('competitors')
  })

  it('every page kind names its fields, and a finding carries the five', () => {
    for (const p of SALES_BRIEF.skeleton) expect(PAGE_FIELDS[p.kind].length).toBeGreaterThan(0)
    expect(PAGE_FIELDS.finding).toEqual(['headline', 'saw', 'heard', 'means', 'practice', 'sure'])
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

describe('every document template', () => {
  it('is a brief: it opens on the overview and closes on the method page', () => {
    for (const t of DOCUMENT_TEMPLATES) {
      const kinds = skeletonOrder(t)
      expect(kinds[0], t.key).toBe('in_short')
      expect(kinds[kinds.length - 1], t.key).toBe('method')
      expect(kinds.filter((k) => k === 'finding'), t.key).toHaveLength(1)
    }
  })

  it('names every page it prints, and every field of it has a cap', () => {
    for (const t of DOCUMENT_TEMPLATES) {
      for (const p of t.skeleton) {
        expect(PAGE_TITLE[p.kind], `${t.key}/${p.kind}`).toBeTruthy()
        expect(PAGE_FIELDS[p.kind].length, `${t.key}/${p.kind}`).toBeGreaterThan(0)
        // 'heard', 'sure', 'findings' and 'method' are composed by code, so
        // they carry no writer cap; everything the model writes has one.
        for (const field of PAGE_FIELDS[p.kind]) {
          if (['heard', 'sure', 'findings', 'method'].includes(field)) continue
          expect(DOCUMENT_BLOCK_MAX[field], `${t.key}/${field}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('carries a lens, a reader and a version of its own', () => {
    const keys = DOCUMENT_TEMPLATES.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    const versions = DOCUMENT_TEMPLATES.map(promptVersion)
    expect(new Set(versions).size).toBe(versions.length)
    for (const t of DOCUMENT_TEMPLATES) {
      expect(t.lens.means, t.key).toMatch(/^What it means for /)
      expect(t.lens.rule, t.key).toContain(t.lens.means)
      expect(t.readerNoun, t.key).toBeTruthy()
      expect([3, 4], t.key).toContain(t.findingsMax)
    }
  })

  it('writes no dashes between clauses, in any copy a model or a reader sees', () => {
    for (const t of DOCUMENT_TEMPLATES) {
      const copy = [t.name, t.description, t.role, t.brief, t.lens.means, t.lens.short, t.lens.rule, ...t.anchors.map((a) => a.text)].join(' ')
      expect(copy, t.key).not.toMatch(/[—–]/)
    }
  })

  it('asks its own questions: anchors are the template, not the engine', () => {
    for (const t of DOCUMENT_TEMPLATES) {
      expect(t.anchors.filter((a) => !a.sellsTo && !a.perCompetitor).length, t.key).toBeGreaterThanOrEqual(4)
      for (const a of t.anchors) expect(a.text, `${t.key}/${a.id}`).toMatch(/\{market\}|\{competitor\}|\{company\}/)
    }
    // A template that prints competitor pages must have asked about them.
    for (const t of DOCUMENT_TEMPLATES.filter((x) => skeletonOrder(x).includes('competitor'))) {
      expect(t.anchors.some((a) => a.perCompetitor), t.key).toBe(true)
    }
  })

  it('gives each reader a different lens and a different middle of the brief', () => {
    expect(SALES_BRIEF.lens.short).toBe('for a sale')
    expect(LEADERSHIP_BRIEF.lens.short).toBe('for the business')
    expect(MARKET_BRIEF.lens.short).toBe('for the message')
    expect(CONTENT_BRIEF.lens.short).toBe('for what to make')
    expect(skeletonOrder(LEADERSHIP_BRIEF)).toContain('standing')
    expect(skeletonOrder(LEADERSHIP_BRIEF)).not.toContain('competitor')
    expect(skeletonOrder(MARKET_BRIEF)).toContain('say_hear')
    expect(skeletonOrder(CONTENT_BRIEF)).toContain('asked')
    expect(skeletonOrder(CONTENT_BRIEF)).not.toContain('personas')
  })

  it('the sales brief is untouched: the reference every other template was cut from', () => {
    expect(skeletonOrder(SALES_BRIEF)).toEqual(['in_short', 'finding', 'competitor', 'personas', 'language', 'method'])
    expect(promptVersion(SALES_BRIEF)).toBe('sales_brief_v1')
    expect(SALES_BRIEF.findingsMax).toBe(4)
  })
})
