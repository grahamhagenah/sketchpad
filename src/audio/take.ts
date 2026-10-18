import { newId } from '../id'
import { canPack, pack, unpack } from './pack'

/** A recorded vocal: mono samples that start at a beat of the song. */
export interface Take {
  /** Names its audio in storage, which every track and saved sketch holding it shares. */
  id: string
  startBeat: number
  /** The tempo it was sung at; the take doesn't stretch if the tempo changes. */
  bpm: number
  sampleRate: number
  samples: Float32Array
}

/** What the interface needs to draw a take, without holding its audio. */
export interface TakeInfo {
  id: string
  startBeat: number
  bpm: number
  seconds: number
  /** Loudest sample in each slice, 0–1, for the waveform. */
  peaks: number[]
}

/**
 * How much of a take plays, in seconds into its audio: from `start` up to
 * `end`. The audio itself stays whole, so a trim can always be undone.
 */
export interface Trim {
  start: number
  end: number
  /** How far the take is moved from where it was recorded, in seconds (earlier when less than 0), to line it up by ear. */
  nudge?: number
  /** How many beats the take is dragged along from where it was recorded (earlier when less than 0): where it goes in the section, rather than lining it up. */
  moved?: number
}

/** Whether a trim cuts anything off the take, rather than only moving it. */
export const cuts = (take: Pick<TakeInfo, 'seconds'>, trim: Trim | undefined) => {
  const { start, end } = trimOf(take, trim)
  return start > 0.001 || end < take.seconds - 0.001
}

/** The shortest a take can be trimmed to, in seconds. */
export const MIN_TRIM = 0.2

/** A take's trim, kept inside its audio and at least MIN_TRIM long; none means the whole take. */
export function trimOf(take: Pick<TakeInfo, 'seconds'>, trim: Trim | undefined): Trim {
  const end = Math.min(take.seconds, Math.max(trim?.end ?? take.seconds, MIN_TRIM))
  const start = Math.max(0, Math.min(trim?.start ?? 0, end - MIN_TRIM))
  return { start, end }
}

const PEAKS_PER_SECOND = 60

export function takeInfo(take: Take): TakeInfo {
  const slice = Math.max(1, Math.round(take.sampleRate / PEAKS_PER_SECOND))
  const peaks: number[] = []
  for (let i = 0; i < take.samples.length; i += slice) {
    let max = 0
    const end = Math.min(take.samples.length, i + slice)
    for (let j = i; j < end; j++) max = Math.max(max, Math.abs(take.samples[j]))
    peaks.push(max)
  }
  // Scale so quiet takes still draw a readable shape.
  const loudest = Math.max(0.05, ...peaks)
  return {
    id: take.id,
    startBeat: take.startBeat,
    bpm: take.bpm,
    seconds: take.samples.length / take.sampleRate,
    peaks: peaks.map((p) => p / loudest),
  }
}

export function toAudioBuffer(take: Take) {
  const buffer = new AudioBuffer({ length: Math.max(1, take.samples.length), sampleRate: take.sampleRate, numberOfChannels: 1 })
  // Played (and exported) with the room's hiss, and the song leaking in from the speakers, turned down between the lines; the take as kept is untouched.
  buffer.copyToChannel(gateQuiet(take.samples, take.sampleRate) as Float32Array<ArrayBuffer>, 0)
  return buffer
}

/** A twentieth of a second at a time, each stretch's loudness, in dB. */
function stretchesDb(samples: Float32Array, size: number) {
  const out: number[] = []
  for (let i = 0; i + size <= samples.length; i += size) {
    let sum = 0
    for (let j = i; j < i + size; j++) sum += samples[j] * samples[j]
    out.push(10 * Math.log10(sum / size + 1e-12))
  }
  return out
}
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]

/** How far the gate turns down what isn't singing: well down, not out, so the take doesn't sound chopped. */
const GATE_DOWN_DB = 26

/**
 * A copy of a take with the quiet between the lines turned down: what's
 * barely above its quietest (the room's hiss, and the song leaking in from
 * the speakers, heard as a beat in the hiss) drops away, while the singing is
 * left as it was. It opens a moment before each line, so a word's start isn't
 * clipped, holds through short breaths, and fades in and out smoothly.
 */
