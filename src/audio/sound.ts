export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth'
/** What plays the chords: the synth, or one of the instruments built for a sound of their own. */
export type Instrument = 'synth' | 'piano' | 'epiano' | 'strings' | 'bell'

/** How the chords sound. Times are in seconds, levels 0–1. */
export interface Sound {
  /** Missing in sounds saved before there were instruments, which were all the synth. */
  instrument?: Instrument
  /** The synth's wave; the other instruments have their own. */
  wave: Wave
  attack: number
  decay: number
  sustain: number
  release: number
  /** Low-pass filter cutoff in Hz. */
  brightness: number
  reverb: number
  /** How far apart the synth's stacked oscillators are tuned, 0 (one clean note) to 1 (wide and thick). */
  width?: number
  /** A peak at the brightness cutoff, 0 (none) to 1 (squelchy). */
  resonance?: number
  bass: boolean
  /** How the bass sounds, when it plays; missing in sounds saved before it could change, which had the round one. */
  bassVoice?: Partial<BassVoice>
  /** The preset it started from, so the panel can show it picked, and put it back, after the settings are changed. */
  preset?: string
}

/**
 * The settings sounds saved before them don't have, filled in as they sounded
 * then: no resonance, and the width the synth (or strings) always had.
 */
export function extrasOf(sound: Sound) {
  return {
    width: sound.width ?? (instrumentOf(sound) === 'strings' ? 0.5 : 0.36),
    resonance: sound.resonance ?? 0,
  }
}

/** What plays the bass: a few classic bass sounds, each with its own character. */
export type BassKind = 'round' | 'sub' | 'finger' | 'acid' | '808'

/** The bass's sound: which one, how high, how bright, how it slides from note to note, and how loud against the chords. */
export interface BassVoice {
  kind: BassKind
  /** Octaves up or down from where it plays, around the second C below middle C. */
  octave: -1 | 0 | 1
  /** How bright it is, 0 (dark) to 1 (bright); the clean sine basses have nothing to brighten. */
  tone: number
  /** How far it slides into each new note, 0 (none) to 1 (a slow slur). */
  glide: number
  /** Its level against the chords, in dB. */
  level: number
}

export const BASS_KINDS: { id: BassKind; label: string; about: string }[] = [
  { id: 'round', label: 'Round', about: 'Warm and full, under anything' },
  { id: 'sub', label: 'Sub', about: 'A deep, clean low end, felt more than heard' },
  { id: 'finger', label: 'Finger', about: 'Plucked, like an electric bass' },
  { id: 'acid', label: 'Acid', about: 'A squelchy, resonant saw' },
  { id: '808', label: '808', about: 'A booming sine that drops into each note' },
]

/** Whether a bass sound has a tone to change: the sine ones are as clean as they get. */
export const hasTone = (kind: BassKind) => kind !== 'sub' && kind !== '808'

/** The bass's sound, with what a sound saved before it could change doesn't say filled in as it was: the round bass. */
export function bassVoiceOf(sound: Sound): BassVoice {
  return { kind: 'round', octave: 0, tone: 0.5, glide: 0, level: 0, ...sound.bassVoice }
}

export const WAVES: { id: Wave; label: string }[] = [
  { id: 'sine', label: 'Sine' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'square', label: 'Square' },
  { id: 'sawtooth', label: 'Saw' },
]

/** Which of the sound's settings each instrument listens to; the panel shows only those. */
// The filter and the reverb work on every instrument; width only on those built of stacked oscillators.
const EFFECTS: (keyof Sound)[] = ['brightness', 'resonance', 'reverb']
export const CONTROLS: Record<Instrument, (keyof Sound)[]> = {
  synth: ['wave', 'attack', 'decay', 'sustain', 'release', 'width', ...EFFECTS],
  strings: ['attack', 'decay', 'sustain', 'release', 'width', ...EFFECTS],
  epiano: ['attack', 'decay', 'sustain', 'release', ...EFFECTS],
  bell: ['attack', 'decay', 'sustain', 'release', ...EFFECTS],
  // A recorded note has its own decay; only how it starts and stops can change.
  piano: ['attack', 'release', ...EFFECTS],
}

