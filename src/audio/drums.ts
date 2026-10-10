import * as Tone from 'tone'
import type { TimeSig } from '../store'

export type DrumPiece = 'kick' | 'snare' | 'hat' | 'tomHigh' | 'tomLow'
export type GrooveId = 'backbeat' | 'halftime' | 'four' | 'light'
/** Where a section's drums play a fill: never, into whatever comes after it, or every four bars too. */
export type FillId = 'none' | 'end' | 'four'

/** One drum hit, in beats of the time signature from the start of the song. */
export interface DrumHit {
  beat: number
  piece: DrumPiece
  velocity: number
}

export const GROOVES: { id: GrooveId; label: string; about: string }[] = [
  { id: 'backbeat', label: 'Backbeat', about: 'Kick on the strong beats, snare on the ones between' },
  { id: 'halftime', label: 'Half-time', about: 'One snare, halfway through the bar' },
  { id: 'four', label: 'Four on the floor', about: 'Kick on every beat, hats between' },
  { id: 'light', label: 'Light', about: 'A kick to start the bar, and hats' },
]

export const FILLS: { id: FillId; label: string; about: string }[] = [
  { id: 'none', label: 'None', about: 'The groove plays through' },
  { id: 'end', label: 'At the end', about: 'Rolls into whatever comes next' },
  { id: 'four', label: 'Every 4 bars', about: 'And at the end' },
]

export const grooveLabel = (id: GrooveId) => GROOVES.find((g) => g.id === id)?.label ?? id

/** General MIDI drum notes, for the export. */
export const DRUM_NOTES: Record<DrumPiece, number> = { kick: 36, snare: 38, hat: 42, tomHigh: 48, tomLow: 45 }

/**
 * Where the felt beats fall in a bar, in beats: every beat in x/4; in x/8 and
 * x/16, groups of three where the bar divides into them (6/8, 9/8, 12/8,
 * 15/16), otherwise twos with a three at the end (5/8 as 2+3, 7/8 as 2+2+3).
 */
export function pulses([num, den]: TimeSig): number[] {
  if (den === 4 || num < 3) return Array.from({ length: den === 4 ? num : 1 }, (_, i) => i)
  const groups = num % 3 === 0 ? Array(num / 3).fill(3) : [...Array(Math.floor((num - 3) / 2)).fill(2), 3]
  const at: number[] = []
  groups.reduce((beat, size) => (at.push(beat), beat + size), 0)
  return at
}

/** An eighth note, in beats: half a beat in x/4, a beat in x/8, two in x/16. */
export const eighth = ([, den]: TimeSig) => (den === 4 ? 0.5 : den === 8 ? 1 : 2)

/** One bar of a groove, as hits from the bar's start. */
export function grooveBar(groove: GrooveId, timeSig: TimeSig): DrumHit[] {
  const [num] = timeSig
  const felt = pulses(timeSig)
  const hits: DrumHit[] = []
  const hit = (beat: number, piece: DrumPiece, velocity: number) => hits.push({ beat, piece, velocity })
  // Hats on the eighths.
  const hatStep = eighth(timeSig)
  const hats = (offbeatsOnly: boolean) => {
    for (let b = 0; b < num - 1e-6; b += hatStep) {
      const onPulse = felt.includes(b)
      if (!offbeatsOnly || !onPulse) hit(b, 'hat', onPulse ? 0.6 : 0.4)
    }
  }

  if (groove === 'backbeat') {
    felt.forEach((b, i) => hit(b, i % 2 ? 'snare' : 'kick', i === 0 ? 1 : 0.85))
    hats(false)
  } else if (groove === 'halftime') {
    hit(0, 'kick', 1)
    if (felt.length > 1) hit(felt[Math.floor(felt.length / 2)], 'snare', 0.9)
    hats(false)
  } else if (groove === 'four') {
    felt.forEach((b, i) => {
      hit(b, 'kick', i === 0 ? 1 : 0.9)
      if (i % 2) hit(b, 'snare', 0.8)
    })
    hats(true)
  } else {
    hit(0, 'kick', 0.9)
    felt.forEach((b) => hit(b, 'hat', 0.5))
  }
  return hits
}

/**
 * How long a fill runs, in beats: the back half of the bar, from its middle
 * felt beat (two beats in 4/4, three in 6/8), or half the bar if it has one.
 */