export function gateQuiet(samples: Float32Array, sampleRate: number): Float32Array {
  const size = Math.max(1, Math.round(sampleRate * 0.01))
  const db = stretchesDb(samples, size)
  if (db.length < 10) return samples
  const sorted = [...db].sort((a, b) => a - b)
  const floor = percentile(sorted, 0.1)
  const loud = percentile(sorted, 0.95)
  // Singing stands well clear of the room; between the two, nearer the room, is where it closes. With nothing sung, all of it is room.
  const threshold = Math.max(floor + 10, loud - 36)
  const open = db.map((d) => d >= threshold)
  // Open a little early (the start of a word) and held a while after (a breath, a word's tail).
  const early = Math.round(0.03 / 0.01)
  const hold = Math.round(0.2 / 0.01)
  // For each stretch, the next one that's open (or none), to open ahead of it.
  const nextOpen = new Int32Array(db.length)
  for (let i = db.length - 1, next = -1; i >= 0; i--) {
    if (open[i]) next = i
    nextOpen[i] = next
  }
  const down = Math.pow(10, -GATE_DOWN_DB / 20)
  const want = new Float32Array(db.length)
  for (let i = 0, last = -Infinity; i < db.length; i++) {
    if (open[i]) last = i
    const soon = nextOpen[i] !== -1 && nextOpen[i] - i <= early
    want[i] = open[i] || soon || i - last <= hold ? 1 : down
  }
  // Smoothly, sample by sample: quick to open, slower to close.
  const attack = 1 - Math.exp(-1 / (0.005 * sampleRate))
  const release = 1 - Math.exp(-1 / (0.12 * sampleRate))
  const out = new Float32Array(samples.length)
  let gain = want[0]
  for (let i = 0; i < samples.length; i++) {
    const target = want[Math.min(want.length - 1, Math.floor(i / size))]
    gain += (target - gain) * (target > gain ? attack : release)
    out[i] = samples[i] * gain
  }
  return out
}

/**
 * Smooths over the moments a recording lost, in place, and says how many.
 * Now and then (more often over Bluetooth) the browser gives the recorder no
 * input for a block or two of audio, 128 samples each, which it fills with
 * silence to keep the take in time; a voice cutting out to nothing for a few
 * milliseconds is heard as a click or scratch. Each such run of silence, with
 * sound on either side, is filled with the audio either side of it mirrored
 * into it and crossfaded, so the voice carries on through. A longer silence,
 * or one between quiet sounds, is left: it's the singer pausing.
 */
export function concealDropouts(samples: Float32Array) {
  const MIN = 64
  const MAX = 1024
  const EDGE = 64
  const loud = (from: number, to: number) => {
    let peak = 0
    for (let i = Math.max(0, from); i < Math.min(samples.length, to); i++) peak = Math.max(peak, Math.abs(samples[i]))
    return peak > 0.002
  }
  let fixed = 0
  let i = 0
  while (i < samples.length) {
    if (samples[i] !== 0) {
      i++
      continue
    }
    let end = i
    while (end < samples.length && samples[end] === 0) end++
    const length = end - i
    if (length >= MIN && length <= MAX && i >= length && end + length <= samples.length && loud(i - EDGE, i) && loud(end, end + EDGE)) {
      for (let k = 0; k < length; k++) {
        const w = (k + 0.5) / length
        // Mirrored about each edge, so each side meets the audio it comes from without a jump.
        samples[i + k] = (1 - w) * samples[i - 1 - k] + w * samples[end + length - 1 - k]
      }
      fixed++
    }
    i = end
  }
  return fixed
}

/**
 * How far to raise a take so its singing sits at a steady level, in dB: from
 * how loud its loudest half is, a twentieth of a second at a time (so the
 * quiet between lines doesn't count), up to `target`. A take is never turned
 * down, nor up by more than 18 dB, which would only raise the room's hiss;
 * and one with no singing in it (its loudest hardly above its quietest) isn't
 * raised at all, so a silent take stays quiet rather than a loud hiss.
 */
