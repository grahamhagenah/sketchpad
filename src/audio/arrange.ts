import { voiceProgression, type Mode } from '../music/theory'
import type { Chord, LoopRegion, TimeSig } from '../store'

export type ArpPattern = 'up' | 'down' | 'updown' | 'random' | 'pulse'
export type ArpRate = '1/4' | '1/8' | '1/8T' | '1/16'

export interface Arp {
  on: boolean
  pattern: ArpPattern
  rate: ArpRate
  /** How many octaves the pattern climbs through. */
  octaves: 1 | 2 | 3
  /** Each note's length as a share of its step, 0–1. */
  gate: number
}

export const DEFAULT_ARP: Arp = { on: false, pattern: 'up', rate: '1/8', octaves: 1, gate: 0.6 }

export const ARP_PATTERNS: { id: ArpPattern; label: string }[] = [
  { id: 'up', label: 'Up' },
  { id: 'down', label: 'Down' },
  { id: 'updown', label: 'Up-down' },
  { id: 'random', label: 'Random' },
  { id: 'pulse', label: 'Pulse' },
]

export const ARP_RATES: { id: ArpRate; label: string; quarters: number }[] = [
  { id: '1/4', label: '1/4', quarters: 1 },
  { id: '1/8', label: '1/8', quarters: 1 / 2 },
  { id: '1/8T', label: '1/8 T', quarters: 1 / 3 },
  { id: '1/16', label: '1/16', quarters: 1 / 4 },
]

/** One thing to play. Times are in quarter notes from the start of the song. */
export interface Hit {
  start: number
  dur: number
  /** Chord-synth notes; empty when only the bass plays. */
  pad: number[]
  bass: number | null
  velocity: number
  /** A held chord, rather than one step of the arpeggiator. */
  held: boolean
}

interface ArrangeSong {
  key: number
  mode: Mode
  timeSig: TimeSig
  chords: Chord[]
  arp: Arp
}

// A small seeded generator, so a random pattern plays the same every time
// round the loop and in exports.
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function arpeggiate(notes: number[], start: number, end: number, arp: Arp, seed: number): Hit[] {
  const step = ARP_RATES.find((r) => r.id === arp.rate)!.quarters
  const climb = Array.from({ length: arp.octaves }, (_, o) => notes.map((n) => n + 12 * o)).flat()
  const order =
    arp.pattern === 'down'
      ? [...climb].reverse()
      : arp.pattern === 'updown'
        ? [...climb, ...climb.slice(1, -1).reverse()]
        : climb
  const random = seeded(seed)

  const hits: Hit[] = []
  for (let t = start, i = 0; t < end - 1e-6; t += step, i++) {
    const pad =
      arp.pattern === 'pulse'
        ? notes
        : [arp.pattern === 'random' ? climb[Math.floor(random() * climb.length)] : order[i % order.length]]
    hits.push({
      start: t,
      dur: Math.min(step * arp.gate, end - t),
      pad,
      bass: null,
      velocity: i === 0 ? 0.85 : 0.7,
      held: false,
    })
  }
  return hits
}

/**
 * Everything the song plays, as one list shared by playback and both exports.
 * With a region (in beats), only what falls inside it is kept, and a chord
 * that crosses its edge is cut to it.
 */
export function arrange(song: ArrangeSong, region?: LoopRegion): Hit[] {
  const quartersPerBeat = 4 / song.timeSig[1]
  const voiced = voiceProgression(song.key, song.mode, song.chords)
  const hits: Hit[] = []
  let beat = 0
  song.chords.forEach((c, i) => {
    let start = beat
    let end = beat + c.beats
    beat = end
    if (region) {
      start = Math.max(start, region.start)
      end = Math.min(end, region.end)
      if (end <= start) return
    }
    const s = start * quartersPerBeat
    const e = end * quartersPerBeat
    const { notes, bass } = voiced[i]
    hits.push({ start: s, dur: e - s, pad: song.arp.on ? [] : notes, bass, velocity: 0.8, held: true })
    if (song.arp.on) hits.push(...arpeggiate(notes, s, e, song.arp, i + 1))
  })
  return hits
}
