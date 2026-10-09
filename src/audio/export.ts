import * as Tone from 'tone'
import { keyLabel, keySignature } from '../music/theory'
import { arrange } from './arrange'
import { createInstruments, midiToHz } from './instruments'
import { createKit, DRUM_NOTES, KIT_VOLUME, playDrum } from './drums'
import { zip } from './zip'
import { toAudioBuffer, type Take } from './take'
import type { Playback } from '../song'

type ExportSong = Pick<Playback, 'key' | 'mode' | 'bpm' | 'timeSig' | 'chords' | 'sound' | 'arp'> & Partial<Pick<Playback, 'drums' | 'rhythm' | 'kicks' | 'chordsDb' | 'drumsDb'>>

const PPQ = 480

/** e.g. "night-drive-F#m-96bpm", or "bounce-F#m-96bpm" before the sketch has a title. */
export function exportName(song: Pick<ExportSong, 'key' | 'mode' | 'bpm'> & { title?: string }) {
  const key = keyLabel(song.key, song.mode).replace('♯', '#').replace('♭', 'b')
  const name = (song.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bounce'
  return `${name}-${key}${song.mode === 'minor' ? 'm' : ''}-${song.bpm}bpm`
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
 * bass (and drums) on separate tracks so each can get its own instrument in a DAW.
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
    track('Bounce', conductor),
    track(song.arp.on ? 'Arpeggio' : 'Chords', notes(0, hits.filter((h) => h.pad.length).map((h) => ({ ...h, pitches: h.pad })))),
  ]
  if (song.sound.bass) {
    const bass = hits.flatMap((h) => (h.bass === null ? [] : [{ ...h, pitches: [h.bass], velocity: 0.9 }]))
    tracks.push(track('Bass', notes(1, bass)))
  }
  if (song.drums?.length) {
    // On channel 10, General MIDI's drum channel, so a DAW opens it on a kit.
    const quartersPerBeat = 4 / den
    const drums = song.drums.map((h) => ({ start: h.beat * quartersPerBeat, dur: 0.125, pitches: [DRUM_NOTES[h.piece]], velocity: h.velocity }))
    tracks.push(track('Drums', notes(9, drums)))
  }
  const bytes = [...chunk('MThd', [0, 1, 0, tracks.length, PPQ >> 8, PPQ & 255]), ...tracks.flat()]
  return new Blob([new Uint8Array(bytes)], { type: 'audio/midi' })
}

// ---- WAV ----

/** A take placed where it plays, and which vocal track it's on. */
export type PlacedTake = Take & { track: number; db?: number }

/** The takes that play, each moved to where it plays and cut off at the end of its section. */
export function placedTakes(song: Pick<Playback, 'bpm' | 'timeSig' | 'vocals'>, audioOf: (id: string) => Take | undefined): PlacedTake[] {
  const beatSeconds = (60 / song.bpm) * (4 / song.timeSig[1])
  return song.vocals.flatMap((vocal) => {
    const take = audioOf(vocal.id)
    if (!take) return []
    const room = Math.round((vocal.endBeat - vocal.startBeat) * beatSeconds * take.sampleRate)
    const samples = Number.isFinite(room) && room < take.samples.length ? take.samples.subarray(0, Math.max(0, room)) : take.samples
    return [{ ...take, startBeat: vocal.startBeat, samples, track: vocal.track, db: vocal.db }]
  })
}

const TAIL_SECONDS = 2.5

/** Which parts of the song a render plays. */
interface Parts {
  pad: boolean
  bass: boolean
  drums: boolean
  takes: PlacedTake[]
}

/** How long a render of the whole song runs, with time for the last notes to ring out. */
function songSeconds(song: ExportSong, takes: Take[]) {
  const quarterSeconds = 60 / song.bpm
  const beatSeconds = quarterSeconds * (4 / song.timeSig[1])
  const end = Math.max(
    Math.max(0, ...arrange(song).map((h) => h.start + h.dur)) * quarterSeconds,
    ...(song.drums ?? []).map((h) => h.beat * beatSeconds),
    ...takes.map((take) => take.startBeat * beatSeconds + take.samples.length / take.sampleRate),
  )
  return end + TAIL_SECONDS
}

