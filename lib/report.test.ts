import { describe, it, expect } from 'vitest'
import { firstSentence } from './report'

describe('firstSentence — the email leads with one line of why (T0-10)', () => {
  it('takes the first sentence of a long rationale', () => {
    const reasoning =
      'People are trying to work out whether pain comes from socket fit or normal adaptation. ' +
      'When Ossur leaves that sorting job to patients, discomfort can turn into abandonment. ' +
      'Create a post-delivery support path.'
    expect(firstSentence(reasoning)).toBe(
      'People are trying to work out whether pain comes from socket fit or normal adaptation.',
    )
  })

  it('returns a single-sentence rationale unchanged', () => {
    expect(firstSentence('Buyers cannot find the price.')).toBe('Buyers cannot find the price.')
  })

  it('returns reasoning with no terminator whole', () => {
    expect(firstSentence('No terminator here')).toBe('No terminator here')
  })

  it('does not stop on an abbreviation that leaves a fragment', () => {
    expect(firstSentence('Compare vs. the incumbent. Then act.')).toBe('Compare vs. the incumbent.')
  })

  it('truncates a runaway sentence rather than filling the screen', () => {
    const long = `${'word '.repeat(80)}end.`
    const out = firstSentence(long)
    expect(out.length).toBeLessThanOrEqual(241)
    expect(out.endsWith('…')).toBe(true)
  })

  it('empty stays empty', () => {
    expect(firstSentence('   ')).toBe('')
  })
})