export function fillLength(timeSig: TimeSig): number {
  const [num] = timeSig
  const felt = pulses(timeSig)
  return felt.length > 1 ? num - felt[Math.floor(felt.length / 2)] : num / 2
}

/**
 * A fill of `length` beats from the start: a kick, then a roll in sixteenths
 * (half eighths) from the snare down the high tom to the low one, building up.
 */
export function fillHits(timeSig: TimeSig, length: number): DrumHit[] {
  const step = eighth(timeSig) / 2
  const count = Math.max(1, Math.round(length / step))
  const pieces: DrumPiece[] = ['snare', 'tomHigh', 'tomLow']
  const hits: DrumHit[] = [{ beat: 0, piece: 'kick', velocity: 0.9 }]
  for (let i = 0; i < count; i++) {
    const piece = pieces[Math.min(2, Math.floor((i * 3) / count))]
    hits.push({ beat: i * step, piece, velocity: 0.55 + (0.45 * i) / Math.max(1, count - 1) })
  }
  return hits
}

/**
 * A groove played from `start` for `beats` beats, bar after bar, cut off where
 * it ends; with a fill, the groove gives way to one at the end (and, for
 * 'four', at the end of every fourth bar too).
 */
export function grooveHits(groove: GrooveId | null, timeSig: TimeSig, start: number, beats: number, fill: FillId = 'none'): DrumHit[] {
  if (!groove || beats <= 0) return []
  const [num] = timeSig
  const bar = grooveBar(groove, timeSig)
  const hits: DrumHit[] = []
  for (let at = 0; at < beats; at += num) {
    for (const h of bar) if (at + h.beat < beats) hits.push({ ...h, beat: at + h.beat })
  }
  // Where each fill ends: the section's end, and every four bars before it.
  const ends = fill === 'none' ? [] : [beats]
  if (fill === 'four') for (let end = 4 * num; end < beats - 1e-6; end += 4 * num) ends.push(end)
  const length = fillLength(timeSig)
  const filled: DrumHit[] = []
  const spans = ends.map((end) => [Math.max(0, end - length), end])
  for (const [from, to] of spans) filled.push(...fillHits(timeSig, to - from).map((h) => ({ ...h, beat: from + h.beat })))
  const kept = hits.filter((h) => !spans.some(([from, to]) => h.beat >= from - 1e-6 && h.beat < to - 1e-6))
  return [...kept, ...filled].sort((a, b) => a.beat - b.beat).map((h) => ({ ...h, beat: start + h.beat }))
}

/** The kit's usual level, in dB, which the drum track's volume is added to. */
export const KIT_VOLUME = -6

export interface Kit {
  kick: Tone.MembraneSynth
  snare: Tone.NoiseSynth
  hat: Tone.NoiseSynth
  tom: Tone.MembraneSynth
  snareTone: Tone.Filter
  hatTone: Tone.Filter
  out: Tone.Volume
}

/** A small synthesized kit, built in whichever Tone context is current, so playback and the WAV render match. */
export function createKit(): Kit {
  const out = new Tone.Volume(KIT_VOLUME).toDestination()
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 6, envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 } }).connect(out)
  const snareTone = new Tone.Filter(1800, 'bandpass').connect(out)
  const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 } }).connect(snareTone)
  snare.volume.value = -4
  // Filtered noise rather than Tone's MetalSynth, which can't be struck twice in an offline render.
  const hatTone = new Tone.Filter(7000, 'highpass').connect(out)
  const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.045, sustain: 0 } }).connect(hatTone)
  hat.volume.value = -12
  // One drum for both toms, tuned high or low as it's struck.
  const tom = new Tone.MembraneSynth({ pitchDecay: 0.06, octaves: 2.5, envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.1 } }).connect(out)
  tom.volume.value = -3
  return { kick, snare, hat, tom, snareTone, hatTone, out }
}

export function playDrum(kit: Kit, piece: DrumPiece, time: number, velocity: number) {
  if (piece === 'kick') kit.kick.triggerAttackRelease('C1', 0.2, time, velocity)
  else if (piece === 'snare') kit.snare.triggerAttackRelease(0.14, time, velocity)
  else if (piece === 'hat') kit.hat.triggerAttackRelease(0.04, time, velocity)
  else kit.tom.triggerAttackRelease(piece === 'tomHigh' ? 'A2' : 'E2', 0.3, time, velocity)
}

export function disposeKit(kit: Kit) {
  Object.values(kit).forEach((node) => node.dispose())
}
