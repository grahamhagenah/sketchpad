import { newId } from '../id'

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
  buffer.copyToChannel(take.samples as Float32Array<ArrayBuffer>, 0)
  return buffer
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
export const SKETCH_TAKES = 'sketch-takes'
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
const fromStored = (id: string, { startBeat, bpm, sampleRate, pcm }: StoredTake): Take => ({ id, startBeat, bpm, sampleRate, samples: decodePcm(pcm) })

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
function idsIn(value: unknown, into = new Set<unknown>()) {
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
  const get = (id: unknown) => (typeof id === 'string' ? (takes.get(id) ?? null) : null)
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
