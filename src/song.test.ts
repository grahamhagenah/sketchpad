import { beforeEach, describe, expect, it } from 'vitest'
import { songState, useStore } from './store'
import { playbackOf, sectionBeatOf, songBeatOf, songSpans, takeIdsBySection } from './song'
import { undo, redo, clearHistory, keepVocals } from './history'
import { LANES } from './audio/take'

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
      [id('Verse')]: ['verse-vocal', ...Array(LANES - 1).fill(null)],
      [id('Chorus')]: Array(LANES).fill(null),
    })
  })
  it('keeps every take of a track that has several, and which one plays', () => {
    get().addTake(1, take('first'))
    get().addTake(1, take('second'))
    get().chooseTake(1, 'first')
    expect(takeIdsBySection(get())[id('Chorus')][1]).toEqual({ take: 'first', all: ['first', 'second'] })
  })
})

describe('trimming a take', () => {
  // 120 BPM in 4/4: half a second a beat.
  it('plays only the trimmed part, starting later by what was cut', () => {
    get().setTake(0, take('trimmed', 2, 4))
    get().setTrim('trimmed', { start: 1, end: 3 })
    expect(playbackOf(get()).vocals[0]).toMatchObject({ id: 'trimmed', startBeat: 4, seconds: 2, offset: 1 })
  })

  it('keeps a trim inside the take, and at least a fifth of a second long', () => {
    get().setTake(0, take('short', 0, 1))
    get().setTrim('short', { start: 0.95, end: 5 })
    const [placed] = playbackOf(get()).vocals
    expect(placed.seconds).toBeCloseTo(0.2)
    expect(placed.offset).toBeCloseTo(0.8)
  })

  it('trims in the song view too, where the section starts', () => {
    get().openSection(id('Verse'))
    get().setTrim('verse-vocal', { start: 0.5, end: 1.5 })
    const [first] = playbackOf(get(), 'song').vocals
    // Verse's take starts on beat 2, plus a beat cut off.
    expect(first).toMatchObject({ id: 'verse-vocal', startBeat: 3, seconds: 1, offset: 0.5 })
  })

  it('undoes a trim kept as a step, and forgets a deleted take’s trim', () => {
    get().addTake(0, take('a', 0, 4))
    get().addTake(0, take('b', 0, 4))
    keepVocals()
    get().setTrim('b', { start: 1, end: 2 })
    undo()
    expect(get().trims.b).toBeUndefined()
    get().setTrim('a', { start: 1, end: 2 })
    get().dropTake(0, 'a')
    expect(get().trims.a).toBeUndefined()
  })
})

