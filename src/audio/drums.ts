import * as Tone from 'tone'
import type { TimeSig } from '../store'

export type DrumPiece = 'kick' | 'snare' | 'hat' | 'tomHigh' | 'tomLow' | 'crash' | 'openHat' | 'clap' | 'rim'
export type GrooveId = 'backbeat' | 'halftime' | 'four' | 'light' | 'rock' | 'ballad' | 'shuffle' | 'disco' | 'funk' | 'trap' | 'dnb' | 'dembow' | 'bossa'
/** How busy a section's drums are: fewer hats and no ghost notes, as written, or sixteenth hats and a pickup kick. */
export type DrumIntensity = 'sparse' | 'normal' | 'busy'
/** Where a section's drums play a fill: never, into whatever comes after it, or every four bars too. */
export type FillId = 'none' | 'end' | 'four'

/** One drum hit, in beats of the time signature from the start of the song. */
export interface DrumHit {
  beat: number
  piece: DrumPiece
  velocity: number
}

/** A bar of beats you'd feel as quarter notes, two by two: what the grooves written in quarters need. */
const inQuarters = ([num, den]: TimeSig) => den === 4 && num % 2 === 0

export const GROOVES: { id: GrooveId; label: string; about: string; fits?: (timeSig: TimeSig) => boolean }[] = [
  { id: 'backbeat', label: 'Backbeat', about: 'Kick on the strong beats, snare on the ones between' },
  { id: 'rock', label: 'Rock', about: 'A backbeat with a pushed kick, driving eighths on the hats' },
  { id: 'halftime', label: 'Half-time', about: 'One snare, halfway through the bar' },
  { id: 'ballad', label: 'Ballad', about: 'Soft and sparse: a kick, a rim click, quiet hats' },
  { id: 'light', label: 'Light', about: 'A kick to start the bar, and hats' },
  { id: 'shuffle', label: 'Shuffle', about: 'A swung backbeat, long-short, for blues and 12/8' },
  { id: 'four', label: 'Four on the floor', about: 'Kick on every beat, hats between' },
  { id: 'disco', label: 'Disco', about: 'Four on the floor with claps and open hats on the offbeats' },
  { id: 'funk', label: 'Funk', about: 'Sixteenth hats, a syncopated kick and ghost notes on the snare', fits: ([, den]) => den === 4 },
  { id: 'trap', label: 'Trap', about: 'Half-time claps over rolling sixteenth hats and a booming kick' },
  { id: 'dnb', label: 'Drum & bass', about: 'The two-step: kick, snare, the kick pushed late, snare; best around 170 BPM', fits: inQuarters },
  { id: 'dembow', label: 'Dembow', about: 'Reggaeton: a kick on every beat under the three-three-two snare', fits: inQuarters },
  { id: 'bossa', label: 'Bossa nova', about: 'Rim clicks across the bar over a soft, rocking kick', fits: inQuarters },
]

/** Whether a groove is written for this time signature; one that isn't plays as a backbeat. */
export const grooveFits = (groove: GrooveId, timeSig: TimeSig) => GROOVES.find((g) => g.id === groove)?.fits?.(timeSig) ?? true

export const INTENSITIES: { id: DrumIntensity; label: string; about: string }[] = [
  { id: 'sparse', label: 'Sparse', about: 'Fewer hats and no ghost notes, for a quieter part' },
  { id: 'normal', label: 'Normal', about: 'The groove as it’s written' },
  { id: 'busy', label: 'Busy', about: 'Sixteenth hats and a pickup kick, to lift a chorus' },
]

export const FILLS: { id: FillId; label: string; about: string }[] = [
  { id: 'none', label: 'Off', about: 'The groove plays straight through' },
  { id: 'end', label: 'End', about: 'A fill at the end, rolling into whatever comes next' },
  { id: 'four', label: 'Every 4', about: 'A fill every four bars, and at the end' },
]

