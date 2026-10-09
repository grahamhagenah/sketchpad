import { describe, expect, it } from 'vitest'
import { chordInfo, keyLabel, keySignature, nextChords, voiceChord, voiceProgression } from './theory'

const C = 0
const A = 9

describe('chordInfo', () => {
  it('names the triads of a major key', () => {
    const names = [0, 1, 2, 3, 4, 5, 6].map((d) => chordInfo(C, 'major', d, false))
    expect(names.map((c) => c.name)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'B°'])
    expect(names.map((c) => c.roman)).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'])
  })

  it('names the sevenths of a major key', () => {
    const names = [0, 1, 4, 6].map((d) => chordInfo(C, 'major', d, true))
    expect(names.map((c) => c.name)).toEqual(['Cmaj7', 'Dm7', 'G7', 'Bø7'])
    expect(names.map((c) => c.roman)).toEqual(['Imaj7', 'ii7', 'V7', 'viiø7'])
  })

  it('uses natural minor', () => {
    const names = [0, 2, 4, 6].map((d) => chordInfo(A, 'minor', d, false))
    expect(names.map((c) => c.name)).toEqual(['Am', 'C', 'Em', 'G'])
    expect(names.map((c) => c.roman)).toEqual(['i', 'III', 'v', 'VII'])
  })

  it('gives pitch classes root first', () => {
    expect(chordInfo(C, 'major', 4, true)).toMatchObject({ rootPc: 7, pcs: [7, 11, 2, 5] })
  })

  it('spells flat keys with flats', () => {
    expect(chordInfo(5, 'major', 3, false).name).toBe('B♭')
  })
})

describe('keyLabel', () => {
  it('spells each key the usual way', () => {
    expect(keyLabel(6, 'major')).toBe('F♯')
    expect(keyLabel(10, 'major')).toBe('B♭')
    expect(keyLabel(3, 'minor')).toBe('D♯')
    expect(keyLabel(3, 'major')).toBe('E♭')
  })
})

describe('keySignature', () => {
  it('counts sharps as positive and flats as negative', () => {
    expect(keySignature(C, 'major')).toBe(0)
    expect(keySignature(7, 'major')).toBe(1)
    expect(keySignature(5, 'major')).toBe(-1)
    expect(keySignature(6, 'major')).toBe(6)
    expect(keySignature(A, 'minor')).toBe(0)
    expect(keySignature(2, 'minor')).toBe(-1)
  })
})

describe('voiceChord', () => {
  it('plays exactly the chord’s pitch classes, around middle C', () => {
    const notes = voiceChord([7, 11, 2, 5], null)
    expect(new Set(notes.map((n) => n % 12))).toEqual(new Set([7, 11, 2, 5]))
    expect(notes).toEqual([...notes].sort((a, b) => a - b))
    for (const n of notes) expect(Math.abs(n - 62)).toBeLessThanOrEqual(12)
  })

  it('moves as little as it can from the previous chord', () => {
    // C major in root position to G major: B and D, with G held.
    expect(voiceChord([7, 11, 2], [60, 64, 67])).toEqual([59, 62, 67])
  })
})

describe('voiceProgression', () => {
  it('gives each chord its root in the bass', () => {
    const voiced = voiceProgression(C, 'major', [0, 4, 5, 3].map((degree) => ({ degree, seventh: false })))
    expect(voiced.map((v) => v.bass)).toEqual([36, 43, 45, 41])
  })
})

describe('nextChords', () => {
  const degrees = (list: { degree: number; borrowed?: boolean }[]) => list.map((c) => `${c.borrowed ? 'b' : ''}${c.degree}`)

  it('starts on the tonic', () => {
    expect(degrees(nextChords('major', null))).toEqual(['0'])
  })

  it('leads on as functional harmony does', () => {
    // V goes home to I, or deceptively to vi.
    expect(degrees(nextChords('major', { degree: 4 }))).toEqual(['0', '5'])
    // In minor, ii° leads to v, or to the major V borrowed from major.
    expect(degrees(nextChords('minor', { degree: 1 }))).toEqual(['4', 'b4'])
  })

  it('knows where borrowed chords go', () => {
    expect(degrees(nextChords('major', { degree: 6, borrowed: true }))).toEqual(['0'])
  })
})
