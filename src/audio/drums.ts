import * as Tone from 'tone'
import type { TimeSig } from '../store'

export type DrumPiece = 'kick' | 'snare' | 'hat'
export type GrooveId = 'backbeat' | 'halftime' | 'four' | 'light'

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

export const grooveLabel = (id: GrooveId) => GROOVES.find((g) => g.id === id)?.label ?? id

/** General MIDI drum notes, for the export. */
export const DRUM_NOTES: Record<DrumPiece, number> = { kick: 36, snare: 38, hat: 42 }

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

/** One bar of a groove, as hits from the bar's start. */
export function grooveBar(groove: GrooveId, timeSig: TimeSig): DrumHit[] {
  const [num, den] = timeSig
  const felt = pulses(timeSig)
  const hits: DrumHit[] = []
  const hit = (beat: number, piece: DrumPiece, velocity: number) => hits.push({ beat, piece, velocity })
  // Hats on the eighths: half a beat in x/4, every beat in x/8, every other one in x/16.
  const hatStep = den === 4 ? 0.5 : den === 8 ? 1 : 2
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

/** A groove played from `start` for `beats` beats, bar after bar, cut off where it ends. */
export function grooveHits(groove: GrooveId | null, timeSig: TimeSig, start: number, beats: number): DrumHit[] {
  if (!groove || beats <= 0) return []
  const bar = grooveBar(groove, timeSig)
  const hits: DrumHit[] = []
  for (let at = 0; at < beats; at += timeSig[0]) {
    for (const h of bar) if (at + h.beat < beats) hits.push({ ...h, beat: start + at + h.beat })
  }
  return hits
}

export interface Kit {
  kick: Tone.MembraneSynth
  snare: Tone.NoiseSynth
  hat: Tone.MetalSynth
  snareTone: Tone.Filter
  out: Tone.Volume
}

/** A small synthesized kit, built in whichever Tone context is current, so playback and the WAV render match. */
export function createKit(): Kit {
  const out = new Tone.Volume(-6).toDestination()
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 6, envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 } }).connect(out)
  const snareTone = new Tone.Filter(1800, 'bandpass').connect(out)
  const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 } }).connect(snareTone)
  snare.volume.value = -4
  const hat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 6000, octaves: 1.5 }).connect(out)
  hat.frequency.value = 320
  hat.volume.value = -22
  return { kick, snare, hat, snareTone, out }
}

export function playDrum(kit: Kit, piece: DrumPiece, time: number, velocity: number) {
  if (piece === 'kick') kit.kick.triggerAttackRelease('C1', 0.2, time, velocity)
  else if (piece === 'snare') kit.snare.triggerAttackRelease(0.14, time, velocity)
  else kit.hat.triggerAttackRelease(0.04, time, velocity)
}

export function disposeKit(kit: Kit) {
  Object.values(kit).forEach((node) => node.dispose())
}
