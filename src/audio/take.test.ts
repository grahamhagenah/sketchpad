import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Take } from './take'

type Storage = typeof import('./take')
let storage: Storage

// Each test gets an empty database and a fresh copy of the module, which keeps its connection open.
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.resetModules()
  storage = await import('./take')
})

const take = (id: string, length = 1000): Take => ({
  id,
  startBeat: 4,
  bpm: 96,
  sampleRate: 48000,
  samples: storage.quantize(Float32Array.from({ length }, (_, i) => Math.sin(i / 10) * 0.8)),
})

/** A loaded lane with just `t`, or nothing. */
const lane = (t: Take | null) => ({ take: t, all: t ? [t] : [] })

/** What's in a store, read straight from the database. */
function contents(store: string) {
  return new Promise<{ keys: IDBValidKey[]; values: unknown[] }>((resolve) => {
    const req = indexedDB.open('sketchpad')
    req.onsuccess = () => {
      const tx = req.result.transaction(store)
      const keys = tx.objectStore(store).getAllKeys()
      const values = tx.objectStore(store).getAll()
      tx.oncomplete = () => {
        req.result.close()
        resolve({ keys: keys.result, values: values.result })
      }
    }
  })
}

describe('quantize', () => {
  it('rounds to 16 bits, and is stable once rounded', () => {
    const once = storage.quantize(Float32Array.of(0.1234567, -1.5, 1, 0))
    expect([...once.slice(1)]).toEqual([-1, 1, 0])
    expect(Math.abs(once[0] - 0.1234567)).toBeLessThan(1 / 0x7fff)
    expect(storage.quantize(once)).toEqual(once)
  })
})

const audioOf = (...takes: Take[]) => (id: string) => takes.find((t) => t.id === id)

describe('take storage', () => {
  it('gives back each section’s takes as they were stored', async () => {
    const a = take('a')
    const b = take('b', 500)
    await storage.storeLanes({ verse: [null, 'a'], chorus: ['b'] }, audioOf(a, b))
    const loaded = await storage.loadLanes('verse')
    expect(loaded.verse).toEqual([lane(null), lane(a)])
    expect(loaded.chorus).toEqual([lane(b)])
  })

  it('keeps every take a lane has had, and which one it plays', async () => {
    const [a, b, c] = [take('a'), take('b'), take('c')]
    await storage.storeLanes({ verse: [{ take: 'b', all: ['a', 'b', 'c'] }] }, audioOf(a, b, c))
    expect((await storage.loadLanes('verse')).verse).toEqual([{ take: b, all: [a, b, c] }])
    expect((await contents('audio')).keys).toEqual(['a', 'b', 'c'])
    // Dropping a take from the lane lets its audio go.
    await storage.storeLanes({ verse: [{ take: 'b', all: ['a', 'b'] }] }, audioOf(a, b))
    expect((await contents('audio')).keys).toEqual(['a', 'b'])
  })

  it('stores audio as 16-bit', async () => {
    await storage.storeLanes({ verse: ['a'] }, audioOf(take('a')))
    const { values } = await contents('audio')
    expect((values[0] as { pcm: unknown }).pcm).toBeInstanceOf(Int16Array)
  })

  it('stores a take once, however many sections and sketches hold it', async () => {
    const t = take('a')
    await storage.storeLanes({ verse: ['a'], chorus: [null, 'a'] }, audioOf(t))
    await storage.saveSketchTakes('one', { verse: ['a'] }, audioOf(t))
    await storage.saveSketchTakes('two', { bridge: [null, 'a'] }, audioOf(t))
    expect((await contents('audio')).keys).toEqual(['a'])
    expect((await storage.loadSketchTakes('two', 'unused')).bridge[1]).toEqual(lane(t))
  })

  it('deletes audio once nothing holds it', async () => {
    const t = take('a')
    await storage.storeLanes({ verse: ['a'] }, audioOf(t))
    await storage.saveSketchTakes('one', { verse: ['a'] }, audioOf(t))
    await storage.storeLanes({ verse: [null] }, audioOf())
    expect((await contents('audio')).keys).toEqual(['a'])
    await storage.deleteSketchTakes('one')
    expect((await contents('audio')).keys).toEqual([])
  })

  it('deletes the audio of a section that’s gone', async () => {
    await storage.storeLanes({ verse: ['a'], chorus: ['b'] }, audioOf(take('a'), take('b')))
    await storage.storeLanes({ verse: ['a'] }, audioOf(take('a')))
    expect((await contents('audio')).keys).toEqual(['a'])
  })

  it('deletes the audio a saved sketch dropped when saved again', async () => {
    await storage.saveSketchTakes('one', { verse: ['a', 'b'] }, audioOf(take('a'), take('b')))
    await storage.saveSketchTakes('one', { verse: ['a', null] }, audioOf(take('a')))
    expect((await contents('audio')).keys).toEqual(['a'])
  })
})

