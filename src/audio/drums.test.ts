import { describe, expect, it } from 'vitest'
import { fillLength, GROOVES, grooveBar, grooveFits, grooveHits, pulses } from './drums'

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

describe('genre grooves', () => {
  it('pushes the rock kick onto the "and" of 2', () => {
    expect(at(grooveBar('rock', [4, 4]), 'kick')).toEqual([0, 1.5, 2])
  })

  it('plays the dembow snare on the "a" of 1 and the "and" of 2, over a kick on every beat', () => {
    const bar = grooveBar('dembow', [4, 4])
    expect(at(bar, 'kick')).toEqual([0, 1, 2, 3])
    expect(at(bar, 'snare')).toEqual([0.75, 1.5, 2.75, 3.5])
  })

  it('swings the shuffle: each beat long, then short', () => {
    const hats = at(grooveBar('shuffle', [4, 4]), 'hat')
    expect(hats[0]).toBe(0)
    expect(hats[1]).toBeCloseTo(2 / 3)
    expect(at(grooveBar('shuffle', [12, 8]), 'hat')).toEqual([0, 2, 3, 5, 6, 8, 9, 11])
  })

  it('plays the drum & bass two-step: kick on 1 and the "and" of 3, snare on 2 and 4, a ghost snare rolling on', () => {
    const bar = grooveBar('dnb', [4, 4])
    expect(at(bar, 'kick')).toEqual([0, 2.5])
    expect(at(bar, 'snare')).toEqual([1, 3, 3.75])
  })

  it('opens the disco hat on the offbeats, with claps on 2 and 4', () => {
    const bar = grooveBar('disco', [4, 4])
    expect(at(bar, 'openHat')).toEqual([0.5, 1.5, 2.5, 3.5])
    expect(at(bar, 'clap')).toEqual([1, 3])
  })

  it('plays a groove written for 4/4 as a backbeat in a meter it doesn’t fit', () => {
    expect(grooveFits('dembow', [6, 8])).toBe(false)
    expect(grooveBar('dembow', [6, 8])).toEqual(grooveBar('backbeat', [6, 8]))
  })

  it('keeps every groove inside its bar, in every meter', () => {
    for (const { id } of GROOVES) {
      for (const sig of [[4, 4], [3, 4], [6, 8], [7, 8], [5, 4], [12, 8]] as [number, number][]) {
        const bar = grooveBar(id, sig)
        expect(bar.length).toBeGreaterThan(0)
        expect(bar.every((h) => h.beat >= 0 && h.beat < sig[0])).toBe(true)
      }
    }
  })
})

describe('intensity', () => {
  it('keeps only the hats on the beat when sparse, and fills them to sixteenths with a pickup kick when busy', () => {
    expect(at(grooveHits('backbeat', [4, 4], 0, 4, 'none', { intensity: 'sparse' }), 'hat')).toEqual([0, 1, 2, 3])
    const busy = grooveHits('backbeat', [4, 4], 0, 4, 'none', { intensity: 'busy' })
    expect(at(busy, 'hat')).toHaveLength(16)
    expect(at(busy, 'kick')).toEqual([0, 2, 3.5])
  })

  it('drops the ghost notes when sparse', () => {
    expect(at(grooveHits('funk', [4, 4], 0, 4, 'none', { intensity: 'sparse' }), 'snare')).toEqual([1, 3])
  })
})

describe('crashes', () => {
  it('land on the beat after each fill inside a section, in place of the hat', () => {
    const hits = grooveHits('backbeat', [4, 4], 0, 32, 'four')
    expect(at(hits, 'crash')).toEqual([16])
    expect(hits.some((h) => h.beat === 16 && h.piece === 'hat')).toBe(false)
  })

  it('open a section that comes in from a fill', () => {
    expect(at(grooveHits('backbeat', [4, 4], 8, 8, 'none', { crashAtStart: true }), 'crash')).toEqual([8])
    expect(at(grooveHits('backbeat', [4, 4], 8, 8), 'crash')).toEqual([])
  })
})
