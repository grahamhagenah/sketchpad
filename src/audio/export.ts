import * as Tone from 'tone'
import { keyLabel, keySignature } from '../music/theory'
import { arrange } from './arrange'
import { createInstruments, midiToHz } from './instruments'
import type { Song } from './engine'

type ExportSong = Pick<Song, 'key' | 'mode' | 'bpm' | 'timeSig' | 'chords' | 'sound' | 'arp'>

const PPQ = 480

/** e.g. "sketchpad-F#m-96bpm" */
export function exportName(song: ExportSong) {
  const key = keyLabel(song.key, song.mode).replace('♯', '#').replace('♭', 'b')
  return `sketchpad-${key}${song.mode === 'minor' ? 'm' : ''}-${song.bpm}bpm`
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---- MIDI ----

const vlq = (n: number) => {
  const bytes = [n & 0x7f]
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80)
  return bytes
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 0x7f)

interface MidiEvent {
  tick: number
  /** Note-offs sort before note-ons on the same tick. */
  order: number
  data: number[]
}

function chunk(type: string, body: number[]) {
  return [...ascii(type), ...u32(body.length), ...body]
}

function track(name: string, events: MidiEvent[]) {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order)
  const body = [0, 0xff, 0x03, ...vlq(name.length), ...ascii(name)]
  let last = 0
  for (const e of sorted) {
    body.push(...vlq(e.tick - last), ...e.data)
    last = e.tick
  }
  body.push(0, 0xff, 0x2f, 0)
  return chunk('MTrk', body)
}

function notes(channel: number, hits: { start: number; dur: number; pitches: number[]; velocity: number }[]) {
  const events: MidiEvent[] = []
  for (const h of hits) {
    const start = Math.round(h.start * PPQ)
    const end = Math.round((h.start + h.dur) * PPQ)
    for (const p of h.pitches) {
      events.push({ tick: start, order: 1, data: [0x90 | channel, p, Math.round(h.velocity * 110)] })
      events.push({ tick: end, order: 0, data: [0x80 | channel, p, 0] })
    }
  }
  return events
}

/**
 * A type-1 MIDI file with the song's tempo, meter and key, and the chords and
 * bass on separate tracks so each can get its own instrument in a DAW.
 */
export function songToMidi(song: ExportSong): Blob {
  const [num, den] = song.timeSig
  const hits = arrange(song)

  const usPerQuarter = Math.round(60_000_000 / song.bpm)
  const sf = keySignature(song.key, song.mode)
  const conductor: MidiEvent[] = [
    { tick: 0, order: 0, data: [0xff, 0x51, 3, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255] },
    { tick: 0, order: 0, data: [0xff, 0x58, 4, num, Math.log2(den), 24, 8] },
    { tick: 0, order: 0, data: [0xff, 0x59, 2, sf & 255, song.mode === 'minor' ? 1 : 0] },
  ]

  const tracks = [
    track('Sketchpad', conductor),
    track(song.arp.on ? 'Arpeggio' : 'Chords', notes(0, hits.filter((h) => h.pad.length).map((h) => ({ ...h, pitches: h.pad })))),
  ]
  if (song.sound.bass) {
    const bass = hits.flatMap((h) => (h.bass === null ? [] : [{ ...h, pitches: [h.bass], velocity: 0.9 }]))
    tracks.push(track('Bass', notes(1, bass)))
  }
  const bytes = [...chunk('MThd', [0, 1, 0, tracks.length, PPQ >> 8, PPQ & 255]), ...tracks.flat()]
  return new Blob([new Uint8Array(bytes)], { type: 'audio/midi' })
}

// ---- WAV ----

const TAIL_SECONDS = 2.5

/** Renders the whole progression once, on the same sounds as playback, to a 24-bit WAV. */
export async function songToWav(song: ExportSong): Promise<Blob> {
  const quarterSeconds = 60 / song.bpm
  const hits = arrange(song)
  const end = Math.max(0, ...hits.map((h) => h.start + h.dur))
  const duration = end * quarterSeconds + TAIL_SECONDS

  const rendered = await Tone.Offline(async () => {
    const { pad, bass, reverb } = createInstruments(song.sound)
    await reverb.ready
    for (const h of hits) {
      const time = h.start * quarterSeconds
      const length = h.dur * quarterSeconds
      if (h.pad.length) pad.triggerAttackRelease(h.pad.map(midiToHz), h.held ? length * 0.97 : length, time, h.velocity)
      if (h.bass !== null) bass.triggerAttackRelease(midiToHz(h.bass), length * 0.97, time, 0.9)
    }
  }, duration, 2, 44100)

  return encodeWav(rendered.get()!)
}

function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels
  const rate = buffer.sampleRate
  const frames = buffer.length
  const bytesPerSample = 3
  const dataSize = frames * channels * bytesPerSample
  const view = new DataView(new ArrayBuffer(44 + dataSize))
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  str(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * channels * bytesPerSample, true)
  view.setUint16(32, channels * bytesPerSample, true)
  view.setUint16(34, 24, true)
  str(36, 'data')
  view.setUint32(40, dataSize, true)

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c))
  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.round(Math.max(-1, Math.min(1, data[c][i])) * 0x7fffff)
      view.setUint8(offset, v & 255)
      view.setUint8(offset + 1, (v >> 8) & 255)
      view.setUint8(offset + 2, (v >> 16) & 255)
      offset += 3
    }
  }
  return new Blob([view], { type: 'audio/wav' })
}
