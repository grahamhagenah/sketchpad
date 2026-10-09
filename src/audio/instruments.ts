import * as Tone from 'tone'

export const midiToHz = (m: number) => Tone.Frequency(m, 'midi').toFrequency()

/**
 * The pad and bass the song plays on, built in whichever Tone context is
 * current, so live playback and the WAV render sound the same.
 */
export function createInstruments() {
  const reverb = new Tone.Reverb({ decay: 2.4, wet: 0.18 }).toDestination()
  const filter = new Tone.Filter(2200, 'lowpass').connect(reverb)
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
    envelope: { attack: 0.015, decay: 0.4, sustain: 0.55, release: 0.9 },
  }).connect(filter)
  pad.volume.value = -17
  const bass = new Tone.MonoSynth({
    oscillator: { type: 'triangle' },
    filterEnvelope: { baseFrequency: 180, octaves: 2.5, attack: 0.01, decay: 0.3, sustain: 0.4 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.4 },
  }).toDestination()
  bass.volume.value = -9
  return { pad, bass, reverb }
}
