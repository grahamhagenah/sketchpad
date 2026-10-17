import { describe, expect, it } from 'vitest'
import { findKeys } from './findKey'

const C = 0, D = 2, Eb = 3, E = 4, F = 5, Fs = 6, G = 7, Gs = 8, A = 9, Bb = 10, B = 11

const top = (notes: number[]) => {
  const [first] = findKeys(notes)
  return first && { key: first.key, mode: first.mode, outside: first.outside }
}

describe('finding the key of a tune', () => {
  it('has nothing to say about no notes', () => {
    expect(findKeys([])).toEqual([])
  })

  it('finds a major scale’s key', () => {
    expect(top([C, D, E, F, G, A, B, C])).toEqual({ key: C, mode: 'major', outside: [] })
    expect(top([G, A, B, C, D, E, Fs, G])).toEqual({ key: G, mode: 'major', outside: [] })
  })

  it('tells a minor key from the major one with the same notes, by where the tune starts and ends', () => {
    expect(top([A, B, C, D, E, F, G, A])).toEqual({ key: A, mode: 'minor', outside: [] })
    // The same notes, from C to C: the major key.
    const ranked = findKeys([C, D, E, F, G, A, B, C])
    expect(ranked[1]).toMatchObject({ key: A, mode: 'minor', outside: [] })
  })

  it('counts a minor key’s raised 7th as in it', () => {
    expect(top([A, C, E, Gs, A])).toEqual({ key: A, mode: 'minor', outside: [] })
  })

  it('puts keys with every note before ones without, and says which notes don’t fit', () => {
    const ranked = findKeys([C, E, G, Bb, C])
    expect(ranked[0].outside).toEqual([])
    expect(ranked.find((g) => g.key === C && g.mode === 'major')?.outside).toEqual([Bb])
  })

  it('weighs a note played often, as a tune leans on its key’s notes', () => {
    // E♭, often, with C and G: C minor rather than E♭ major.
    expect(top([C, Eb, G, C, Eb, D, C])).toMatchObject({ key: C, mode: 'minor' })
  })

  it('ranks all 24 keys', () => {
    expect(findKeys([C, E, G])).toHaveLength(24)
  })
})
