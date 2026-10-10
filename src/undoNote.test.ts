import { beforeEach, describe, expect, it } from 'vitest'
import { songState, useStore } from './store'
import { clearHistory, undo } from './history'
import { hideUndoNote, quietly, useUndoNote } from './undoNote'

const get = () => useStore.getState()
const note = () => useUndoNote.getState().message

beforeEach(() => {
  useStore.setState({ ...songState({ chords: [] }), key: 0, mode: 'major', timeSig: [4, 4], view: 'section', recording: 'off', drumTrack: false })
  get().loadProgression([0, 4, 5, 3], false)
  clearHistory()
  hideUndoNote()
})

describe('the undo note', () => {
  it('says which chord was deleted, and undo brings it back', () => {
    get().removeChord(get().chords[1].id)
    expect(note()).toBe('Deleted G')
    undo()
    expect(get().chords).toHaveLength(4)
  })

  it('says nothing when a progression is put in place of the chords', () => {
    get().loadProgression([0, 3], false)
    expect(note()).toBeNull()
  })

  it('says nothing for a deletion done quietly, as when opening another sketch', () => {
    quietly(() => get().removeChord(get().chords[0].id))
    expect(note()).toBeNull()
  })

  it('names a deleted section', () => {
    get().addSection('Chorus')
    get().deleteSection(get().activeSection)
    expect(note()).toBe('Deleted Chorus')
  })

  it('notes the drum track removed, and undo brings it back', () => {
    get().addDrumTrack()
    clearHistory()
    get().removeDrumTrack()
    expect(note()).toBe('Removed the drum track')
    undo()
    expect(get().drumTrack).toBe(true)
  })

  it('says nothing for undo itself', () => {
    get().removeChord(get().chords[0].id)
    hideUndoNote()
    undo()
    expect(note()).toBeNull()
  })
})