/** The sound's instrument; the synth for sounds saved before there were instruments, or with one since taken out. */
export const instrumentOf = (sound: Sound): Instrument => (sound.instrument && sound.instrument in CONTROLS ? sound.instrument : 'synth')

/**
 * The sounds to pick from: the recorded piano, then the synth's, each only a
 * starting point for the settings (the last three on synth engines of their own).
 */
export const PRESETS: { name: string; about: string; sound: Sound }[] = [
  {
    name: 'Piano',
    about: 'A grand piano, recorded note by note',
    sound: { instrument: 'piano', wave: 'triangle', attack: 0.002, decay: 1, sustain: 1, release: 1, brightness: 9000, reverb: 0.2, bass: true },
  },
  {
    name: 'Synth',
    about: 'Bright and classic',
    sound: { instrument: 'synth', wave: 'sawtooth', attack: 0.015, decay: 0.4, sustain: 0.55, release: 0.9, brightness: 2200, reverb: 0.18, bass: true },
  },
  {
    name: 'Pad',
    about: 'Soft and wide, fading in',
    sound: { instrument: 'synth', wave: 'sawtooth', attack: 0.45, decay: 0.8, sustain: 0.75, release: 1.8, brightness: 1400, reverb: 0.4, bass: true },
  },
  {
    name: 'Keys',
    about: 'Short and mellow',
    sound: { instrument: 'synth', wave: 'triangle', attack: 0.005, decay: 0.9, sustain: 0.25, release: 0.6, brightness: 3200, reverb: 0.15, bass: true },
  },
  {
    name: 'Organ',
    about: 'Steady and full',
    sound: { instrument: 'synth', wave: 'square', attack: 0.01, decay: 0.1, sustain: 1, release: 0.12, brightness: 1600, reverb: 0.12, bass: true },
  },
  {
    name: 'Pluck',
    about: 'Short and bright',
    sound: { instrument: 'synth', wave: 'sawtooth', attack: 0.002, decay: 0.35, sustain: 0, release: 0.4, brightness: 2600, reverb: 0.22, bass: false },
  },
  {
    name: 'E-piano',
    about: 'An electric piano, soft and bell-like',
    sound: { instrument: 'epiano', wave: 'sine', attack: 0.003, decay: 1.6, sustain: 0.3, release: 0.8, brightness: 6000, reverb: 0.2, bass: true },
  },
  {
    name: 'Strings',
    about: 'A warm section, fading in',
    sound: { instrument: 'strings', wave: 'sawtooth', attack: 0.4, decay: 1, sustain: 0.85, release: 1.4, brightness: 2600, reverb: 0.35, bass: true },
  },
  {
    name: 'Bell',
    about: 'Glassy and ringing',
    sound: { instrument: 'bell', wave: 'sine', attack: 0.001, decay: 2.2, sustain: 0, release: 2, brightness: 9000, reverb: 0.3, bass: false },
  },
]

export const DEFAULT_SOUND = PRESETS.find((p) => p.name === 'Synth')!.sound

/** Square and saw waves are much louder than sine at the same level. */
export const WAVE_VOLUME: Record<Wave, number> = { sine: -11, triangle: -13, square: -21, sawtooth: -17 }

/** Each instrument's level, so they sit about as loud as each other. */
export const INSTRUMENT_VOLUME: Record<Exclude<Instrument, 'synth'>, number> = { piano: -4, epiano: -12, strings: -18, bell: -11 }

/** Whether a sound's settings differ from a preset's; the bass note is a choice of its own, not part of the sound. */
export function changedFrom(sound: Sound, preset: Sound) {
  const full = { ...sound, instrument: instrumentOf(sound) }
  const extras = extrasOf(sound)
  const presetExtras = extrasOf(preset)
  return (
    (Object.keys(preset) as (keyof Sound)[]).some((k) => k !== 'bass' && k !== 'preset' && preset[k] !== full[k]) ||
    (Object.keys(extras) as (keyof typeof extras)[]).some((k) => extras[k] !== presetExtras[k])
  )
}

/** The preset a sound was picked from, or the one it matches; null for a sound of one's own. */
export function presetFor(sound: Sound) {
  if (sound.preset && PRESETS.some((p) => p.name === sound.preset)) return sound.preset
  return PRESETS.find((p) => !changedFrom(sound, p.sound))?.name ?? null
}
