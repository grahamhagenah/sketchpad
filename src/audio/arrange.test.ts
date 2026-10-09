import { describe, expect, it } from 'vitest'
import { arrange, DEFAULT_ARP, type Arp, type Rhythm } from './arrange'
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

  it('plays the chords in a rhythm, striking again where a chord changes', () => {
    const hits = arrange({ ...song([4, 2, 2]), rhythm: { chords: 'tresillo', bass: 'held' } })
    const pads = hits.filter((h) => h.pad.length)
    // Three-three-two across each bar, and the last chord struck again as it comes in on beat 3.
    expect(pads.map((h) => h.start)).toEqual([0, 1.5, 3, 4, 5.5, 6, 7])
    expect(pads.every((h) => !h.held)).toBe(true)
    // The bass still holds each chord.
    expect(hits.filter((h) => h.bass !== null).map((h) => [h.start, h.dur])).toEqual([[0, 4], [4, 2], [6, 2]])
  })

  it('leaves the beat open for offbeat chords', () => {
    const hits = arrange({ ...song([4]), rhythm: { chords: 'offbeat', bass: 'held' } })
    expect(hits.filter((h) => h.pad.length).map((h) => h.start)).toEqual([0.5, 1.5, 2.5, 3.5])
  })

  it('puts the bass on the kicks and walks it into the next chord', () => {
    const rhythm: Rhythm = { chords: 'held', bass: 'kick' }
    const hits = arrange({ ...song([4, 4]), rhythm, kicks: [0, 2, 4, 6] })
    const bass = hits.filter((h) => h.bass !== null)
    expect(bass.map((h) => h.start)).toEqual([0, 2, 3.5, 4, 6])
    // The walk is a semitone under the next chord's bass note.
    expect(bass[2].bass).toBe(bass[3].bass! - 1)
    // The chords themselves still hold.
    expect(hits.filter((h) => h.pad.length).map((h) => [h.start, h.dur])).toEqual([[0, 4], [4, 4]])
  })

  it('holds the bass where the drums have no kicks', () => {
    const hits = arrange({ ...song([4]), rhythm: { chords: 'held', bass: 'kick' }, kicks: [] })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ start: 0, dur: 4, held: true })
    expect(hits[0].bass).not.toBeNull()
  })

  it('plays a random pattern the same every time', () => {
    const s = song([4, 4], [4, 4], { on: true, rate: '1/16', pattern: 'random', octaves: 2 })
    expect(arrange(s)).toEqual(arrange(s))
  })
})
