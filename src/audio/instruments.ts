import * as Tone from 'tone'
import { bassVoiceOf, extrasOf, INSTRUMENT_VOLUME, instrumentOf, WAVE_VOLUME, type BassKind, type Instrument, type Sound } from './sound'
import { monoStart } from './timing'

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
    PIANO_NOTES.map(async (n) => [n.replace('s', '#'), (await Tone.ToneAudioBuffer.fromUrl(`${import.meta.env.BASE_URL}samples/piano/${n}.mp3`)).get()!] as const),
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
  /** Starts notes that sound until `release`, as for a key held down. */
  attack(freqs: number[], time: number, velocity: number): void
  release(freqs: number[], time: number): void
  apply(sound: Sound): void
  releaseAll(): void
  dispose(): void
}

function synthVoice(out: Tone.ToneAudioNode, kind: 'synth' | 'strings'): Voice {
  const synth = new Tone.PolySynth(Tone.Synth).connect(out)
  return {
    play: (freqs, duration, time, velocity) => synth.triggerAttackRelease(freqs, duration, time, velocity),
    attack: (freqs, time, velocity) => synth.triggerAttack(freqs, time, velocity),
    release: (freqs, time) => synth.triggerRelease(freqs, time),
    apply(sound) {
      // How far apart the stacked oscillators are tuned, in cents: as wide as the width says.
      const { width } = extrasOf(sound)
      synth.set({
        // Strings are a section of out-of-tune saws; the synth's sine stays pure, its other waves stacked a little apart.
        oscillator:
          kind === 'strings'
            ? // Four saws, not six: two fewer per note to work out in real time, a third less, for much the same sound.
              { type: 'fatsawtooth', count: 4, spread: width * 68 }
            : sound.wave === 'sine'
              ? { type: 'sine' }
              : { type: `fat${sound.wave}`, count: 3, spread: width * 50 },
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
    attack: (freqs, time, velocity) => synth.triggerAttack(freqs, time, velocity),
    release: (freqs, time) => synth.triggerRelease(freqs, time),
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
    attack: (freqs, time, velocity) => sampler?.triggerAttack(freqs, time, velocity),
    release: (freqs, time) => sampler?.triggerRelease(freqs, time),
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

  triggerAttack(freqs: number[], time: number, velocity: number) {
    this.voice?.attack(freqs, time, velocity)
  }

  triggerRelease(freqs: number[], time: number) {
    this.voice?.release(freqs, time)
  }

  releaseAll() {
    this.voice?.releaseAll()
  }

  dispose() {
    this.voice?.dispose()
    this.voice = null
  }
}

/**
 * Each bass sound, as a one-note synth: its wave, how its filter opens on
 * each note (from `filter` Hz, up `octaves`), how it fades, and how loud it is
 * beside the others, the sine ones being quieter.
 */
const BASS_SOUNDS: Record<BassKind, { wave: 'sine' | 'triangle' | 'square' | 'sawtooth'; filter: number; octaves: number; q: number; filterEnvelope: { attack: number; decay: number; sustain: number }; envelope: { attack: number; decay: number; sustain: number; release: number }; gain: number }> = {
  round: { wave: 'triangle', filter: 160, octaves: 2, q: 1, filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.35 }, envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.4 }, gain: 0 },
  sub: { wave: 'sine', filter: 2000, octaves: 0, q: 1, filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 1 }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.3 }, gain: -2 },
  finger: { wave: 'square', filter: 110, octaves: 3.2, q: 1.5, filterEnvelope: { attack: 0.002, decay: 0.18, sustain: 0.15 }, envelope: { attack: 0.003, decay: 0.5, sustain: 0.45, release: 0.15 }, gain: 0 },
  acid: { wave: 'sawtooth', filter: 90, octaves: 4.5, q: 9, filterEnvelope: { attack: 0.002, decay: 0.22, sustain: 0.1 }, envelope: { attack: 0.003, decay: 0.3, sustain: 0.6, release: 0.1 }, gain: -1 },
  '808': { wave: 'sine', filter: 2000, octaves: 0, q: 1, filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 1 }, envelope: { attack: 0.002, decay: 1.2, sustain: 0.5, release: 0.5 }, gain: 0 },
}

/**
 * The bass: one note at a time, on whichever bass sound is picked, an octave
 * up or down as set, sliding into each note by its glide, and the 808
 * dropping into each from above. Notes are MIDI numbers.
 */
