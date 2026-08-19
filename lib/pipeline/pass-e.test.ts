import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, buildUserPrompt } from './pass-e'
import { buildPopulationCounts } from './persona-assembly'

// The prompt carries rules that nothing downstream can re-check: whether the
// model invents demographics, whether it states its own counts, whether it
// makes up phrasing. Code catches a bad citation; only these assertions catch
// a rule being edited away. Same reason pass-a.test.ts pins its prompt.

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt('Acme')

  it('names the company it is profiling', () => {
    expect(prompt).toContain('Acme')
  })

  it('constrains the name to a short human noun, with the failure modes named', () => {
    // The names read like theme labels ("the identity-led wearer seeking
    // confidence"): a description wearing a person's hat. The word a colleague
    // would actually use is the bar — Caretaker, New amputee, Researcher.
    expect(prompt).toContain('one to three plain words, a noun, no verb')
    expect(prompt).toContain('a description, not a name')
    expect(prompt).toContain('a theme label, not a person')
    expect(prompt).toContain('Cut it back to the noun')
  })

  it('asks for a character sketch, not a list of requests', () => {
    // "Pricing, contact details, and coverage guidance" is Voice-of-Customer
    // output. This page answers what the person is LIKE; the specifics are one
    // click away elsewhere in the product.
    expect(prompt).toContain('DESCRIBE THE PERSON, NOT THEIR REQUESTS')
    expect(prompt).toContain('never "what did they ask for?"')
    expect(prompt).toContain('short phrase, not a sentence')
  })

  it('requires every persona to cite the themes it rests on', () => {
    expect(prompt).toContain('MUST cite')
    expect(prompt).toContain('forbids invented personas')
  })

  it('forbids inferring demographics and forbids quoting people to evidence them', () => {
    // counts-not-quotes (2026-08-22) reaches this prompt too: a demographic
    // signal may be counted, never illustrated with someone's words. The `who`
    // field left the schema when counts moved into code, but the model can
    // still smuggle an inferred demographic into the prose, so the guard stays.
    expect(prompt).toContain('never quote a person to evidence a demographic')
    expect(prompt).toContain('Never infer who someone is from a name, a platform, or a stereotype')
    expect(prompt).toContain('the product counts it and renders the count itself')
  })

  it('forbids the model stating its own magnitudes', () => {
    // Every number on the page is counted from citations; a model-supplied one
    // already shipped once as `who: count 1` for everything.
    expect(prompt).toContain('Do not state how many people a persona represents')
  })

  it('forbids invented phrasing', () => {
    expect(prompt).toContain('Do not invent phrasing')
  })

  it('carries the shared calibrated-prose rule', () => {
    // The same ban list every other client-facing pass gets.
    expect(prompt).toContain('never HOW MUCH')
  })

  it('pushes personas toward the category rather than the client bucket', () => {
    // For most tenants the client bucket is thin; defaulting to "client" would
    // claim these are the brand's own customers.
    expect(prompt).toContain('Prefer category')
  })
})

describe('buildUserPrompt', () => {
  const counts = buildPopulationCounts(
    [
      { category: 'pain_point', journey_stage: 'consideration', emotion: 'frustrated' },
      { category: 'question', journey_stage: null, emotion: 'curious' },
    ],
    ['industry-other', 'client'],
  )
  const prompt = buildUserPrompt({
    companyName: 'Acme',
    counts,
    themeLines: ['[T1] (client · praise) people like the strap'],
    phrases: ['it just will not stay on'],
    maxPersonas: 5,
  })

  it('shows the population size and every axis it was counted on', () => {
    expect(prompt).toContain('2 current insights')
    expect(prompt).toContain('pain_point: 1')
    expect(prompt).toContain('unstated: 1')
    expect(prompt).toContain('industry-other: 1')
  })

  it('shows the citable themes and the real phrasings', () => {
    expect(prompt).toContain('[T1] (client · praise) people like the strap')
    expect(prompt).toContain('it just will not stay on')
  })

  it('states the cap and that fewer well-grounded personas are better', () => {
    expect(prompt).toContain('at most 5 personas')
    expect(prompt).toContain('Fewer, well-grounded personas beat more')
  })
})
