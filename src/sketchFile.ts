import { unzip, zip } from './audio/zip'
import { idsIn, lanesFrom, type SectionTakes, type Take } from './audio/take'
import { songOf, useStore, type SavedSong } from './store'
import { takeIdsBySection } from './song'

/**
 * A backup of a sketch, as one file to keep anywhere: a zip of the song
 * (`sketch.json`) and each of its takes as a WAV file (`takes/<id>.wav`), so
 * the recordings open in anything that plays audio too.
 */
type State = ReturnType<typeof useStore.getState>

const FORMAT = 'bounce-sketch'
const VERSION = 1

interface SketchJson {
  format: typeof FORMAT
  version: number
  /** When it was backed up, for whoever opens the file to read. */
  saved: string
  song: SavedSong
  /** Each section's lanes, as kept on the device. */
  lanes: Record<string, unknown[]>
  /** Where each take starts, and the tempo it was sung at, which the WAV can't say. */
  takes: Record<string, { startBeat: number; bpm: number }>
}

/** The sketch and its takes' audio, as a backup file. */
export async function sketchFile(s: State, audioOf: (id: string) => Take | undefined): Promise<Blob> {
  const lanes = takeIdsBySection(s)
  const takes = ([...idsIn(lanes)] as string[]).map(audioOf).filter((t): t is Take => !!t)
  const json: SketchJson = {
    format: FORMAT,
    version: VERSION,
    saved: new Date().toISOString(),
    song: songOf(s),
    lanes,
    takes: Object.fromEntries(takes.map((t) => [t.id, { startBeat: t.startBeat, bpm: t.bpm }])),
  }
  return zip([
    { name: 'sketch.json', data: new Blob([JSON.stringify(json, null, 1)], { type: 'application/json' }) },
    ...takes.map((t) => ({ name: `takes/${t.id}.wav`, data: wav(t) })),
  ])
}

/** A backup file's song and takes; throws, with a message to show, if it isn't one. */
export async function readSketchFile(file: Blob): Promise<{ song: SavedSong; takes: SectionTakes }> {
  let files: Map<string, Uint8Array>
  try {
    files = unzip(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new Error('That file isn’t a Bounce backup.')
  }
  const raw = files.get('sketch.json')
  const json = raw && (JSON.parse(new TextDecoder().decode(raw)) as Partial<SketchJson>)
  if (!json || json.format !== FORMAT || !json.song) throw new Error('That file isn’t a Bounce backup.')
  if ((json.version ?? 0) > VERSION) throw new Error('That backup is from a newer Bounce. Reload the page to update, then try again.')
  const takes = new Map<string, Take>()
  for (const [id, place] of Object.entries(json.takes ?? {})) {
    const data = files.get(`takes/${id}.wav`)
    const audio = data && fromWav(data)
    if (audio) takes.set(id, { id, ...place, ...audio })
  }
  return { song: json.song, takes: lanesFrom(json.lanes ?? {}, (id) => takes.get(id) ?? null) }
}

/** A take as a 16-bit mono WAV: what it's kept as on the device, so nothing's lost. */
function wav(take: Take): Blob {
  const frames = take.samples.length
  const view = new DataView(new ArrayBuffer(44 + frames * 2))
  const str = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  view.setUint32(4, 36 + frames * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, take.sampleRate, true)
  view.setUint32(28, take.sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  str(36, 'data')
  view.setUint32(40, frames * 2, true)
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, take.samples[i])) * 0x7fff), true)
  return new Blob([view.buffer], { type: 'audio/wav' })
}

/** A 16-bit mono WAV's samples and rate, as wav() writes it; null if it's something else. */
function fromWav(bytes: Uint8Array): { sampleRate: number; samples: Float32Array } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let sampleRate = 0
  let bits = 0
  let channels = 0
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4, true)
    if (tag(at) === 'fmt ') {
      channels = view.getUint16(at + 10, true)
      sampleRate = view.getUint32(at + 12, true)
      bits = view.getUint16(at + 22, true)
    } else if (tag(at) === 'data') {
      if (bits !== 16 || channels !== 1 || !sampleRate) return null
      const frames = Math.floor(Math.min(size, bytes.length - at - 8) / 2)
      const samples = new Float32Array(frames)
      for (let i = 0; i < frames; i++) samples[i] = view.getInt16(at + 8 + i * 2, true) / 0x7fff
      return { sampleRate, samples }
    }
    at += 8 + size + (size % 2)
  }
  return null
}
