import { create } from 'zustand'
import { chordOf } from './music/theory'
import { keyOf, sectionsNow, useStore } from './store'
import { isRestoring } from './history'

/**
 * What was just deleted, said in a note with a way to undo it: "Deleted Am ·
 * Undo". Shown a few seconds, or until something else is deleted.
 */
export const useUndoNote = create<{ message: string | null; shown: number; undo: (() => void) | null }>(() => ({ message: null, shown: 0, undo: null }))

const SHOW_MS = 5000
let timer: ReturnType<typeof setTimeout> | undefined

/** Shows the note; its Undo steps back through the history, unless `undo` brings back something kept elsewhere (a deleted sketch). */
export function showUndoNote(message: string, undo: (() => void) | null = null) {
  clearTimeout(timer)
  useUndoNote.setState({ message, shown: Date.now(), undo })
  timer = setTimeout(hideUndoNote, SHOW_MS)
}

export function hideUndoNote() {
  clearTimeout(timer)
  useUndoNote.setState({ message: null })
}

let quiet = 0
/** Runs `fn` without a note for what it deletes: opening another sketch, or taking back a chord just added. */
export function quietly<T>(fn: () => T): T {
  quiet++
  try {
    return fn()
  } finally {
    quiet--
  }
}

type State = ReturnType<typeof useStore.getState>
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** What a change deleted, in a few words, or null if it didn't delete anything. */
export function whatWasDeleted(s: State, prev: State): string | null {
  // A section deleted (with whatever was in it), or one place of it in the song.
  if (s.sections.length < prev.sections.length) {
    const ids = new Set(s.sections.map((sec) => sec.id))
    const gone = prev.sections.filter((sec) => !ids.has(sec.id))
    return gone.length === 1 ? `Deleted ${gone[0].name}` : `Deleted ${plural(gone.length, 'section')}`
  }
  if (s.arrangement.length < prev.arrangement.length && s.sections.length === prev.sections.length) {
    const ids = new Set(s.arrangement.map((e) => e.id))
    const gone = prev.arrangement.find((e) => !ids.has(e.id))
    const name = sectionsNow(prev).find((sec) => sec.id === gone?.section)?.name
    return name ? `Took ${name} out of the song` : 'Took a section out of the song'
  }
  if (prev.drumTrack && !s.drumTrack) return 'Removed the drum track'
  // Opening another section swaps its chords and tracks in; that deletes nothing.
  if (s.activeSection !== prev.activeSection) return null
  // Fewer chords, none of them new: some deleted (not a progression put in place of them).
  const before = new Set(prev.chords.map((c) => c.id))
  if (s.chords.length < prev.chords.length && s.chords.every((c) => before.has(c.id))) {
    const ids = new Set(s.chords.map((c) => c.id))
    const gone = prev.chords.filter((c) => !ids.has(c.id))
    if (gone.length === 1) return `Deleted ${chordOf(keyOf(prev).key, keyOf(prev).mode, gone[0]).name}`
    return `Deleted ${plural(gone.length, 'chord')}`
  }
  // Deleting a vocal track or one of its takes says which itself (see deleteTake), as the tracks after it move up.
  return null
}

// Every deletion, wherever it came from (a button, a key, a menu), gets its note.
useStore.subscribe((s, prev) => {
  if (quiet || isRestoring()) return
  const message = whatWasDeleted(s, prev)
  if (message) showUndoNote(message)
})
