import { beforeEach, describe, expect, it } from 'vitest'
import { songState, useStore } from './store'
import { quantize, takeInfo, type Take } from './audio/take'
import { readSketchFile, sketchFile } from './sketchFile'
import { unzip, zip } from './audio/zip'

const get = () => useStore.getState()
const take = (id: string, length: number): Take => ({
  id,
  startBeat: 2,
  bpm: 96,
  sampleRate: 48000,
  samples: quantize(Float32Array.from({ length }, (_, i) => Math.sin(i / 9) * 0.7)),
})

beforeEach(() => {
  useStore.setState({ ...songState({ chords: [] }), key: 3, mode: 'minor', bpm: 104, timeSig: [6, 8], view: 'section', recording: 'off', title: 'Night drive' })
  get().loadProgression([0, 4, 5, 3], false)
})

describe('zip', () => {
  it('reads back what it writes', async () => {
    const blob = await zip([
      { name: 'a.txt', data: new Blob(['hello']) },
      { name: 'b/c.bin', data: new Blob([new Uint8Array([1, 2, 3])]) },
    ])
    const files = unzip(new Uint8Array(await blob.arrayBuffer()))
    expect(new TextDecoder().decode(files.get('a.txt'))).toBe('hello')
    expect([...files.get('b/c.bin')!]).toEqual([1, 2, 3])
  })
})

describe('backup files', () => {
  it('keeps the song, every take of each track, which one plays, and its trim', async () => {
    const [a, b] = [take('a', 4800), take('b', 2400)]
    get().addTake(0, takeInfo(a))
    get().addTake(0, takeInfo(b))
    get().chooseTake(0, 'a')
    get().setTrim('a', { start: 0.01, end: 0.05 })
    const audio = new Map([a, b].map((t) => [t.id, t]))

    const file = await sketchFile(get(), (id) => audio.get(id))
    const { song, takes } = await readSketchFile(file)

    expect(song.title).toBe('Night drive')
    expect([song.key, song.mode, song.bpm, song.timeSig]).toEqual([3, 'minor', 104, [6, 8]])
    const verse = song.sections![0]
    expect(verse.chords?.map((c) => c.degree)).toEqual([0, 4, 5, 3])
    expect(verse.trims).toEqual({ a: { start: 0.01, end: 0.05 } })
    const lane = takes[verse.id!][0]
    expect(lane.take?.id).toBe('a')
    expect(lane.all.map((t) => t.id)).toEqual(['a', 'b'])
    // The audio comes back sample for sample, where it started and at the tempo it was sung.
    expect(lane.all[1]).toEqual(b)
  })

  it('turns away a file that isn’t a backup', async () => {
    await expect(readSketchFile(new Blob(['not a zip']))).rejects.toThrow('isn’t a Bounce backup')
    const other = await zip([{ name: 'readme.txt', data: new Blob(['hi']) }])
    await expect(readSketchFile(other)).rejects.toThrow('isn’t a Bounce backup')
  })
})
