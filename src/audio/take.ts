/** A recorded vocal: mono samples that start at a beat of the song. */
export interface Take {
  startBeat: number
  /** The tempo it was sung at; the take doesn't stretch if the tempo changes. */
  bpm: number
  sampleRate: number
  samples: Float32Array
}

/** What the interface needs to draw a take, without holding its audio. */
export interface TakeInfo {
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

// ---- Keeping the take between visits (too big for localStorage) ----

export const LANES = 4

const DB = 'sketchpad'
/** The takes of the sketch being worked on, by lane. */
const STORE = 'takes'
/** Saved sketches, and (kept apart so listing them stays quick) their takes. */
export const SKETCHES = 'sketches'
export const SKETCH_TAKES = 'sketch-takes'
const key = (lane: number) => `vocal-${lane}`

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2)
    req.onupgradeneeded = () => {
      for (const name of [STORE, SKETCHES, SKETCH_TAKES]) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Runs one request against a store in the app's database. */
export async function idb<T>(store: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(store, mode).objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const run = <T,>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) => idb(STORE, mode, fn)

export const saveTake = (lane: number, take: Take) => run('readwrite', (s) => s.put(take, key(lane)))
export const deleteSavedTake = (lane: number) => run('readwrite', (s) => s.delete(key(lane)))

/** Every lane's take, oldest single-take saves included as lane 1. */
export async function loadTakes(): Promise<(Take | null)[]> {
  const takes = await Promise.all(Array.from({ length: LANES }, (_, lane) => run<Take | undefined>('readonly', (s) => s.get(key(lane)))))
  const legacy = await run<Take | undefined>('readonly', (s) => s.get('vocal'))
  if (legacy && !takes[0]) {
    takes[0] = legacy
    await saveTake(0, legacy)
    await run('readwrite', (s) => s.delete('vocal'))
  }
  return takes.map((t) => t ?? null)
}