export const grooveLabel = (id: GrooveId) => GROOVES.find((g) => g.id === id)?.label ?? id

/** General MIDI drum notes, for the export. */
export const DRUM_NOTES: Record<DrumPiece, number> = { kick: 36, snare: 38, hat: 42, tomHigh: 48, tomLow: 45, crash: 49, openHat: 46, clap: 39, rim: 37 }

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
  const step = eighth(timeSig)
  const sixteenth = step / 2
  const middle = felt.length > 1 ? felt[Math.floor(felt.length / 2)] : null
  // Hats on the eighths (or every `every` beats), louder on the felt beats.
  const hats = (offbeatsOnly = false, every = step) => {
    for (let b = 0; b < num - 1e-6; b += every) {
      const onPulse = felt.includes(b)
      if (!offbeatsOnly || !onPulse) hit(b, 'hat', onPulse ? 0.6 : 0.4)
    }
  }
  const backbeat = () => felt.forEach((b, i) => hit(b, i % 2 ? 'snare' : 'kick', i === 0 ? 1 : 0.85))
  if (!grooveFits(groove, timeSig)) groove = 'backbeat'

  if (groove === 'backbeat') {
    backbeat()
    hats()
  } else if (groove === 'rock') {
    backbeat()
    // The kick pushed onto the eighth before the third felt beat, as in most rock.
    if (felt.length > 2) hit(felt[2] - step, 'kick', 0.75)
    hats()
  } else if (groove === 'halftime') {
    hit(0, 'kick', 1)
    if (middle !== null) hit(middle, 'snare', 0.9)
    hats()
  } else if (groove === 'ballad') {
    hit(0, 'kick', 0.8)
    if (middle !== null) hit(middle, 'rim', 0.7)
    felt.forEach((b) => hit(b, 'hat', 0.35))
  } else if (groove === 'shuffle') {
    backbeat()
    // Long-short: each felt beat's hat, and another two thirds of the way to the next.
    felt.forEach((b, i) => {
      const next = felt[i + 1] ?? num
      hit(b, 'hat', 0.6)
      hit(b + ((next - b) * 2) / 3, 'hat', 0.4)
    })
  } else if (groove === 'four') {
    felt.forEach((b, i) => {
      hit(b, 'kick', i === 0 ? 1 : 0.9)
      if (i % 2) hit(b, 'snare', 0.8)
    })
    hats(true)
  } else if (groove === 'disco') {
    felt.forEach((b, i) => {
      const next = felt[i + 1] ?? num
      hit(b, 'kick', i === 0 ? 1 : 0.9)
      hit(b, 'hat', 0.45)
      if (i % 2) hit(b, 'clap', 0.85)
      // The open hat halfway to the next beat: the disco offbeat.
      hit((b + next) / 2, 'openHat', 0.6)
    })
  } else if (groove === 'funk') {
    // 4/4 as written: kick on 1, the "and" of 2 and the "e" of 3; snare on 2 and 4 with ghost notes around them.
    felt.forEach((b, i) => {
      if (i % 2) hit(b, 'snare', 0.9)
      else hit(b, 'kick', i === 0 ? 1 : 0.8)
    })
    hit(1.5, 'kick', 0.75)
    hit(2.25, 'kick', 0.6)
    for (const ghost of [0.75, 1.75, 2.5, 3.25]) if (ghost < num) hit(ghost, 'snare', 0.25)
    hats(false, sixteenth)
  } else if (groove === 'trap') {
    hit(0, 'kick', 1)
    hit(Math.round((num * 3) / 8 / sixteenth) * sixteenth, 'kick', 0.8)
    if (middle !== null) hit(middle, 'clap', 0.95)
    // Sixteenth hats, with the last felt beat rolled in triplet thirty-seconds.
    const roll = felt[felt.length - 1] ?? 0
    for (let b = 0; b < roll - 1e-6; b += sixteenth) hit(b, 'hat', felt.includes(b) ? 0.55 : 0.35)
    const rollStep = sixteenth / 1.5
    for (let b = roll; b < num - 1e-6; b += rollStep) hit(b, 'hat', 0.3 + (0.3 * (b - roll)) / (num - roll))
  } else if (groove === 'dnb') {
    // Two beats at a time: kick then snare, and in every other pair the kick pushed half a beat late, with a ghost snare rolling into the next bar.
    for (let b = 0; b < num; b += 2) {
      const pushed = (b / 2) % 2 === 1
      hit(b + (pushed ? 0.5 : 0), 'kick', pushed ? 0.85 : 1)
      hit(b + 1, 'snare', 0.95)
      if (pushed) hit(b + 1.75, 'snare', 0.3)
    }
    hats()
  } else if (groove === 'dembow') {
    // Every two beats: the kick on each, and the snare on the "a" of the first and the "and" of the second.
    for (let b = 0; b < num; b += 2) {
      hit(b, 'kick', b === 0 ? 1 : 0.9)
      hit(b + 1, 'kick', 0.85)
      hit(b + 0.75, 'snare', 0.8)
      hit(b + 1.5, 'snare', 0.85)
    }
    hats()
  } else if (groove === 'bossa') {
    // Kick on 1 and 3 with a soft pickup before each; rim clicks on 1, the "and" of 2, and 4.
    for (let b = 0; b < num; b += 2) {
      hit(b, 'kick', 0.7)
      hit(b + 1.5, 'kick', 0.45)
    }
    for (const r of [0, 1.5, 3]) if (r < num) hit(r, 'rim', 0.7)
    hats(false, step)
  } else {
    hit(0, 'kick', 0.9)
    felt.forEach((b) => hit(b, 'hat', 0.5))
  }
  return hits.sort((a, b) => a.beat - b.beat)
}