export function levelUpDb(samples: Float32Array, sampleRate: number, target = -20) {
  if (!hasSinging(samples, sampleRate)) return 0
  const size = Math.max(1, Math.round(sampleRate * 0.05))
  const power: number[] = []
  for (let i = 0; i + size <= samples.length; i += size) {
    let sum = 0
    for (let j = i; j < i + size; j++) sum += samples[j] * samples[j]
    power.push(sum / size)
  }
  if (!power.length) return 0
  power.sort((a, b) => b - a)
  const loud = power.slice(0, Math.ceil(power.length / 2))
  const rms = Math.sqrt(loud.reduce((a, b) => a + b, 0) / loud.length)
  if (rms < 1e-5) return 0
  return Math.max(0, Math.min(18, target - 20 * Math.log10(rms)))
}

/** Whether a take has anything sung in it: its loud parts stand well above its quietest, as a voice does over a room. */
export function hasSinging(samples: Float32Array, sampleRate: number) {
  const db = stretchesDb(samples, Math.max(1, Math.round(sampleRate * 0.05)))
  if (db.length < 4) return false
  const sorted = [...db].sort((a, b) => a - b)
  return percentile(sorted, 0.95) - percentile(sorted, 0.1) >= 15
}

// ---- Keeping takes between visits (too big for localStorage) ----

export const LANES = 8
/** How many lanes there were when each had a key of its own. */
const LEGACY_LANES = 4

// Named before the app was called Bounce; kept, so saved takes still load.
const DB = 'sketchpad'
/**
 * The takes of the sketch being worked on, as take ids by lane for each
 * section, under LANES_KEY. (Before sections, each lane had a key of its own.)
 */
const STORE = 'takes'
const LANES_KEY = 'lanes'
/** Saved sketches, and (kept apart so listing them stays quick) their takes' ids, by section and lane. */
export const SKETCHES = 'sketches'
const SKETCH_TAKES = 'sketch-takes'
/**
 * Each take's audio, once, however many lanes and saved sketches hold it;
 * audio that nothing holds any more is deleted.
 */
const AUDIO = 'audio'
const key = (lane: number) => `vocal-${lane}`

/** A take as stored: 16-bit, half the size of the samples played. */
interface StoredTake {
  startBeat: number
  bpm: number
  sampleRate: number
  pcm: Int16Array
}

/**
 * Where each pass of a loop recorded over and over starts and ends, in
 * samples, `passSeconds` apiece: each whole pass, and the last one cut short
 * by stopping if at least `minSeconds` of it was sung (or if it's the first,
 * so stopping early still leaves a take).
 */
export function passesOf(length: number, sampleRate: number, passSeconds: number, minSeconds: number): [number, number][] {
  const passes: [number, number][] = []
  for (let k = 0; ; k++) {
    const start = Math.round(k * passSeconds * sampleRate)
    const end = Math.round((k + 1) * passSeconds * sampleRate)
    if (start >= length) break
    if (end <= length) passes.push([start, end])
    else {
      if (k === 0 || length - start >= minSeconds * sampleRate) passes.push([start, length])
      break
    }
  }
  return passes
}

/** Rounds samples to what 16-bit storage keeps, so a take sounds the same before and after a reload. */
export function quantize(samples: Float32Array) {
  return decodePcm(encodePcm(samples))
}

function encodePcm(samples: Float32Array) {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, samples[i])) * 0x7fff)
  return pcm
}

function decodePcm(pcm: Int16Array) {
  const samples = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 0x7fff
  return samples
}

const toStored = ({ startBeat, bpm, sampleRate, samples }: Take): StoredTake => ({ startBeat, bpm, sampleRate, pcm: encodePcm(samples) })
const fromStored = (id: string, { startBeat, bpm, sampleRate, pcm }: StoredTake): Take => {
  // Takes recorded before dropouts were smoothed over play smoothly too; what's stored stays as it was.
  const samples = decodePcm(pcm)
  concealDropouts(samples)
  return { id, startBeat, bpm, sampleRate, samples }
}

/** A take as version 2 kept it: whole, wherever it was used. */
type LegacyTake = Omit<Take, 'id'>
const isLegacyTake = (value: unknown): value is LegacyTake => !!value && typeof value === 'object' && 'samples' in value

/**
 * Moves version 2's takes, stored whole and in 32-bit in every lane and saved
 * sketch, into the audio store, leaving their ids where they were.
 */
