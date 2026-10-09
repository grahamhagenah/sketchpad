import { beforeEach, describe, expect, it } from 'vitest'
import { audibleTracks, loopRange, sectionsNow, sketchSignature, songOf, songState, songSummary, totalBeats, useStore } from './store'

describe('loopRange', () => {
  it('loops the whole progression when there is no region', () => {
    expect(loopRange(null, 16)).toEqual({ start: 0, end: 16 })
    expect(loopRange(null, 0)).toEqual({ start: 0, end: 1 })
  })

  it('keeps the region inside the progression, at least a beat long', () => {
    expect(loopRange({ start: 4, end: 8 }, 16)).toEqual({ start: 4, end: 8 })
    expect(loopRange({ start: 12, end: 20 }, 16)).toEqual({ start: 12, end: 16 })
    expect(loopRange({ start: 20, end: 24 }, 16)).toEqual({ start: 15, end: 16 })
    expect(loopRange({ start: 5, end: 5 }, 16)).toEqual({ start: 5, end: 6 })
  })
})

describe('audibleTracks', () => {
  const base = {
    chordsMuted: false,
    chordsSolo: false,
    vocalMuted: [false, false],
    vocalSolo: [false, false],
    takes: [{ id: 'a', startBeat: 0, bpm: 96, seconds: 1, peaks: [] }, null],
  }

  it('plays everything with a take by default', () => {
    expect(audibleTracks(base)).toEqual({ chords: true, vocals: [true, false] })
  })

  it('plays only soloed tracks once any is soloed', () => {
    expect(audibleTracks({ ...base, vocalSolo: [true, false] })).toEqual({ chords: false, vocals: [true, false] })
  })

  it('ignores a solo on a lane without a take', () => {
    expect(audibleTracks({ ...base, vocalSolo: [false, true] })).toEqual({ chords: true, vocals: [true, false] })
  })

  it('silences a muted track even when soloed', () => {
    expect(audibleTracks({ ...base, chordsSolo: true, chordsMuted: true })).toEqual({ chords: false, vocals: [false, false] })
  })
})

describe('setTimeSig', () => {
  beforeEach(() => {
    useStore.setState({ timeSig: [4, 4], loop: null })
    useStore.getState().loadProgression([0, 4, 5, 3], false)
  })

  it('keeps each chord the same number of bars', () => {
    useStore.getState().setTimeSig([3, 4])
    expect(useStore.getState().chords.map((c) => c.beats)).toEqual([3, 3, 3, 3])
    useStore.getState().setTimeSig([6, 8])
    expect(totalBeats(useStore.getState().chords)).toBe(24)
  })

  it('scales the loop region with it', () => {
    useStore.getState().setLoop({ start: 4, end: 12 })
    useStore.getState().setTimeSig([6, 8])
    expect(useStore.getState().loop).toEqual({ start: 6, end: 18 })
  })

  it('never shrinks a chord to nothing', () => {
    useStore.getState().setTimeSig([12, 8])
    useStore.getState().updateChord(useStore.getState().chords[0].id, { beats: 1 })
    useStore.getState().setTimeSig([4, 4])
    expect(useStore.getState().chords[0].beats).toBe(1)
  })
})

