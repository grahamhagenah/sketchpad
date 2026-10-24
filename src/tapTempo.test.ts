import { describe, expect, it } from 'vitest'
import { tapTempo } from './tapTempo'
import { MAX_BPM, MIN_BPM } from './store'

const tapAll = (times: number[]) => times.reduce<{ taps: number[]; bpm: number | null }>((s, t) => tapTempo(s.taps, t), { taps: [], bpm: null })

describe('tap tempo', () => {
  it('needs two taps', () => {
    expect(tapAll([0]).bpm).toBeNull()
    expect(tapAll([0, 500]).bpm).toBe(120)
  })

  it('evens out the taps', () => {
    expect(tapAll([0, 480, 1010, 1500, 2000]).bpm).toBe(120)
  })

  it('starts over after a pause', () => {
    const s = tapAll([0, 500, 1000, 5000])
    expect(s.taps).toEqual([5000])
    expect(s.bpm).toBeNull()
    expect(tapAll([0, 500, 1000, 5000, 5750]).bpm).toBe(80)
  })

  it('follows the latest few taps', () => {
    expect(tapAll([0, 1000, 2000, 2400, 2800, 3200, 3600, 4000, 4400]).bpm).toBe(150)
  })

  it('stays within the tempos Bounce plays', () => {
    expect(tapAll([0, 100, 200]).bpm).toBe(MAX_BPM)
    expect(tapAll([0, 1990, 3980]).bpm).toBe(Math.max(MIN_BPM, 30))
  })
})