/** A database as an earlier version left it, with `stores` filled in. */
function oldDatabase(version: number, stores: Record<string, Record<string, unknown>>) {
  return new Promise<void>((resolve) => {
    const req = indexedDB.open('sketchpad', version)
    req.onupgradeneeded = () => {
      const tx = req.transaction!
      for (const [name, values] of Object.entries(stores)) {
        req.result.createObjectStore(name)
        for (const [key, value] of Object.entries(values)) tx.objectStore(name).put(value, key)
      }
    }
    req.onsuccess = () => {
      req.result.close()
      resolve()
    }
  })
}

describe('upgrading from version 2', () => {
  // Version 2 kept whole 32-bit takes in each lane and saved sketch.
  const old = (length: number) => {
    const { id, ...rest } = take('x', length)
    void id
    return rest
  }

  it('moves takes into the audio store and keeps them playable', async () => {
    const lane = old(500)
    const saved = old(700)
    await oldDatabase(2, { takes: { 'vocal-0': lane }, sketches: {}, 'sketch-takes': { sketch: [null, saved] } })

    const lanes = await storage.loadLanes('verse')
    expect(lanes.verse[0].take?.samples).toEqual(lane.samples)
    const sketch = await storage.loadSketchTakes('sketch', 'verse')
    expect(sketch.verse[0].take).toBeNull()
    expect(sketch.verse[1].take?.samples).toEqual(saved.samples)
    expect((await contents('audio')).keys).toHaveLength(2)
  })

  it('moves the oldest single take into lane 1', async () => {
    const lane = old(300)
    await oldDatabase(2, { takes: { vocal: lane }, sketches: {}, 'sketch-takes': {} })
    const lanes = await storage.loadLanes('verse')
    expect(lanes.verse[0].take?.samples).toEqual(lane.samples)
    expect((await contents('takes')).keys).toEqual(['lanes'])
  })
})

describe('songs saved before sections', () => {
  // Version 3, before sections: a take id in each lane's own key, and a list of lanes for each saved sketch.
  const stored = (length: number) => ({ startBeat: 0, bpm: 96, sampleRate: 48000, pcm: new Int16Array(length).fill(1000) })

  it('puts the lanes in the open section', async () => {
    await oldDatabase(3, { takes: { 'vocal-1': 'a' }, sketches: {}, 'sketch-takes': {}, audio: { a: stored(400) } })
    const lanes = await storage.loadLanes('verse')
    expect(lanes.verse.map((l) => l.take?.id ?? null)).toEqual([null, 'a', null, null])
    expect(lanes.verse[1].take?.samples).toHaveLength(400)
    expect((await contents('takes')).keys).toEqual(['lanes'])
  })

  it('puts a saved sketch’s lanes in the section it opens with', async () => {
    await oldDatabase(3, { takes: {}, sketches: {}, 'sketch-takes': { s: ['a', null] }, audio: { a: stored(200) } })
    const sketch = await storage.loadSketchTakes('s', 'verse')
    expect(sketch.verse.map((l) => l.take?.id ?? null)).toEqual(['a', null])
  })

  it('keeps the audio those lanes hold', async () => {
    await oldDatabase(3, { takes: { 'vocal-0': 'a' }, sketches: {}, 'sketch-takes': { s: [null, 'b'] }, audio: { a: stored(10), b: stored(10), c: stored(10) } })
    await storage.loadLanes('verse')
    // Any write tidies up: only audio nothing holds (c) goes.
    await storage.saveSketchTakes('other', {}, audioOf())
    expect((await contents('audio')).keys).toEqual(['a', 'b'])
  })
})
