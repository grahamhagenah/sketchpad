import * as Tone from 'tone'
import { WAVE_VOLUME, type Sound } from './sound'

export const midiToHz = (m: number) => Tone.Frequency(m, 'midi').toFrequency()

// Under the chords, rather than level with them.
const BASS_VOLUME = -14

export interface Instruments {
  pad: Tone.PolySynth
  bass: Tone.MonoSynth
  filter: Tone.Filter
  reverb: Tone.Reverb
  /** The chords track's level: the pad and bass both run through it. */
  bus: Tone.Volume
}

/**
 * The pad and bass the song plays on, built in whichever Tone context is
 * current, so live playback and the WAV render sound the same.
 */
export function createInstruments(sound: Sound): Instruments {
  const bus = new Tone.Volume(0).toDestination()
  const reverb = new Tone.Reverb({ decay: 2.4 }).connect(bus)
  const filter = new Tone.Filter(sound.brightness, 'lowpass').connect(reverb)
  const pad = new Tone.PolySynth(Tone.Synth).connect(filter)
  const bass = new Tone.MonoSynth({
    oscillator: { type: 'triangle' },
    filterEnvelope: { baseFrequency: 160, octaves: 2, attack: 0.01, decay: 0.3, sustain: 0.35 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.4 },
  }).connect(bus)
  const instruments = { pad, bass, filter, reverb, bus }
  applySound(instruments, sound)
  return instruments
}

/** Retunes existing instruments to a sound, so changes are heard straight away. */
export function applySound({ pad, bass, filter, reverb }: Instruments, sound: Sound) {
  pad.set({
    // Sine stays pure; the others get a little detuned thickness.
    oscillator: sound.wave === 'sine' ? { type: 'sine' } : { type: `fat${sound.wave}`, count: 3, spread: 18 },
    envelope: { attack: sound.attack, decay: sound.decay, sustain: sound.sustain, release: sound.release },
  } as Partial<Tone.SynthOptions>)
  pad.volume.value = WAVE_VOLUME[sound.wave]
  filter.frequency.value = sound.brightness
  reverb.wet.value = sound.reverb
  bass.volume.value = sound.bass ? BASS_VOLUME : -Infinity
}

/** The room the vocals share, in whichever Tone context is current; each track sends to it as much as its reverb says. */
export const createVocalRoom = () => new Tone.Reverb({ decay: 2.2, preDelay: 0.02, wet: 1 }).toDestination()

/** Plays a take straight out, and sends it to the room by `amount` (0 to 1); returns the send, to change later. */
export function routeVocal(player: Tone.Player, room: Tone.Reverb, amount: number) {
  const send = new Tone.Gain(amount).connect(room)
  player.toDestination().connect(send)
  return send
}