describe('sections', () => {
  const get = () => useStore.getState()
  const sectionNamed = (name: string) => get().sections.find((sec) => sec.name === name)!
  const chordsOf = (name: string) => sectionsNow(get()).find((sec) => sec.name === name)!.chords.map((c) => c.degree)

  beforeEach(() => {
    useStore.setState({ ...songState({ chords: [] }), timeSig: [4, 4], view: 'section', recording: 'off' })
    get().loadProgression([0, 4, 5, 3], false)
  })

  it('starts a song with one section, a verse, playing once', () => {
    expect(get().sections.map((sec) => sec.name)).toEqual(['Verse'])
    expect(get().arrangement.map((e) => e.section)).toEqual([get().activeSection])
  })

  it('adds a section to the end of the song and opens it, empty', () => {
    get().addSection('Chorus')
    expect(get().sections.map((sec) => sec.name)).toEqual(['Verse', 'Chorus'])
    expect(get().activeSection).toBe(sectionNamed('Chorus').id)
    expect(get().chords).toEqual([])
    expect(get().arrangement.map((e) => e.section)).toEqual([sectionNamed('Verse').id, sectionNamed('Chorus').id])
  })

  it('numbers a name that’s taken', () => {
    get().addSection('Verse')
    get().addSection('Verse')
    expect(get().sections.map((sec) => sec.name)).toEqual(['Verse', 'Verse 2', 'Verse 3'])
  })

  it('keeps each section’s chords when switching between them', () => {
    get().addSection('Chorus')
    get().loadProgression([3, 4, 0], false)
    get().openSection(sectionNamed('Verse').id)
    expect(get().chords.map((c) => c.degree)).toEqual([0, 4, 5, 3])
    get().openSection(sectionNamed('Chorus').id)
    expect(get().chords.map((c) => c.degree)).toEqual([3, 4, 0])
  })

  it('keeps each section’s vocal tracks apart', () => {
    get().setTake(0, { id: 'verse-take', startBeat: 0, bpm: 96, seconds: 2, peaks: [] })
    get().addSection('Chorus')
    expect(get().takes.every((t) => t === null)).toBe(true)
    get().openSection(sectionNamed('Verse').id)
    expect(get().takes[0]?.id).toBe('verse-take')
  })

  it('shares one section between the places it plays', () => {
    const verse = sectionNamed('Verse').id
    get().addToSong(verse)
    get().updateChord(get().chords[0].id, { degree: 1 })
    expect(chordsOf('Verse')[0]).toBe(1)
    expect(get().arrangement.filter((e) => e.section === verse)).toHaveLength(2)
  })

  it('makes one place a copy that changes on its own', () => {
    const verse = sectionNamed('Verse').id
    get().addToSong(verse)
    const second = get().arrangement[1].id
    get().makeUnique(second)
    const copy = sectionNamed('Verse 2')
    expect(get().arrangement.map((e) => e.section)).toEqual([verse, copy.id])
    expect(copy.chords.map((c) => c.degree)).toEqual([0, 4, 5, 3])
    // The copy's chords are its own.
    expect(copy.chords[0].id).not.toBe(get().chords[0].id)
    get().updateChord(get().chords[0].id, { degree: 2 })
    expect(chordsOf('Verse 2')[0]).toBe(0)
  })

  it('reorders the song', () => {
    get().addSection('Chorus')
    get().addSection('Bridge')
    const [a, b, c] = get().arrangement
    get().moveInSong(c.id, 0)
    expect(get().arrangement).toEqual([c, a, b])
  })

  it('deletes a section, with its places in the song, and opens a neighbour', () => {
    get().addSection('Chorus')
    get().addToSong(sectionNamed('Verse').id)
    get().deleteSection(sectionNamed('Chorus').id)
    expect(get().sections.map((sec) => sec.name)).toEqual(['Verse'])
    expect(get().arrangement.map((e) => e.section)).toEqual([sectionNamed('Verse').id, sectionNamed('Verse').id])
    expect(get().chords.map((c) => c.degree)).toEqual([0, 4, 5, 3])
  })

  it('never deletes the last section', () => {
    get().deleteSection(get().activeSection)
    expect(get().sections).toHaveLength(1)
  })

  it('doesn’t switch sections while recording', () => {
    get().addSection('Chorus')
    get().setRecording('on')
    get().openSection(sectionNamed('Verse').id)
    expect(get().activeSection).toBe(sectionNamed('Chorus').id)
    get().setRecording('off')
  })

  it('rescales every section’s chords with the time signature', () => {
    get().addSection('Chorus')
    get().loadProgression([0, 3], false)
    get().setTimeSig([3, 4])
    expect(get().chords.map((c) => c.beats)).toEqual([3, 3])
    get().openSection(sectionNamed('Verse').id)
    expect(get().chords.map((c) => c.beats)).toEqual([3, 3, 3, 3])
  })
})

describe('saved songs', () => {
  it('turns a song saved before sections into one section called Verse', () => {
    const chords = [{ id: 'c', degree: 0, beats: 4, seventh: false }]
    const song = songState({ chords, loop: { start: 0, end: 2 }, vocalMuted: true, vocalTracks: 1 })
    expect(song.sections.map((sec) => sec.name)).toEqual(['Verse'])
    expect(song.chords).toEqual(chords)
    expect(song.loop).toEqual({ start: 0, end: 2 })
    // vocalMuted was once one flag, for the first track.
    expect(song.vocalMuted).toEqual([true, false, false, false])
    expect(song.arrangement.map((e) => e.section)).toEqual([song.activeSection])
  })

  it('round-trips through songOf', () => {
    useStore.setState({ ...songState({ chords: [] }) })
    useStore.getState().loadProgression([0, 4], false)
    useStore.getState().addSection('Chorus')
    useStore.getState().loadProgression([3], false)
    const saved = songOf(useStore.getState())
    const back = songState(saved)
    expect(back.sections.map((sec) => [sec.name, sec.chords.map((c) => c.degree)])).toEqual([
      ['Verse', [0, 4]],
      ['Chorus', [3]],
    ])
    expect(back.activeSection).toBe(useStore.getState().activeSection)
    expect(back.chords.map((c) => c.degree)).toEqual([3])
    expect(back.arrangement).toEqual(useStore.getState().arrangement)
  })

  it('drops places in the song whose section is gone', () => {
    const song = songState({ sections: [{ id: 'v', name: 'Verse', chords: [] }], arrangement: [{ id: 'a', section: 'v' }, { id: 'b', section: 'gone' }] })
    expect(song.arrangement).toEqual([{ id: 'a', section: 'v' }])
  })

  it('sums a saved song’s length over its places', () => {
    const chords = [{ id: 'c', degree: 0, beats: 8, seventh: false }]
    const summary = songSummary({
      sections: [{ id: 'v', name: 'Verse', chords, vocalTracks: 1 }, { id: 'c', name: 'Chorus', chords: [], vocalTracks: 2 }],
      arrangement: [{ id: '1', section: 'v' }, { id: '2', section: 'c' }, { id: '3', section: 'v' }],
    })
    expect(summary).toEqual({ beats: 16, sections: 2, vocals: 3 })
  })
})

describe('sketchSignature', () => {
  it('doesn’t change when another section is opened', () => {
    useStore.setState({ ...songState({ chords: [] }), recording: 'off' })
    useStore.getState().addSection('Chorus')
    const before = sketchSignature(useStore.getState())
    useStore.getState().openSection(useStore.getState().sections[0].id)
    expect(sketchSignature(useStore.getState())).toBe(before)
    useStore.getState().addChord(0)
    expect(sketchSignature(useStore.getState())).not.toBe(before)
  })
})
