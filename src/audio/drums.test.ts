import { describe, expect, it } from 'vitest'
import { fillLength, grooveBar, grooveHits, pulses } from './drums'

const at = (hits: { beat: number; piece: string }[], piece: string) => hits.filter((h) => h.piece === piece).map((h) => h.beat)

describe('pulses', () => {
  it('feels every beat in x/4, threes in compound meters and twos then a three otherwise', () => {
    expect(pulses([4, 4])).toEqual([0, 1, 2, 3])
    expect(pulses([6, 8])).toEqual([0, 3])
    expect(pulses([7, 8])).toEqual([0, 2, 4])
    expect(pulses([5, 8])).toEqual([0, 2])
  })
})

describe('grooveBar', () => {
  it('plays a backbeat in 4/4: kick on 1 and 3, snare on 2 and 4, hats on the eighths', () => {
    const bar = grooveBar('backbeat', [4, 4])
    expect(at(bar, 'kick')).toEqual([0, 2])
    expect(at(bar, 'snare')).toEqual([1, 3])
    expect(at(bar, 'hat')).toHaveLength(8)
  })

  it('puts a half-time snare halfway through the bar', () => {
    expect(at(grooveBar('halftime', [4, 4]), 'snare')).toEqual([2])
    expect(at(grooveBar('halftime', [6, 8]), 'snare')).toEqual([3])
  })
})

describe('grooveHits', () => {
  it('repeats the bar from where it starts and stops where the section ends', () => {
    const hits = grooveHits('light', [4, 4], 8, 6)
    expect(at(hits, 'kick')).toEqual([8, 12])
    expect(Math.max(...hits.map((h) => h.beat))).toBeLessThan(14)
  })

  it('swaps the end of the section for a fill, from the snare down the toms', () => {
    const hits = grooveHits('backbeat', [4, 4], 0, 8, 'end')
    // The groove up to beat 6, then the fill's roll in sixteenths.
    expect(at(hits, 'snare')).toEqual([1, 3, 5, 6, 6.25, 6.5])
    expect(at(hits, 'tomHigh')).toEqual([6.75, 7, 7.25])
    expect(at(hits, 'tomLow')).toEqual([7.5, 7.75])
    expect(hits.filter((h) => h.beat >= 6 && h.piece === 'hat')).toEqual([])
  })

  it('fills every four bars, and at the end', () => {
    const hits = grooveHits('backbeat', [4, 4], 0, 32, 'four')
    expect(at(hits, 'tomLow').filter((b) => b % 4 === 3.5)).toEqual([15.5, 31.5])
    expect(at(grooveHits('backbeat', [4, 4], 0, 32, 'end'), 'tomLow').filter((b) => b % 4 === 3.5)).toEqual([31.5])
  })

  it('fills the back half of the bar', () => {
    expect(fillLength([4, 4])).toBe(2)
    expect(fillLength([6, 8])).toBe(3)
    expect(fillLength([3, 4])).toBe(2)
  })

  it('plays nothing without a groove', () => {
    expect(grooveHits(null, [4, 4], 0, 16)).toEqual([])
  })
})