export class Bass {
  readonly synth = new Tone.MonoSynth()
  private octave = 0
  private drop = false
  constructor(out: Tone.ToneAudioNode) {
    this.synth.connect(out)
  }

  apply(sound: Sound) {
    const voice = bassVoiceOf(sound)
    const kind = BASS_SOUNDS[voice.kind]
    this.octave = voice.octave
    this.drop = voice.kind === '808'
    this.synth.set({
      oscillator: { type: kind.wave },
      filter: { Q: kind.q },
      // Tone moves where the filter opens from, from a quarter to four times its usual place.
      filterEnvelope: { ...kind.filterEnvelope, baseFrequency: kind.filter * 2 ** ((voice.tone - 0.5) * 4), octaves: kind.octaves },
      envelope: kind.envelope,
      portamento: voice.glide * 0.15,
    } as Partial<Tone.MonoSynthOptions>)
    this.synth.volume.value = sound.bass ? BASS_VOLUME + kind.gain + voice.level : -Infinity
  }

  private hz = (note: number) => midiToHz(note + 12 * this.octave)

  /** An 808 note starts a little over an octave up and drops to its pitch in a moment. */
  private bend(hz: number, at: number) {
    if (!this.drop) return
    this.synth.frequency.setValueAtTime(hz * 2.2, at)
    this.synth.frequency.exponentialRampToValueAtTime(hz, at + 0.07)
  }

  play(note: number, duration: number, time: number, velocity: number) {
    const at = monoStart(this.synth, time)
    const hz = this.hz(note)
    this.synth.triggerAttackRelease(hz, duration, at, velocity)
    this.bend(hz, at)
  }

  attack(note: number, time: number, velocity: number) {
    const at = monoStart(this.synth, time)
    const hz = this.hz(note)
    this.synth.triggerAttack(hz, at, velocity)
    this.bend(hz, at)
  }

  release(time?: number) {
    this.synth.triggerRelease(time)
  }

  dispose() {
    this.synth.dispose()
  }
}

export interface Instruments {
  pad: Pad
  bass: Bass
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
  const bass = new Bass(bus)
  const instruments = { pad, bass, filter, reverb, bus }
  applySound(instruments, sound)
  return instruments
}

/** Retunes existing instruments to a sound, so changes are heard straight away. */
export function applySound({ pad, bass, filter, reverb }: Instruments, sound: Sound) {
  pad.set(sound)
  filter.frequency.value = sound.brightness
  // From the gentle bump a filter always has to a sharp, singing peak.
  filter.Q.value = 0.7 + extrasOf(sound).resonance * 11
  reverb.wet.value = sound.reverb
  bass.apply(sound)
}

/** The room the vocals share, in whichever Tone context is current; each track sends to it as much as its reverb says. */
export const createVocalRoom = () => new Tone.Reverb({ decay: 2.2, preDelay: 0.02, wet: 1 }).toDestination()

/**
 * Plays a take out through a vocal chain, as a demo's vocal would have one,
 * and sends it to the room (if there is one) by `amount` (0 to 1). The chain,
 * in order: raised by `levelDb` (see levelUpDb), so takes sit at a steady
 * level however close the singer was; the rumble and boom under a voice cut
 * (a close mic makes a voice bassier than it is); less of the boxy low mids,
 * a little more presence and air; gentle
 * compression, so soft and loud lines even out; and a limiter, so it never
 * clips. Returns the send, to change later, and a way to take it all apart.
 */
export function routeVocal(player: Tone.Player, room: Tone.Reverb | null, amount: number, levelDb = 0) {
  const nodes = [
    new Tone.Gain(levelDb, 'decibels'),
    new Tone.Filter({ type: 'highpass', frequency: 130, rolloff: -24 }),
    new Tone.Filter({ type: 'peaking', frequency: 250, Q: 1, gain: -4 }),
    new Tone.Filter({ type: 'peaking', frequency: 3500, Q: 0.9, gain: 3 }),
    new Tone.Filter({ type: 'highshelf', frequency: 10000, gain: 2.5 }),
    new Tone.Compressor({ threshold: -24, ratio: 3, attack: 0.005, release: 0.15, knee: 6 }),
    new Tone.Gain(4, 'decibels'),
    new Tone.Limiter(-1),
  ]
  player.chain(...nodes)
  const out = nodes[nodes.length - 1]
  out.toDestination()
  const send = new Tone.Gain(amount)
  if (room) out.connect(send.connect(room))
  return {
    send,
    dispose: () => {
      nodes.forEach((node) => node.dispose())
      send.dispose()
    },
  }
}
