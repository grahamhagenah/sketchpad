import { create } from 'zustand'
import { sketchSignature, songOf, songState, useStore, type SavedSong, type SongData } from './store'
import { engine, loadSongTakes } from './audio/engine'
import { SKETCHES, deleteSketchTakes, idb, keepStorage, loadSketchTakes, saveSketchTakes, storageErrorMessage } from './audio/take'
import { takeIdsBySection } from './song'
import { clearHistory } from './history'

/** A saved sketch as listed; its takes are stored apart, under the same id. */
export interface SketchRecord {
  id: string
  updated: number
  /** As songOf gives it, or, for a sketch saved before songs had sections, its one progression. */
  song: SavedSong & Pick<SongData, 'key' | 'mode' | 'bpm' | 'timeSig'>
}

/** The saved sketches, newest first, for the library menu. */
export const useLibrary = create<{ sketches: SketchRecord[] }>(() => ({ sketches: [] }))

export async function refreshLibrary() {
  const all = await idb<SketchRecord[]>(SKETCHES, 'readonly', (s) => s.getAll())
  useLibrary.setState({ sketches: all.sort((a, b) => b.updated - a.updated) })
}

/** Whether the sketch has changed since it was last saved (or has never been, but has something in it). */
export function isDirty(s = useStore.getState()) {
  if (s.savedSignature === null) return s.chords.length > 0 || s.takes.some(Boolean)
  return sketchSignature(s) !== s.savedSignature
}

/** Tells the person that something they did wasn't stored, e.g. "save the sketch". */
export function reportStorageError(doing: string) {
  return (error: unknown) => {
    console.error(error)
    window.alert(`Sketchpad couldn’t ${doing}. ${storageErrorMessage(error)}`)
  }
}

/** Saves the sketch being worked on, as a new one the first time. */
export async function saveSketch() {
  keepStorage()
  const s = useStore.getState()
  const id = s.sketchId ?? crypto.randomUUID()
  await idb(SKETCHES, 'readwrite', (store) => store.put({ id, updated: Date.now(), song: songOf(s) } satisfies SketchRecord, id))
  await saveSketchTakes(id, takeIdsBySection(s), (take) => engine.takeAudio(take))
  s.setSaved(id, sketchSignature(useStore.getState()))
  await refreshLibrary()
}

/** Before switching away, keeps unsaved work by saving it; false if that failed. */
async function keepCurrent() {
  if (!isDirty()) return true
  try {
    await saveSketch()
    return true
  } catch (error) {
    // Leave the unsaved sketch open rather than lose it.
    reportStorageError('save your current sketch, so it’s still open')(error)
    return false
  }
}

function stopEverything() {
  engine.stop()
  useStore.setState({ playing: false, playhead: 0, selectedId: null, selectedVocal: null, chordsTrackSelected: false })
}

export async function openSketch(id: string) {
  const s = useStore.getState()
  if (s.recording !== 'off' || id === s.sketchId) return
  if (!(await keepCurrent())) return
  const record = await idb<SketchRecord | undefined>(SKETCHES, 'readonly', (store) => store.get(id))
  if (!record) return
  const song = songState(record.song)
  const takes = await loadSketchTakes(id, song.activeSection)
  stopEverything()
  // The song's settings as saved; its sections, and their parts, as songState reads them.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sections, arrangement, activeSection, chords, loop, takes: _, vocalMuted, vocalSolo, vocalNames, vocalTracks, ...settings } = record.song
  useStore.setState({ ...settings, ...song })
  loadSongTakes(takes)
  useStore.getState().setSaved(id, sketchSignature(useStore.getState()))
  clearHistory()
}

/** Starts an empty sketch, keeping the sound and arpeggiator settings. */
export async function newSketch() {
  if (useStore.getState().recording !== 'off') return
  if (!(await keepCurrent())) return
  stopEverything()
  // One empty section, called Verse, to start from.
  useStore.setState({ ...songState({}), title: '', chordsName: null, chordsMuted: false, chordsSolo: false })
  useStore.getState().setSaved(null, null)
  clearHistory()
}

export async function deleteSketch(id: string) {
  await idb(SKETCHES, 'readwrite', (store) => store.delete(id))
  await deleteSketchTakes(id)
  // The open sketch stays on screen, as unsaved work.
  if (useStore.getState().sketchId === id) useStore.getState().setSaved(null, null)
  await refreshLibrary()
}
