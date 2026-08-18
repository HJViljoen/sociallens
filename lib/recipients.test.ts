import { describe, it, expect } from 'vitest'
import { addRecipient } from './recipients'

describe('addRecipient', () => {
  it('adds a new teammate to the report list', () => {
    expect(addRecipient(['a@x.com'], 'b@x.com')).toEqual(['a@x.com', 'b@x.com'])
  })
  it('never duplicates, whatever the case', () => {
    expect(addRecipient(['Anne@Ossur.com'], 'anne@ossur.com')).toEqual(['Anne@Ossur.com'])
  })
  it('seeds an empty or null list', () => {
    expect(addRecipient(null, 'a@x.com')).toEqual(['a@x.com'])
    expect(addRecipient([], 'a@x.com')).toEqual(['a@x.com'])
  })
  it('trims stored blanks and the incoming address', () => {
    expect(addRecipient([' a@x.com ', ''], '  b@x.com ')).toEqual(['a@x.com', 'b@x.com'])
  })
  it('an empty address changes nothing', () => {
    expect(addRecipient(['a@x.com'], '   ')).toEqual(['a@x.com'])
  })
})