/**
 * A bar played sparser or busier: sparse keeps only the hats on the felt beats
 * and drops ghost notes; busy fills the hats in to sixteenths and adds a kick
 * on the bar's last eighth, leading into the next.
 */
function withIntensity(bar: DrumHit[], timeSig: TimeSig, intensity: DrumIntensity): DrumHit[] {
  if (intensity === 'normal') return bar
  const felt = pulses(timeSig)
  if (intensity === 'sparse') return bar.filter((h) => h.velocity >= 0.3 && (h.piece !== 'hat' || felt.includes(h.beat)))
  const [num] = timeSig
  const half = eighth(timeSig)
  const step = half / 2
  const busy = [...bar]
  const hats = bar.filter((h) => h.piece === 'hat' || h.piece === 'openHat')
  const hatAt = new Set(hats.map((h) => h.beat))
  // Only hats on straight eighths fill in: not a ballad's quarters, a shuffle's swing, or sixteenths already there.
  const straightEighths = hats.length >= num / half && hats.length < num / step && hats.every((h) => Math.abs(h.beat / half - Math.round(h.beat / half)) < 1e-6)
  if (straightEighths) for (let b = 0; b < num - 1e-6; b += step) if (!hatAt.has(b)) busy.push({ beat: b, piece: 'hat', velocity: 0.28 })
  const pickup = num - half
  if (!bar.some((h) => h.piece === 'kick' && Math.abs(h.beat - pickup) < 1e-6)) busy.push({ beat: pickup, piece: 'kick', velocity: 0.6 })
  return busy.sort((a, b) => a.beat - b.beat)
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
function fillHits(timeSig: TimeSig, length: number): DrumHit[] {
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

/** How a section's drums are played, beyond its groove and fills. */
export interface GrooveOptions {
  intensity?: DrumIntensity
  /** A crash on the first beat, coming in from a fill before it. */
  crashAtStart?: boolean
}

/**
 * A groove played from `start` for `beats` beats, bar after bar, cut off where
 * it ends; with a fill, the groove gives way to one at the end (and, for
 * 'four', at the end of every fourth bar too), and a crash lands on the beat
 * after each fill inside it.
 */
export function grooveHits(groove: GrooveId | null, timeSig: TimeSig, start: number, beats: number, fill: FillId = 'none', options: GrooveOptions = {}): DrumHit[] {
  if (!groove || beats <= 0) return []
  const [num] = timeSig
  const bar = withIntensity(grooveBar(groove, timeSig), timeSig, options.intensity ?? 'normal')
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
  // The crash takes the place of the hat where it lands.
  const crashes = [...(options.crashAtStart ? [0] : []), ...ends.filter((end) => end < beats - 1e-6)]
  const played = kept.filter((h) => !(crashes.includes(h.beat) && (h.piece === 'hat' || h.piece === 'openHat')))
  const crashed = crashes.map((beat): DrumHit => ({ beat, piece: 'crash', velocity: 0.85 }))
  return [...played, ...filled, ...crashed].sort((a, b) => a.beat - b.beat).map((h) => ({ ...h, beat: start + h.beat }))
}

/** The kit's usual level, in dB, which the drum track's volume is added to. */
export const KIT_VOLUME = -6

export interface Kit {
  kick: Tone.MembraneSynth
  snare: Tone.NoiseSynth
  hat: Tone.NoiseSynth
  openHat: Tone.NoiseSynth
  crash: Tone.NoiseSynth
  clap: Tone.NoiseSynth
  rim: Tone.MembraneSynth
  tom: Tone.MembraneSynth
  snareTone: Tone.Filter
  hatTone: Tone.Filter
  crashTone: Tone.Filter
  clapTone: Tone.Filter
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
  // The open hat rings on where the closed one is choked; the crash is the same noise, longer and a little darker.
  const openHat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.32, sustain: 0 } }).connect(hatTone)
  openHat.volume.value = -15
  const crashTone = new Tone.Filter(4200, 'highpass').connect(out)
  const crash = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.002, decay: 1.4, sustain: 0 } }).connect(crashTone)
  crash.volume.value = -14
  // A clap: noise through a band around 1.2 kHz, struck three times in quick succession (see playDrum).
  const clapTone = new Tone.Filter(1200, 'bandpass').connect(out)
  clapTone.Q.value = 1.4
  const clap = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.09, sustain: 0 } }).connect(clapTone)
  clap.volume.value = -2
  // A rim click: a tiny, high, very short drum.
  const rim = new Tone.MembraneSynth({ pitchDecay: 0.005, octaves: 1.5, envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 } }).connect(out)
  rim.volume.value = -10
  return { kick, snare, hat, openHat, crash, clap, rim, tom, snareTone, hatTone, crashTone, clapTone, out }
}

