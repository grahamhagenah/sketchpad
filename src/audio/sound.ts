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
  bass: boolean
  /** The preset it started from, so the panel can show it picked, and put it back, after the settings are changed. */
  preset?: string
}

export const WAVES: { id: Wave; label: string }[] = [
  { id: 'sine', label: 'Sine' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'square', label: 'Square' },
  { id: 'sawtooth', label: 'Saw' },
]

/** Which of the sound's settings each instrument listens to; the panel shows only those. */
export const CONTROLS: Record<Instrument, (keyof Sound)[]> = {
  synth: ['wave', 'attack', 'decay', 'sustain', 'release', 'brightness', 'reverb'],
  strings: ['attack', 'decay', 'sustain', 'release', 'brightness', 'reverb'],
  epiano: ['attack', 'decay', 'sustain', 'release', 'brightness', 'reverb'],
  bell: ['attack', 'decay', 'sustain', 'release', 'brightness', 'reverb'],
  // A recorded note has its own decay; only how it starts and stops can change.
  piano: ['attack', 'release', 'brightness', 'reverb'],
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
  return (Object.keys(preset) as (keyof Sound)[]).some((k) => k !== 'bass' && k !== 'preset' && preset[k] !== full[k])
}

/** The preset a sound was picked from, or the one it matches; null for a sound of one's own. */
export function presetFor(sound: Sound) {
  if (sound.preset && PRESETS.some((p) => p.name === sound.preset)) return sound.preset
  return PRESETS.find((p) => !changedFrom(sound, p.sound))?.name ?? null
}
