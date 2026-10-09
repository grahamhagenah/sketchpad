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

export const LANES = 4

const DB = 'sketchpad'
/** Which take is in each lane of the sketch being worked on, by take id. */
const STORE = 'takes'
/** Saved sketches, and (kept apart so listing them stays quick) their takes' ids, by lane. */
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
    const id = crypto.randomUUID()
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

/** Deletes the audio of takes no lane or saved sketch holds any more. */
function deleteUnused() {
  return write([STORE, SKETCH_TAKES, AUDIO], (tx) => {
    const lanes = tx.objectStore(STORE).getAll()
    const sketches = tx.objectStore(SKETCH_TAKES).getAll()
    const audio = tx.objectStore(AUDIO)
    // Requests in a transaction run in order, so the others are done by now.
    const keys = audio.getAllKeys()
    keys.onsuccess = () => {
      const used = new Set<unknown>([...lanes.result, ...sketches.result.flat()])
      for (const id of keys.result) if (!used.has(id)) audio.delete(id)
    }
  })
}

async function loadAudio(ids: unknown[]): Promise<(Take | null)[]> {
  return Promise.all(
    ids.map(async (id) => {
      if (typeof id !== 'string') return null
      const stored = await idb<StoredTake | undefined>(AUDIO, 'readonly', (s) => s.get(id))
      return stored ? fromStored(id, stored) : null
    }),
  )
}

export async function saveTake(lane: number, take: Take) {
  await write([STORE, AUDIO], (tx) => {
    putAudio(tx, take)
    tx.objectStore(STORE).put(take.id, key(lane))
  })
  await deleteUnused()
}

export async function deleteSavedTake(lane: number) {
  await idb(STORE, 'readwrite', (s) => s.delete(key(lane)))
  await deleteUnused()
}

/** Every lane's take, oldest single-take saves included as lane 1. */
export async function loadTakes(): Promise<(Take | null)[]> {
  const ids = await Promise.all(Array.from({ length: LANES }, (_, lane) => idb<unknown>(STORE, 'readonly', (s) => s.get(key(lane)))))
  const legacy = await idb<unknown>(STORE, 'readonly', (s) => s.get('vocal'))
  if (typeof legacy === 'string') {
    if (typeof ids[0] !== 'string') {
      ids[0] = legacy
      await idb(STORE, 'readwrite', (s) => s.put(legacy, key(0)))
    }
    await idb(STORE, 'readwrite', (s) => s.delete('vocal'))
    await deleteUnused()
  }
  return loadAudio(ids)
}

/** Keeps a saved sketch's takes, sharing audio already stored. */
export async function saveSketchTakes(sketchId: string, takes: readonly (Take | null)[]) {
  await write([SKETCH_TAKES, AUDIO], (tx) => {
    for (const take of takes) if (take) putAudio(tx, take)
    tx.objectStore(SKETCH_TAKES).put(takes.map((take) => take?.id ?? null), sketchId)
  })
  await deleteUnused()
}

export async function loadSketchTakes(sketchId: string) {
  return loadAudio((await idb<unknown[] | undefined>(SKETCH_TAKES, 'readonly', (s) => s.get(sketchId))) ?? [])
}

export async function deleteSketchTakes(sketchId: string) {
  await idb(SKETCH_TAKES, 'readwrite', (s) => s.delete(sketchId))
  await deleteUnused()
}

/** What to tell someone when the browser wouldn't store their work. */
export function storageErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'Your browser is out of space for Sketchpad. Delete sketches you no longer need, then try again.'
  }
  return `Your browser wouldn’t store it${error instanceof Error && error.message ? ` (${error.message})` : ''}.`
}

let persistAsked = false

/**
 * Asks the browser to keep Sketchpad's storage rather than clear it when space
 * runs low or the site goes unvisited for a while (Safari clears it after a
 * week). Asked once there's something worth keeping, since some browsers ask
 * the person.
 */
export function keepStorage() {
  if (persistAsked) return
  persistAsked = true
  void navigator.storage?.persist?.().catch(() => {})
}
