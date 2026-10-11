import { describe, expect, it } from 'vitest'
import { lineSyllables, syllables } from './lyrics'

describe('syllables', () => {
  it('counts the vowel sounds in a word', () => {
    expect(['I', 'love', 'moved', 'wanted', 'little', 'tonight', 'remember', 'don’t', 'every'].map(syllables)).toEqual([1, 1, 1, 2, 2, 2, 3, 1, 3])
  })

  it('counts a line, ignoring punctuation and blank space', () => {
    expect(lineSyllables('Hey Jude, don’t make it bad')).toBe(6)
    expect(lineSyllables('   ')).toBe(0)
    expect(lineSyllables('half-way home')).toBe(3)
  })
})