describe('several takes on a track', () => {
  it('keeps the earlier takes when recording again, playing the new one', () => {
    get().addTake(0, take('one'))
    get().addTake(0, take('two'))
    expect(get().takes[0]?.id).toBe('two')
    expect(get().allTakes[0].map((t) => t.id)).toEqual(['one', 'two'])
    expect(playbackOf(get()).vocals.map((v) => v.id)).toEqual(['two'])
  })

  it('plays whichever take is picked', () => {
    get().addTake(0, take('one'))
    get().addTake(0, take('two'))
    get().chooseTake(0, 'one')
    expect(get().takes[0]?.id).toBe('one')
    expect(get().allTakes[0]).toHaveLength(2)
  })

  it('plays the latest take left when the playing one is deleted, and empties the track with the last', () => {
    get().addTake(0, take('one'))
    get().addTake(0, take('two'))
    get().addTake(0, take('three'))
    get().chooseTake(0, 'two')
    get().dropTake(0, 'two')
    expect(get().takes[0]?.id).toBe('three')
    get().dropTake(0, 'three')
    get().dropTake(0, 'one')
    expect(get().takes[0]).toBeNull()
    expect(get().allTakes[0]).toEqual([])
  })

  it('moves a track’s takes with it when the tracks are renumbered', () => {
    get().addTake(1, take('one'))
    get().addTake(1, take('two'))
    get().renumberVocals([1])
    expect(get().allTakes[0].map((t) => t.id)).toEqual(['one', 'two'])
    expect(get().allTakes[1]).toEqual([])
  })

  it('brings a recorded-over take back as the one playing on undo', () => {
    get().addTake(0, take('one'))
    keepVocals()
    get().addTake(0, take('two'))
    undo()
    expect(get().takes[0]?.id).toBe('one')
    expect(get().allTakes[0].map((t) => t.id)).toEqual(['one'])
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

describe('a section in its own key', () => {
  beforeEach(() => useStore.setState({ key: 0, mode: 'major' }))

  it('plays its chords in its key in the song view, and the rest in the song’s', () => {
    get().setSectionKey(id('Chorus'), { key: 2, mode: 'major' })
    const p = playbackOf(get(), 'song')
    expect(p.chords.map((c) => c.key ?? null)).toEqual([null, null, null, null, 2, 2, null, null, null, null])
  })

  it('plays in its key in the section view, and names its chords there', () => {
    get().setSectionKey(id('Chorus'), { key: 7, mode: 'minor' })
    const p = playbackOf(get())
    expect([p.key, p.mode]).toEqual([7, 'minor'])
  })

  it('goes back to the song’s key when given it', () => {
    get().setSectionKey(id('Chorus'), { key: 0, mode: 'major' })
    expect(get().sectionKey).toBeNull()
  })

  it('lifts one place in the song into a copy a whole step up', () => {
    const last = get().arrangement[2]
    const copy = get().liftSection(id('Verse'), 2, last.id)!
    const lifted = get().sections.find((sec) => sec.id === copy)!
    expect(lifted.sectionKey).toEqual({ key: 2, mode: 'major' })
    expect(get().arrangement.map((e) => e.section)).toEqual([id('Verse'), id('Chorus'), copy])
    // The first verse is untouched.
    expect(get().sections.find((sec) => sec.name === 'Verse')!.sectionKey).toBeNull()
  })

  it('undoes a key change', () => {
    get().setSectionKey(id('Chorus'), { key: 5, mode: 'major' })
    undo()
    expect(get().sectionKey).toBeNull()
  })
})

describe('following the song from a section', () => {
  it('finds where the song is in the open section, only while it plays there', () => {
    // The open section is the chorus, at beats 16–24 of the song.
    expect(sectionBeatOf(get(), 18)).toBe(2)
    expect(sectionBeatOf(get(), 4)).toBeNull()
    expect(sectionBeatOf(get(), 30)).toBeNull()
  })

  it('places a beat of the open section in the song', () => {
    expect(songBeatOf(get(), 3)).toBe(19)
  })
})

describe('copying chords', () => {
  it('pastes after the selected chord, as new chords, and selects the last', () => {
    // The open chorus has two chords; copy the first and paste it after the first.
    const [first] = get().chords
    get().copyChords([first])
    get().select(first.id)
    get().pasteChords()
    const chords = get().chords
    expect(chords.map((c) => c.degree)).toEqual([3, 3, 4])
    expect(chords[1].id).not.toBe(first.id)
    expect(get().selectedId).toBe(chords[1].id)
  })

  it('pastes into another section, with the numerals kept', () => {
    get().copyChords(get().chords)
    get().openSection(id('Verse'))
    get().select(null)
    get().pasteChords()
    expect(get().chords.map((c) => c.degree)).toEqual([0, 4, 5, 3, 3, 4])
  })
})

describe('vocal reverb', () => {
  it('goes with each take into playback, in the section and the song', () => {
    get().openSection(id('Verse'))
    get().setVocalReverb(0, 0.4)
    expect(playbackOf(get()).vocals.map((v) => v.reverb)).toEqual([0.4])
    get().openSection(id('Chorus'))
    expect(playbackOf(get(), 'song').vocals.map((v) => v.reverb)).toEqual([0.4, 0.4])
  })

  it('moves with its track when an earlier one is deleted', () => {
    get().openSection(id('Verse'))
    get().setTake(1, take('second', 0))
    get().setVocalReverb(1, 0.7)
    get().renumberVocals([1])
    expect(get().takes[0]?.id).toBe('second')
    expect(get().vocalReverb[0]).toBe(0.7)
    expect(get().vocalReverb[1]).toBe(0)
  })
})

describe('undoing a deleted take', () => {
  it('brings the track and its take back, and redo deletes it again', () => {
    get().openSection(id('Verse'))
    clearHistory()
    keepVocals()
    get().renumberVocals([])
    expect(get().takes[0]).toBeNull()
    undo()
    expect(get().takes[0]?.id).toBe('verse-vocal')
    redo()
    expect(get().takes[0]).toBeNull()
  })

  it('brings it back in its own section, from another', () => {
    get().openSection(id('Verse'))
    clearHistory()
    keepVocals()
    get().renumberVocals([])
    get().openSection(id('Chorus'))
    undo()
    expect(get().sections.find((sec) => sec.name === 'Verse')!.takes[0]?.id).toBe('verse-vocal')
  })
})