function migrateTakes(tx: IDBTransaction) {
  const audio = tx.objectStore(AUDIO)
  const move = (take: unknown) => {
    if (!isLegacyTake(take)) return null
    const id = newId()
    audio.put(toStored({ ...take, id }), id)
    return id
  }
  tx.objectStore(STORE).openCursor().onsuccess = function () {
    const cursor = this.result
    if (!cursor) return
    if (isLegacyTake(cursor.value)) cursor.update(move(cursor.value))
    cursor.continue()
  }
  tx.objectStore(SKETCH_TAKES).openCursor().onsuccess = function () {
    const cursor = this.result
    if (!cursor) return
    if (Array.isArray(cursor.value)) cursor.update(cursor.value.map((take) => (typeof take === 'string' ? take : move(take))))
    cursor.continue()
  }
}

let opened: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 3)
    req.onupgradeneeded = (e) => {
      for (const name of [STORE, SKETCHES, SKETCH_TAKES, AUDIO]) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name)
      }
      if (e.oldVersion > 0 && e.oldVersion < 3) migrateTakes(req.transaction!)
    }
    req.onsuccess = () => {
      // Let a newer version of the app, open in another tab, upgrade the database.
      req.result.onversionchange = () => {
        req.result.close()
        opened = null
      }
      resolve(req.result)
    }
    req.onerror = () => {
      opened = null
      reject(req.error)
    }
  })
  return opened
}

/**
 * Runs one request against a store in the app's database. It settles once the
 * transaction does: a write that runs out of space can succeed as a request
 * and still be thrown away when its transaction aborts.
 */
export async function idb<T>(store: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    tx.oncomplete = () => resolve(req.result)
    tx.onabort = () => reject(tx.error ?? req.error)
  })
}

/** Runs several writes as one transaction, which stores all of them or none. */
async function write(stores: string[], fn: (tx: IDBTransaction) => void) {
  const d = await db()
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction(stores, 'readwrite')
    fn(tx)
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
}

/** Stores a take's audio, unless it's already there. */
function putAudio(tx: IDBTransaction, take: Take) {
  const audio = tx.objectStore(AUDIO)
  const req = audio.getKey(take.id)
  req.onsuccess = () => {
    if (req.result === undefined) audio.put(toStored(take), take.id)
  }
}

/** Every string in a stored value, however deeply it's nested in arrays and records: the take ids it holds. */
export function idsIn(value: unknown, into = new Set<unknown>()) {
  if (typeof value === 'string') into.add(value)
  else if (Array.isArray(value)) value.forEach((v) => idsIn(v, into))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => idsIn(v, into))
  return into
}

/** Deletes the audio of takes no lane or saved sketch holds any more. */
function deleteUnused() {
  return write([STORE, SKETCH_TAKES, AUDIO], (tx) => {
    const lanes = tx.objectStore(STORE).getAll()
    const sketches = tx.objectStore(SKETCH_TAKES).getAll()
    const audio = tx.objectStore(AUDIO)
    // Requests in a transaction run in order, so the others are done by now.
    const keys = audio.getAllKeys()
    keys.onsuccess = () => {
      const used = idsIn([lanes.result, sketches.result])
      for (const id of keys.result) if (!used.has(id)) audio.delete(id)
    }
  })
}

/**
 * A lane as stored: the id of the take it plays (or null), or, once it has
 * had several, that and every one of them in the order they were recorded.
 */
export type StoredLane = string | null | { take: string; all: string[] }
/** Each section's lanes, as stored. */
export type LaneIds = Record<string, StoredLane[]>
/** A lane's takes: the one it plays, and every one it has, in the order they were recorded. */
export interface LaneTakes {
  take: Take | null
  all: Take[]
}
/** Takes by lane, for each section. */
export type SectionTakes = Record<string, LaneTakes[]>

/** Loads the audio of every take in `lanes`, once each however often it's used. */
async function loadAudio(lanes: Record<string, unknown[]>): Promise<SectionTakes> {
  const ids = [...idsIn(lanes)] as string[]
  const stored = await Promise.all(ids.map((id) => idb<StoredTake | undefined>(AUDIO, 'readonly', (s) => s.get(id))))
  const takes = new Map(ids.map((id, i) => [id, stored[i] ? fromStored(id, stored[i]) : null]))
  return lanesFrom(lanes, (id) => takes.get(id) ?? null)
}

