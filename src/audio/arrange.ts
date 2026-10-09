import { voiceProgression, type Mode } from '../music/theory'
import type { Chord, LoopRegion, TimeSig } from '../store'
import { eighth, pulses } from './drums'

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

export type ChordRhythm = 'held' | 'pulse' | 'beats' | 'tresillo' | 'offbeat' | 'stabs'

/** How the chords and bass are played when the arpeggiator is off. */
export interface Rhythm {
  chords: ChordRhythm
  /** Held for each chord, or on the drum track's kicks, walking into the next chord. */
  bass: 'held' | 'kick'
}

export const DEFAULT_RHYTHM: Rhythm = { chords: 'held', bass: 'kick' }

export const CHORD_RHYTHMS: { id: ChordRhythm; label: string; about: string }[] = [
  { id: 'held', label: 'Held', about: 'Each chord rings for its whole length' },
  { id: 'pulse', label: 'Pulse', about: 'Short chords on every eighth note' },
  { id: 'beats', label: 'Beats', about: 'A chord on every beat' },
  { id: 'tresillo', label: 'Push', about: 'Three-three-two across the bar, as in pop and dance' },
  { id: 'offbeat', label: 'Offbeat', about: 'Short chords between the beats, as in ska and reggae' },
  { id: 'stabs', label: 'Stabs', about: 'Short chords with the snare' },
]

/** Where a rhythm strikes in one bar, in beats from its start. */
function rhythmBar(rhythm: ChordRhythm, timeSig: TimeSig): number[] {
  const num = timeSig[0]
  const step = eighth(timeSig)
  const felt = pulses(timeSig)
  const eighths = Array.from({ length: Math.round(num / step) }, (_, i) => i * step)
  if (rhythm === 'pulse') return eighths
  if (rhythm === 'beats') return felt
  if (rhythm === 'offbeat') return eighths.filter((b) => !felt.includes(b))
  if (rhythm === 'stabs') return felt.filter((_, i) => i % 2 === 1)
  if (rhythm === 'tresillo') {
    // Groups of three eighths while more than four are left, then twos (or a last three).
    const at: number[] = []
    let rest = eighths.length
    let pos = 0
    while (rest > 0) {
      at.push(pos * step)
      const size = rest > 4 || rest === 3 ? 3 : 2
      pos += size
      rest -= size
    }
    return at
  }
  return [0]
}

/** How long each strike of a rhythm rings: to the next strike, or a short stab. */
const RING: Record<ChordRhythm, { share: number; short: boolean }> = {
  held: { share: 1, short: false },
  pulse: { share: 0.7, short: true },
  beats: { share: 0.9, short: false },
  tresillo: { share: 0.9, short: false },
  offbeat: { share: 0.6, short: true },
  stabs: { share: 0.8, short: true },
}

/** The beats in [start, end) where a bar-long pattern strikes, bar after bar. */
function strikes(bar: number[], perBar: number, start: number, end: number) {
  const at: number[] = []
  for (let b = Math.floor(start / perBar) * perBar; b < end; b += perBar) {
    for (const x of bar) if (b + x >= start && b + x < end) at.push(b + x)
  }
  return at
}

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
  /** A silent chord keeps its place and its voicing, so the chords around it lead into each other as usual, but isn't played. */
  chords: (Chord & { silent?: boolean })[]
  arp: Arp
  rhythm?: Rhythm
  /** Where the drum track's kick drum plays, in beats, for the bass to follow. */
  kicks?: number[]
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
  const perBar = song.timeSig[0]
  const step = eighth(song.timeSig)
  const rhythm = song.rhythm ?? DEFAULT_RHYTHM
  const voiced = voiceProgression(song.key, song.mode, song.chords)
  const hits: Hit[] = []
  let beat = 0
  song.chords.forEach((c, i) => {
    const chordStart = beat
    const chordEnd = beat + c.beats
    let start = chordStart
    let end = chordEnd
    beat = chordEnd
    if (c.silent) return
    if (region) {
      start = Math.max(start, region.start)
      end = Math.min(end, region.end)
      if (end <= start) return
    }
    const s = start * quartersPerBeat
    const e = end * quartersPerBeat
    const { notes, bass } = voiced[i]
    const q = (b: number) => b * quartersPerBeat

    // Struck from start to end, each ringing to the next (times `share`, and no longer than an eighth if short).
    const strike = (at: number[], share: number, short: boolean, make: (beat: number, dur: number, first: boolean) => Hit) =>
      at.forEach((b, j) => {
        const next = at[j + 1] ?? end
        const ring = (short ? Math.min(next - b, step) : next - b) * share
        hits.push(make(b, ring, b % perBar === 0))
      })

    // The bass on the kicks, and on the chord's first beat, where the drums have any.
    const kicks = rhythm.bass === 'kick' ? (song.kicks ?? []).filter((k) => k >= chordStart && k < chordEnd) : []
    const bassOnKicks = song.kicks !== undefined && kicks.length > 0
    const padHeld = !song.arp.on && rhythm.chords === 'held'

    if (padHeld || !bassOnKicks) {
      hits.push({ start: s, dur: e - s, pad: padHeld ? notes : [], bass: bassOnKicks ? null : bass, velocity: 0.8, held: true })
    }
    if (song.arp.on) hits.push(...arpeggiate(notes, s, e, song.arp, i + 1))
    else if (!padHeld) {
      const at = strikes(rhythmBar(rhythm.chords, song.timeSig), perBar, start, end)
      // A chord that changes between strikes still sounds as it changes, except in the patterns that leave the beat open.
      if (start === chordStart && at[0] !== start && rhythm.chords !== 'offbeat' && rhythm.chords !== 'stabs') at.unshift(start)
      const { share, short } = RING[rhythm.chords]
      strike(at, share, short, (b, dur, first) => ({ start: q(b), dur: q(dur), pad: notes, bass: null, velocity: first ? 0.85 : 0.72, held: false }))
    }

    if (bassOnKicks) {
      const at = [...new Set([...(start === chordStart ? [start] : []), ...kicks.filter((k) => k >= start && k < end)])].sort((a, b) => a - b)
      // Walk into the next chord from a semitone below, an eighth before it, when its bass note is a new one.
      const nextBass = voiced[i + 1]?.bass
      const walk = nextBass !== undefined && nextBass !== bass && chordEnd - step > chordStart && chordEnd - step >= start && chordEnd <= end
      const notesAt = walk ? [...at.filter((b) => b < chordEnd - step), chordEnd - step] : at
      strike(notesAt, 0.9, false, (b, dur) => ({
        start: q(b),
        dur: q(dur),
        pad: [],
        bass: walk && b === chordEnd - step ? nextBass - 1 : bass,
        velocity: 0.9,
        held: true,
      }))
    }
  })
  return hits
}
