import { describe, expect, it } from 'vitest'
import { arrange, DEFAULT_ARP, type Arp } from './arrange'
import type { Chord, TimeSig } from '../store'

const chords = (beats: number[]): Chord[] => beats.map((b, i) => ({ id: String(i), degree: i % 7, beats: b, seventh: false }))
const song = (beats: number[], timeSig: TimeSig = [4, 4], arp: Partial<Arp> = {}) => ({
  key: 0,
  mode: 'major' as const,
  timeSig,
  chords: chords(beats),
  arp: { ...DEFAULT_ARP, ...arp },
})

describe('arrange', () => {
  it('holds each chord for its length, in quarter notes', () => {
    const hits = arrange(song([4, 2, 4]))
    expect(hits.map((h) => [h.start, h.dur])).toEqual([[0, 4], [4, 2], [6, 4]])
    expect(hits.every((h) => h.held && h.pad.length === 3 && h.bass !== null)).toBe(true)
  })

  it('counts eighth-note beats as half a quarter', () => {
    const hits = arrange(song([6, 6], [6, 8]))
    expect(hits.map((h) => [h.start, h.dur])).toEqual([[0, 3], [3, 3]])
  })

  it('cuts chords to a region and drops the ones outside it', () => {
    const hits = arrange(song([4, 4, 4]), { start: 2, end: 6 })
    expect(hits.map((h) => [h.start, h.dur])).toEqual([[2, 2], [4, 2]])
  })

  it('arpeggiates over a held bass', () => {
    const hits = arrange(song([4], [4, 4], { on: true, rate: '1/8', pattern: 'up', gate: 0.5 }))
    const [held, ...steps] = hits
    expect(held).toMatchObject({ start: 0, dur: 4, pad: [], held: true })
    expect(steps).toHaveLength(8)
    expect(steps.map((h) => h.start)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
    expect(steps.every((h) => h.pad.length === 1 && h.dur === 0.25 && h.bass === null)).toBe(true)
    // Up through the chord, then round again.
    const pitches = steps.map((h) => h.pad[0])
    expect(pitches.slice(0, 3)).toEqual([...pitches.slice(0, 3)].sort((a, b) => a - b))
    expect(pitches.slice(3, 6)).toEqual(pitches.slice(0, 3))
  })

  it('plays a random pattern the same every time', () => {
    const s = song([4, 4], [4, 4], { on: true, rate: '1/16', pattern: 'random', octaves: 2 })
    expect(arrange(s)).toEqual(arrange(s))
  })
})