/** Each section's lanes as stored, with their takes found by id: what's kept on the device, or in a backup file. */
export function lanesFrom(lanes: Record<string, unknown[]>, take: (id: string) => Take | null): SectionTakes {
  const get = (id: unknown) => (typeof id === 'string' ? take(id) : null)
  const lane = (value: unknown): LaneTakes => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      const take = get(value)
      return { take, all: take ? [take] : [] }
    }
    const { take: id, all: ids } = value as { take?: unknown; all?: unknown }
    const all = (Array.isArray(ids) ? ids : []).map(get).filter((t): t is Take => !!t)
    // The take it plays, or if its audio's gone, the latest one left.
    const take = all.find((t) => t.id === id) ?? get(id) ?? all[all.length - 1] ?? null
    return { take, all: take && !all.includes(take) ? [...all, take] : all }
  }
  return Object.fromEntries(Object.entries(lanes).map(([section, values]) => [section, values.map(lane)]))
}

/** Writes `lanes` under `key` in `store`, storing any audio of theirs that isn't stored yet. */
async function writeLanes(store: string, key: string, lanes: LaneIds, audioOf: (id: string) => Take | undefined) {
  await write([store, AUDIO], (tx) => {
    for (const id of idsIn(lanes) as Set<string>) {
      const take = audioOf(id)
      if (take) putAudio(tx, take)
    }
    tx.objectStore(store).put(lanes, key)
  })
  await deleteUnused()
}

/** Keeps which takes are in each section of the sketch being worked on. */
export const storeLanes = (lanes: LaneIds, audioOf: (id: string) => Take | undefined) => writeLanes(STORE, LANES_KEY, lanes, audioOf)

/**
 * The takes of the sketch being worked on, by section. Takes kept before
 * sections, one lane to a key (and the oldest, a single take), go to `section`.
 */
export async function loadLanes(section: string): Promise<SectionTakes> {
  const lanes = await idb<LaneIds | undefined>(STORE, 'readonly', (s) => s.get(LANES_KEY))
  if (lanes) return loadAudio(lanes)
  const legacy = await Promise.all(Array.from({ length: LEGACY_LANES }, (_, lane) => idb<unknown>(STORE, 'readonly', (s) => s.get(key(lane)))))
  const oldest = await idb<unknown>(STORE, 'readonly', (s) => s.get('vocal'))
  if (typeof oldest === 'string' && typeof legacy[0] !== 'string') legacy[0] = oldest
  const ids = legacy.map((id) => (typeof id === 'string' ? id : null))
  if (ids.some(Boolean)) {
    await write([STORE], (tx) => {
      const store = tx.objectStore(STORE)
      store.put({ [section]: ids }, LANES_KEY)
      for (let lane = 0; lane < LEGACY_LANES; lane++) store.delete(key(lane))
      store.delete('vocal')
    })
  }
  return loadAudio({ [section]: ids })
}

/** Keeps a saved sketch's takes, sharing audio already stored. */
export const saveSketchTakes = (sketchId: string, lanes: LaneIds, audioOf: (id: string) => Take | undefined) =>
  writeLanes(SKETCH_TAKES, sketchId, lanes, audioOf)

/** A saved sketch's takes by section; a sketch saved before sections had one list of lanes, which goes to `section`. */
export async function loadSketchTakes(sketchId: string, section: string): Promise<SectionTakes> {
  const stored = await idb<LaneIds | unknown[] | undefined>(SKETCH_TAKES, 'readonly', (s) => s.get(sketchId))
  return loadAudio(Array.isArray(stored) ? { [section]: stored } : (stored ?? {}))
}

// ---- For the cloud copy (see sync.ts) ----

/** A saved sketch's lanes as stored: the ids of the takes its tracks use, by section. */
export async function sketchLanes(sketchId: string): Promise<LaneIds | unknown[] | null> {
  return (await idb<LaneIds | unknown[] | undefined>(SKETCH_TAKES, 'readonly', (s) => s.get(sketchId))) ?? null
}