export function playDrum(kit: Kit, piece: DrumPiece, time: number, velocity: number) {
  if (piece === 'kick') kit.kick.triggerAttackRelease('C1', 0.2, time, velocity)
  else if (piece === 'snare') kit.snare.triggerAttackRelease(0.14, time, velocity)
  else if (piece === 'hat') kit.hat.triggerAttackRelease(0.04, time, velocity)
  else if (piece === 'openHat') kit.openHat.triggerAttackRelease(0.3, time, velocity)
  else if (piece === 'crash') kit.crash.triggerAttackRelease(1.2, time, velocity)
  else if (piece === 'rim') kit.rim.triggerAttackRelease('E5', 0.05, time, velocity)
  else if (piece === 'clap') {
    // Three hands, a moment apart, the last the loudest.
    kit.clap.triggerAttackRelease(0.01, time, velocity * 0.6)
    kit.clap.triggerAttackRelease(0.01, time + 0.011, velocity * 0.7)
    kit.clap.triggerAttackRelease(0.09, time + 0.022, velocity)
  } else kit.tom.triggerAttackRelease(piece === 'tomHigh' ? 'A2' : 'E2', 0.3, time, velocity)
}

export function disposeKit(kit: Kit) {
  Object.values(kit).forEach((node) => node.dispose())
}
