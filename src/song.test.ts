import { beforeEach, describe, expect, it } from 'vitest'
import { songState, useStore } from './store'
import { playbackOf, songSpans, takeIdsBySection } from './song'
import { undo, redo, clearHistory } from './history'

const get = () => useStore.getState()
const take = (id: string, startBeat = 0, seconds = 2) => ({ id, startBeat, bpm: 120, seconds, peaks: [] })
const id = (name: string) => get().sections.find((sec) => sec.name === name)!.id

// A song of Verse (4 chords of 4 beats), Chorus (2 chords), Verse again.
beforeEach(() => {
  useStore.setState({ ...songState({ chords: [] }), timeSig: [4, 4], bpm: 120, view: 'section', recording: 'off', chordsMuted: false, chordsSolo: false })
  get().loadProgression([0, 4, 5, 3], false)
  get().setTake(0, take('verse-vocal', 2))
  get().addSection('Chorus')
  get().loadProgression([3, 4], false)
  get().addToSong(id('Verse'))
  clearHistory()
})

describe('songSpans', () => {
  it('places each section where it plays', () => {
    expect(songSpans(get()).map((s) => [s.start, s.beats])).toEqual([[0, 16], [16, 8], [24, 16]])
  })
})

describe('playbackOf', () => {
  it('plays the open section on its own in the section view', () => {
    const p = playbackOf(get())
    expect(p.chords.map((c) => c.degree)).toEqual([3, 4])
    expect(p.vocals).toEqual([])
  })

  it('plays every section in turn in the song view', () => {
    const p = playbackOf(get(), 'song')
    expect(p.chords.map((c) => c.degree)).toEqual([0, 4, 5, 3, 3, 4, 0, 4, 5, 3])
    expect(p.loop).toBeNull()
    // A section that plays twice gets different chord ids each time.
    expect(new Set(p.chords.map((c) => c.id)).size).toBe(10)
  })

  it('plays a section’s vocals each time it plays, cut off at its end', () => {
    const p = playbackOf(get(), 'song')
    expect(p.vocals.map((v) => [v.id, v.startBeat, v.endBeat])).toEqual([
      ['verse-vocal', 2, 16],
      ['verse-vocal', 26, 40],
    ])
  })

  it('applies each section’s own mute and solo to its vocals', () => {
    get().openSection(id('Verse'))
    get().toggleVocalMute(0)
    expect(playbackOf(get(), 'song').vocals).toEqual([])
  })

  it('silences the chords of a section whose vocal is soloed, only there', () => {
    get().openSection(id('Verse'))
    get().toggleVocalSolo(0)
    const silent = playbackOf(get(), 'song').chords.map((c) => !!c.silent)
    expect(silent).toEqual([true, true, true, true, false, false, true, true, true, true])
  })
})

describe('takeIdsBySection', () => {
  it('lists every section’s takes, the open one’s included', () => {
    expect(takeIdsBySection(get())).toEqual({
      [id('Verse')]: ['verse-vocal', null, null, null],
      [id('Chorus')]: [null, null, null, null],
    })
  })
})

describe('undo with sections', () => {
  it('doesn’t count opening a section as a step', () => {
    get().openSection(id('Verse'))
    get().openSection(id('Chorus'))
    undo()
    expect(get().arrangement).toHaveLength(3)
    expect(get().chords.map((c) => c.degree)).toEqual([3, 4])
  })

  it('undoes an edit in another section, going back to it', () => {
    get().openSection(id('Verse'))
    get().updateChord(get().chords[0].id, { degree: 1 })
    get().openSection(id('Chorus'))
    undo()
    expect(get().activeSection).toBe(id('Verse'))
    expect(get().chords[0].degree).toBe(0)
    // The chorus is as it was.
    get().openSection(id('Chorus'))
    expect(get().chords.map((c) => c.degree)).toEqual([3, 4])
  })

  it('undoes changes to the song’s order', async () => {
    const before = get().arrangement
    await new Promise((r) => setTimeout(r, 650))
    get().moveInSong(before[2].id, 0)
    undo()
    expect(get().arrangement).toEqual(before)
    redo()
    expect(get().arrangement[0]).toEqual(before[2])
  })

  it('brings back a deleted section’s chords, keeping the vocals where they are', async () => {
    await new Promise((r) => setTimeout(r, 650))
    get().deleteSection(id('Verse'))
    expect(get().sections.map((sec) => sec.name)).toEqual(['Chorus'])
    undo()
    expect(get().sections.map((sec) => sec.name)).toEqual(['Verse', 'Chorus'])
    get().openSection(id('Verse'))
    expect(get().chords.map((c) => c.degree)).toEqual([0, 4, 5, 3])
    expect(get().takes.every((t) => t === null)).toBe(true)
  })
})