/** Keeps a saved sketch's lanes as they came from elsewhere; their audio comes separately (keepAudioBytes). */
export async function putSketchLanes(sketchId: string, lanes: unknown) {
  await idb(SKETCH_TAKES, 'readwrite', (s) => s.put(lanes, sketchId))
}

/** Which of these takes' audio isn't on this device. */
export async function missingAudio(ids: Iterable<string>): Promise<string[]> {
  const list = [...ids]
  const found = await Promise.all(list.map((id) => idb<IDBValidKey | undefined>(AUDIO, 'readonly', (s) => s.getKey(id))))
  return list.filter((_, i) => found[i] === undefined)
}

/**
 * A take's audio as bytes, to keep elsewhere: a line of JSON (where it
 * starts, its tempo and sample rate), then its 16-bit samples, packed
 * smaller where the browser can (see pack.ts; the line says so). Null if it
 * isn't on this device.
 */
export async function audioBytes(id: string): Promise<Blob | null> {
  const stored = await idb<StoredTake | undefined>(AUDIO, 'readonly', (s) => s.get(id))
  if (!stored) return null
  const { startBeat, bpm, sampleRate, pcm } = stored
  if (!canPack()) return new Blob([JSON.stringify({ startBeat, bpm, sampleRate }) + '\n', pcm], { type: 'application/octet-stream' })
  const packed = await pack(pcm)
  return new Blob([JSON.stringify({ startBeat, bpm, sampleRate, packed: PACKED, samples: pcm.length }) + '\n', packed], { type: 'application/octet-stream' })
}

/** How audioBytes says its samples are packed. */
const PACKED = 'delta-planes-gzip'

/** Reads audioBytes back, packed or not (as the first uploads were): the take as stored, or null if they aren't a take's. */
export async function storedFromBytes(bytes: ArrayBuffer): Promise<StoredTake | null> {
  const all = new Uint8Array(bytes)
  const line = all.indexOf(10)
  if (line < 0) return null
  try {
    const head = JSON.parse(new TextDecoder().decode(all.subarray(0, line))) as Partial<StoredTake> & { packed?: string; samples?: number }
    if (typeof head.startBeat !== 'number' || typeof head.bpm !== 'number' || typeof head.sampleRate !== 'number') return null
    const take = { startBeat: head.startBeat, bpm: head.bpm, sampleRate: head.sampleRate }
    if (head.packed === undefined) return { ...take, pcm: new Int16Array(bytes.slice(line + 1, line + 1 + Math.floor((bytes.byteLength - line - 1) / 2) * 2)) }
    if (head.packed !== PACKED) return null
    const pcm = await unpack(all.subarray(line + 1))
    // Every sample back, or it's been cut short on the way.
    return pcm.length === head.samples ? { ...take, pcm } : null
  } catch {
    return null
  }
}

/** Keeps a take's audio that came from elsewhere (audioBytes), unless it's on the device already. */
export async function keepAudioBytes(id: string, bytes: ArrayBuffer) {
  const stored = await storedFromBytes(bytes)
  if (!stored) throw new Error('A recording came back damaged.')
  await write([AUDIO], (tx) => {
    const audio = tx.objectStore(AUDIO)
    const req = audio.getKey(id)
    req.onsuccess = () => {
      if (req.result === undefined) audio.put(stored, id)
    }
  })
}

export async function deleteSketchTakes(sketchId: string) {
  await idb(SKETCH_TAKES, 'readwrite', (s) => s.delete(sketchId))
  await deleteUnused()
}

/** What to tell someone when the browser wouldn't store their work. */
export function storageErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'Your browser is out of space for Bounce. Delete sketches you no longer need, then try again.'
  }
  return `Your browser wouldn’t store it${error instanceof Error && error.message ? ` (${error.message})` : ''}.`
}

let persistAsked = false

/**
 * Asks the browser to keep Bounce's storage rather than clear it when space
 * runs low or the site goes unvisited for a while (Safari clears it after a
 * week). Asked once there's something worth keeping, since some browsers ask
 * the person.
 */
export function keepStorage() {
  if (persistAsked) return
  persistAsked = true
  void navigator.storage?.persist?.().catch(() => {})
}
