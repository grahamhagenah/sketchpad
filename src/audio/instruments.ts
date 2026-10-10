import * as Tone from 'tone'
import { INSTRUMENT_VOLUME, instrumentOf, WAVE_VOLUME, type Instrument, type Sound } from './sound'

export const midiToHz = (m: number) => Tone.Frequency(m, 'midi').toFrequency()

// Under the chords, rather than level with them.
const BASS_VOLUME = -14

/**
 * The piano's notes, recorded every minor third (Salamander Grand Piano, by
 * Alexander Holm, CC BY 3.0), served with the site and loaded the first time
 * the piano is picked; the sampler bends each to the notes between.
 */
const PIANO_NOTES = ['A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7']
let piano: Promise<Record<string, AudioBuffer>> | null = null
/** The notes once loaded, so a piano made after that (as in the WAV render) plays from its first note. */
let pianoNotes: Record<string, AudioBuffer> | null = null

/** Loads the piano's notes once; they're plain audio, so playback and the WAV render share them. */
export function loadPiano() {
  piano ??= Promise.all(
    PIANO_NOTES.map(async (n) => [n.replace('s', '#'), (await Tone.ToneAudioBuffer.fromUrl(`/samples/piano/${n}.mp3`)).get()!] as const),
  )
    .then((pairs) => (pianoNotes = Object.fromEntries(pairs)))
    .catch((err) => {
      // Let a later pick try again, as on a flaky connection.
      piano = null
      throw err
    })
  return piano
}

/** One way of playing the chords; the pad swaps between them as the instrument changes. */
interface Voice {
  play(freqs: number[], duration: number, time: number, velocity: number): void
  apply(sound: Sound): void
  releaseAll(): void
  dispose(): void
}

function synthVoice(out: Tone.ToneAudioNode, kind: 'synth' | 'strings'): Voice {
  const synth = new Tone.PolySynth(Tone.Synth).connect(out)
  return {
    play: (freqs, duration, time, velocity) => synth.triggerAttackRelease(freqs, duration, time, velocity),
    apply(sound) {
      synth.set({
        // Strings are a section of slightly out-of-tune saws; the synth's sine stays pure, its other waves a little thick.
        oscillator:
          kind === 'strings'
            ? { type: 'fatsawtooth', count: 6, spread: 34 }
            : sound.wave === 'sine'
              ? { type: 'sine' }
              : { type: `fat${sound.wave}`, count: 3, spread: 18 },
        envelope: { attack: sound.attack, decay: sound.decay, sustain: sound.sustain, release: sound.release },
      } as Partial<Tone.SynthOptions>)
      synth.volume.value = kind === 'strings' ? INSTRUMENT_VOLUME.strings : WAVE_VOLUME[sound.wave]
    },
    releaseAll: () => synth.releaseAll(),
    dispose: () => synth.dispose(),
  }
}

/** Two-operator FM: a Rhodes-like electric piano, or, with an out-of-step modulator, a bell. */
function fmVoice(out: Tone.ToneAudioNode, kind: 'epiano' | 'bell'): Voice {
  const synth = new Tone.PolySynth(Tone.FMSynth).connect(out)
  synth.set(
    kind === 'epiano'
      ? { harmonicity: 1, modulationIndex: 7, modulation: { type: 'sine' }, modulationEnvelope: { attack: 0.002, decay: 0.7, sustain: 0.15, release: 0.5 } }
      : { harmonicity: 3.5, modulationIndex: 12, modulation: { type: 'sine' }, modulationEnvelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 1.5 } },
  )
  return {
    play: (freqs, duration, time, velocity) => synth.triggerAttackRelease(freqs, duration, time, velocity),
    apply(sound) {
      synth.set({ oscillator: { type: 'sine' }, envelope: { attack: sound.attack, decay: sound.decay, sustain: sound.sustain, release: sound.release } })
      synth.volume.value = INSTRUMENT_VOLUME[kind]
    },
    releaseAll: () => synth.releaseAll(),
    dispose: () => synth.dispose(),
  }
}

/** The sampled piano, silent until its notes have loaded. */
function pianoVoice(out: Tone.ToneAudioNode): Voice {
  let sampler: Tone.Sampler | null = null
  let last: Sound | null = null
  let disposed = false
  const apply = (sound: Sound) => {
    last = sound
    if (!sampler) return
    sampler.attack = sound.attack
    sampler.release = sound.release
    sampler.volume.value = INSTRUMENT_VOLUME.piano
  }
  const make = (urls: Record<string, AudioBuffer>) => {
    if (disposed || sampler) return
    sampler = new Tone.Sampler({ urls }).connect(out)
    if (last) apply(last)
  }
  if (pianoNotes) make(pianoNotes)
  else void loadPiano().then(make, () => undefined)
  return {
    play: (freqs, duration, time, velocity) => sampler?.triggerAttackRelease(freqs, duration, time, velocity),
    apply,
    releaseAll: () => sampler?.releaseAll(),
    dispose() {
      disposed = true
      sampler?.dispose()
    },
  }
}

const VOICES: Record<Instrument, (out: Tone.ToneAudioNode) => Voice> = {
  synth: (out) => synthVoice(out, 'synth'),
  strings: (out) => synthVoice(out, 'strings'),
  epiano: (out) => fmVoice(out, 'epiano'),
  bell: (out) => fmVoice(out, 'bell'),
  piano: pianoVoice,
}

/** What plays the chords: whichever instrument the sound picks, swapped as it changes. */
export class Pad {
  private kind: Instrument | null = null
  private voice: Voice | null = null
  private readonly out: Tone.ToneAudioNode
  constructor(out: Tone.ToneAudioNode) {
    this.out = out
  }

  set(sound: Sound) {
    const kind = instrumentOf(sound)
    if (kind !== this.kind) {
      this.voice?.dispose()
      this.voice = VOICES[kind](this.out)
      this.kind = kind
    }
    this.voice!.apply(sound)
  }

  triggerAttackRelease(freqs: number[], duration: number, time: number, velocity: number) {
    this.voice?.play(freqs, duration, time, velocity)
  }

  releaseAll() {
    this.voice?.releaseAll()
  }

  dispose() {
    this.voice?.dispose()
    this.voice = null
  }
}

export interface Instruments {
  pad: Pad
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
  const pad = new Pad(filter)
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
  pad.set(sound)
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