/** Renders the song, or some of its parts, on the same sounds as playback. */
async function render(song: ExportSong, parts: Parts, duration: number) {
  const quarterSeconds = 60 / song.bpm
  const beatSeconds = quarterSeconds * (4 / song.timeSig[1])
  const hits = arrange(song)
  const rendered = await Tone.Offline(async () => {
    const { pad, bass, reverb, bus } = createInstruments(song.sound)
    bus.volume.value = song.chordsDb ?? 0
    await reverb.ready
    for (const h of hits) {
      const time = h.start * quarterSeconds
      const length = h.dur * quarterSeconds
      if (parts.pad && h.pad.length) pad.triggerAttackRelease(h.pad.map(midiToHz), h.held ? length * 0.97 : length, time, h.velocity)
      if (parts.bass && h.bass !== null) bass.triggerAttackRelease(midiToHz(h.bass), length * 0.97, time, 0.9)
    }
    if (parts.drums) {
      const kit = createKit()
      kit.out.volume.value = KIT_VOLUME + (song.drumsDb ?? 0)
      for (const h of song.drums ?? []) playDrum(kit, h.piece, h.beat * beatSeconds, h.velocity)
    }
    for (const take of parts.takes) {
      const player = new Tone.Player(toAudioBuffer(take)).toDestination()
      player.volume.value = take.db ?? 0
      player.start(take.startBeat * beatSeconds)
    }
  }, duration, 2, 44100)
  return rendered.get()!
}

/**
 * Renders the whole song once, on the same sounds as playback, to a 24-bit
 * WAV, with any vocal takes given mixed in.
 */
export async function songToWav(song: ExportSong, takes: PlacedTake[] = []): Promise<Blob> {
  return encodeWav(await render(song, { pad: true, bass: song.sound.bass, drums: true, takes }, songSeconds(song, takes)))
}

/**
 * Each track on its own, as a 24-bit WAV, all from the song's first beat and
 * all the same length, so they line up when dropped at bar 1 in a DAW.
 * Vocals are one file per vocal track, its takes from every section on it.
 */
export async function songToStems(song: ExportSong, takes: PlacedTake[], names: { chords: string; drums: string; vocal: (track: number) => string }) {
  const duration = songSeconds(song, takes)
  const none = { pad: false, bass: false, drums: false, takes: [] }
  const stems: { name: string; parts: Parts }[] = [{ name: names.chords, parts: { ...none, pad: true } }]
  if (song.sound.bass) stems.push({ name: 'Bass', parts: { ...none, bass: true } })
  if (song.drums?.length) stems.push({ name: names.drums, parts: { ...none, drums: true } })
  const tracks = [...new Set(takes.map((t) => t.track))].sort((a, b) => a - b)
  for (const track of tracks) stems.push({ name: names.vocal(track), parts: { ...none, takes: takes.filter((t) => t.track === track) } })

  const files = []
  for (const [i, stem] of stems.entries()) {
    const wav = encodeWav(await render(song, stem.parts, duration))
    files.push({ name: `${String(i + 1).padStart(2, '0')} ${stem.name.replace(/[\\/:*?"<>|]/g, '-')}.wav`, data: wav })
  }
  return zip(files)
}

/**
 * The vocal on its own, padded with silence from the song's first beat, so it
 * lines up when dropped at bar 1 in a DAW.
 */
export function takeToWav(song: Pick<ExportSong, 'bpm' | 'timeSig'>, take: Take): Blob {
  const lead = Math.round(take.startBeat * (4 / song.timeSig[1]) * (60 / song.bpm) * take.sampleRate)
  const samples = new Float32Array(lead + take.samples.length)
  samples.set(take.samples, lead)
  return encodeWav(toAudioBuffer({ ...take, samples }))
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
