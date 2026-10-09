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

describe('take storage', () => {
  it('gives back a take as it was saved', async () => {
    const t = take('a')
    await storage.saveTake(1, t)
    const loaded = await storage.loadTakes()
    expect(loaded[0]).toBeNull()
    expect(loaded[1]).toEqual(t)
  })

  it('stores audio as 16-bit', async () => {
    await storage.saveTake(0, take('a'))
    const { values } = await contents('audio')
    expect((values[0] as { pcm: unknown }).pcm).toBeInstanceOf(Int16Array)
  })

  it('stores a take once, however many lanes and sketches hold it', async () => {
    const t = take('a')
    await storage.saveTake(0, t)
    await storage.saveSketchTakes('one', [t, null])
    await storage.saveSketchTakes('two', [null, t])
    expect((await contents('audio')).keys).toEqual(['a'])
    expect((await storage.loadSketchTakes('two'))[1]).toEqual(t)
  })

  it('deletes audio once nothing holds it', async () => {
    const t = take('a')
    await storage.saveTake(0, t)
    await storage.saveSketchTakes('one', [t])
    await storage.deleteSavedTake(0)
    expect((await contents('audio')).keys).toEqual(['a'])
    await storage.deleteSketchTakes('one')
    expect((await contents('audio')).keys).toEqual([])
  })

  it('deletes the audio a lane held when another take replaces it', async () => {
    await storage.saveTake(0, take('a'))
    await storage.saveTake(0, take('b'))
    expect((await contents('audio')).keys).toEqual(['b'])
  })

  it('deletes the audio a saved sketch dropped when saved again', async () => {
    await storage.saveSketchTakes('one', [take('a'), take('b')])
    await storage.saveSketchTakes('one', [take('a'), null])
    expect((await contents('audio')).keys).toEqual(['a'])
  })
})

describe('upgrading from version 2', () => {
  /** A version-2 database, where each lane and saved sketch held whole 32-bit takes. */
  function oldDatabase(lanes: Record<string, unknown>, sketches: Record<string, unknown>) {
    return new Promise<void>((resolve) => {
      const req = indexedDB.open('sketchpad', 2)
      req.onupgradeneeded = () => {
        for (const name of ['takes', 'sketches', 'sketch-takes']) req.result.createObjectStore(name)
        const tx = req.transaction!
        for (const [key, value] of Object.entries(lanes)) tx.objectStore('takes').put(value, key)
        for (const [key, value] of Object.entries(sketches)) tx.objectStore('sketch-takes').put(value, key)
      }
      req.onsuccess = () => {
        req.result.close()
        resolve()
      }
    })
  }
  const old = (length: number) => {
    const { id, ...rest } = take('x', length)
    void id
    return rest
  }

  it('moves takes into the audio store and keeps them playable', async () => {
    const lane = old(500)
    const saved = old(700)
    await oldDatabase({ 'vocal-0': lane }, { sketch: [null, saved] })

    const lanes = await storage.loadTakes()
    expect(lanes[0]?.samples).toEqual(lane.samples)
    const sketch = await storage.loadSketchTakes('sketch')
    expect(sketch[0]).toBeNull()
    expect(sketch[1]?.samples).toEqual(saved.samples)

    expect((await contents('audio')).keys).toHaveLength(2)
    expect((await contents('takes')).values.every((v) => typeof v === 'string')).toBe(true)
  })

  it('moves the oldest single take into lane 1', async () => {
    const lane = old(300)
    await oldDatabase({ vocal: lane }, {})
    const lanes = await storage.loadTakes()
    expect(lanes[0]?.samples).toEqual(lane.samples)
    expect((await contents('takes')).keys).toEqual(['vocal-0'])
  })
})
