import { describe, expect, it } from 'vitest'
import { composeFallbackCover, coverPlainText, dedupeTitles, splitSentences, substituteFigures } from './cover'
import type { FigureTable } from './types'

const figures: FigureTable = {
  videos: { label: 'conversations analysed', value: '374' },
  comments: { label: 'comments read', value: '4,626' },
  sentiment_positive_pct: { label: 'positive sentiment', value: '92.7%' },
}

describe('substituteFigures', () => {
  it('writes the figures in and keeps the text around them', () => {
    const parts = substituteFigures('It rests on [[videos]] conversations. Sentiment was [[sentiment_positive_pct]] positive.', figures)
    expect(parts).toEqual([
      { text: 'It rests on ' }, { figure: '374', key: 'videos' }, { text: ' conversations. ' },
      { text: 'Sentiment was ' }, { figure: '92.7%', key: 'sentiment_positive_pct' }, { text: ' positive.' },
    ])
  })
  it('drops a whole sentence that cites a figure the table lacks', () => {
    expect(coverPlainText('Share was [[share_of_voice_pct]] this month. Comments read: [[comments]].', figures)).toBe('Comments read: 4,626.')
  })
  it('passes prose without placeholders through', () => {
    expect(coverPlainText('Nothing to substitute here.', figures)).toBe('Nothing to substitute here.')
  })
})

describe('splitSentences', () => {
  it('splits on sentence ends, not on abbreviations mid-sentence', () => {
    expect(splitSentences('One thing. Another [[x]] thing! “Quoted” start? Last')).toEqual(['One thing.', 'Another [[x]] thing!', '“Quoted” start?', 'Last'])
  })
})

describe('composeFallbackCover', () => {
  it('cites only figures it has and lists the pages once', () => {
    const c = composeFallbackCover({ title: 'Leadership one-pager', register: 'leadership', company: 'Össur', period: 'Update of Sun 23 Aug', sectionTitles: ['Dashboard · Össur · Sun 23 Aug', 'Dashboard · Össur · Sun 23 Aug', 'Voice of Customer · Össur'], figures })
    expect(c.fallback).toBe(true)
    const text = coverPlainText(c.body, figures)
    expect(text).toContain('prepared by Össur for the people who decide, from the update of Sun 23 Aug.')
    expect(text).toContain('374 conversations and 4,626 comments')
    expect(text).toContain('92.7% were positive')
    expect(text).not.toContain('share')
    expect(text).toContain('The pages that follow: Dashboard · Voice of Customer.')
  })
  it('dedupes titles by their first segment', () => {
    expect(dedupeTitles(['A · x', 'A · y', 'B'])).toEqual(['A', 'B'])
  })
})
