export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth'

/** How the chord synth sounds. Times are in seconds, levels 0–1. */
export interface Sound {
  wave: Wave
  attack: number
  decay: number
  sustain: number
  release: number
  /** Low-pass filter cutoff in Hz. */
  brightness: number
  reverb: number
  bass: boolean
}

export const WAVES: { id: Wave; label: string }[] = [
  { id: 'sine', label: 'Sine' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'square', label: 'Square' },
  { id: 'sawtooth', label: 'Saw' },
]

export const PRESETS: { name: string; sound: Sound }[] = [
  {
    name: 'Synth',
    sound: { wave: 'sawtooth', attack: 0.015, decay: 0.4, sustain: 0.55, release: 0.9, brightness: 2200, reverb: 0.18, bass: true },
  },
  {
    name: 'Pad',
    sound: { wave: 'sawtooth', attack: 0.45, decay: 0.8, sustain: 0.75, release: 1.8, brightness: 1400, reverb: 0.4, bass: true },
  },
  {
    name: 'Keys',
    sound: { wave: 'triangle', attack: 0.005, decay: 0.9, sustain: 0.25, release: 0.6, brightness: 3200, reverb: 0.15, bass: true },
  },
  {
    name: 'Organ',
    sound: { wave: 'square', attack: 0.01, decay: 0.1, sustain: 1, release: 0.12, brightness: 1600, reverb: 0.12, bass: true },
  },
  {
    name: 'Pluck',
    sound: { wave: 'sawtooth', attack: 0.002, decay: 0.35, sustain: 0, release: 0.4, brightness: 2600, reverb: 0.22, bass: false },
  },
]

export const DEFAULT_SOUND = PRESETS[0].sound

/** Square and saw waves are much louder than sine at the same level. */
export const WAVE_VOLUME: Record<Wave, number> = { sine: -11, triangle: -13, square: -21, sawtooth: -17 }

export function presetFor(sound: Sound) {
  return PRESETS.find((p) => (Object.keys(p.sound) as (keyof Sound)[]).every((k) => p.sound[k] === sound[k]))?.name ?? null
}
