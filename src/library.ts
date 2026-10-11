import { create } from 'zustand'
import { DEFAULT_RHYTHM } from './audio/arrange'
import { demoSong, sketchSignature, songOf, songState, useStore, type SavedSong, type SongData, type SongStart } from './store'
import { engine, loadSongTakes } from './audio/engine'
import { SKETCHES, deleteSketchTakes, idb, keepStorage, loadSketchTakes, saveSketchTakes, storageErrorMessage, type SectionTakes } from './audio/take'
import { takeIdsBySection } from './song'
import { clearHistory } from './history'
import { quietly, showUndoNote } from './undoNote'
import { readSketchFile, sketchFile } from './sketchFile'
import { download, exportName } from './audio/export'
import { newId } from './id'

/** A saved sketch as listed; its takes are stored apart, under the same id. */
export interface SketchRecord {
  id: string
  updated: number
  /** When it was deleted: it waits in Recently deleted, to be put back, for DELETED_DAYS. */
  deleted?: number
  /** As songOf gives it, or, for a sketch saved before songs had sections, its one progression. */
  song: SavedSong & Pick<SongData, 'key' | 'mode' | 'bpm' | 'timeSig'>
}

/** The saved sketches, newest first, for the library menu; and those recently deleted, most recently first. */
export const useLibrary = create<{ sketches: SketchRecord[]; deleted: SketchRecord[] }>(() => ({ sketches: [], deleted: [] }))

/** How long a deleted sketch can still be put back. */
export const DELETED_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

export async function refreshLibrary() {
  const all = await idb<SketchRecord[]>(SKETCHES, 'readonly', (s) => s.getAll())
  // Gone for good once they've waited long enough.
  const expired = all.filter((sk) => sk.deleted && Date.now() - sk.deleted > DELETED_DAYS * DAY)
  for (const sk of expired) await deleteForever(sk.id, false)
  const kept = all.filter((sk) => !expired.includes(sk))
  useLibrary.setState({
    sketches: kept.filter((sk) => !sk.deleted).sort((a, b) => b.updated - a.updated),
    deleted: kept.filter((sk) => sk.deleted).sort((a, b) => b.deleted! - a.deleted!),
  })
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
    window.alert(`Bounce couldn’t ${doing}. ${storageErrorMessage(error)}`)
  }
}

/** Saves the sketch being worked on, as a new one the first time. */
export async function saveSketch() {
  keepStorage()
  const s = useStore.getState()
  const id = s.sketchId ?? newId()
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
  useStore.setState({ playing: false, playhead: 0, selectedId: null, selectedVocal: null, chordsTrackSelected: false, drumsTrackSelected: false })
}

export async function openSketch(id: string) {
  const s = useStore.getState()
  if (s.recording !== 'off' || id === s.sketchId) return
  if (!(await keepCurrent())) return
  const record = await idb<SketchRecord | undefined>(SKETCHES, 'readonly', (store) => store.get(id))
  if (!record) return
  const takes = await loadSketchTakes(id, songState(record.song).activeSection)
  stopEverything()
  putSong(record.song, takes)
  useStore.getState().setSaved(id, sketchSignature(useStore.getState()))
  clearHistory()
}

/** Puts a saved song (from the device or a backup file) and its takes in the editor. */
function putSong(saved: SketchRecord['song'], takes: SectionTakes) {
  const song = songState(saved)
  // The song's settings as saved; its sections, and their parts, as songState reads them.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sections, arrangement, activeSection, chords, loop, takes: _, vocalMuted, vocalSolo, vocalNames, vocalVolume, vocalColors, vocalTracks, drums, ...settings } = saved
  // Settings a sketch was saved before having start as they would in a new one.
  quietly(() => {
    useStore.setState({ drumTrack: false, drumsMuted: false, drumsSolo: false, drumsName: null, chordsVolume: 0, drumsVolume: 0, chordsColor: null, drumsColor: null, ...settings, rhythm: { ...DEFAULT_RHYTHM, ...settings.rhythm }, ...song })
    loadSongTakes(takes)
  })
}

/** Downloads the open sketch, recordings and all, as a backup file to keep anywhere. */
export async function backUpSketch() {
  const s = useStore.getState()
  const blob = await sketchFile(s, (id) => engine.takeAudio(id))
  download(blob, `${exportName(s)}.bounce`)
}

/**
 * Opens a backup file as a new sketch, not yet saved on this device (the one
 * open is saved first). Throws, with a message to show, if it isn't one.
 */
export async function openBackup(file: File) {
  if (useStore.getState().recording !== 'off') return
  const { song, takes } = await readSketchFile(file)
  if (!(await keepCurrent())) return
  stopEverything()
  putSong({ key: 0, mode: 'major', bpm: 96, timeSig: [4, 4], ...song } as SketchRecord['song'], takes)
  useStore.getState().setSaved(null, null)
  clearHistory()
}

/** Starts an empty sketch, keeping the sound and arpeggiator settings. */
export async function newSketch() {
  if (useStore.getState().recording !== 'off') return false
  if (!(await keepCurrent())) return false
  stopEverything()
  // One empty section, called Verse, to start from.
  quietly(() => useStore.setState({ ...songState({}), title: '', chordsName: null, chordsMuted: false, chordsSolo: false, drumsName: null, drumTrack: false, drumsMuted: false, drumsSolo: false, chordsVolume: 0, drumsVolume: 0, chordsColor: null, drumsColor: null }))
  useStore.getState().setSaved(null, null)
  clearHistory()
  return true
}

/** A new sketch, opened on its one empty section, ready for its first chords. */
export async function startOwnSong() {
  if (await newSketch()) useStore.getState().setView('section')
}

/** Opens a ready-made song, with its own sound and arpeggiator settings, as a new, unsaved sketch called `title`. */
export async function openSong(start: SongStart, title: string) {
  if (useStore.getState().recording !== 'off') return
  if (!(await keepCurrent())) return
  stopEverything()
  quietly(() => useStore.setState({ title, chordsName: null, chordsMuted: false, chordsSolo: false, drumsName: null, drumsMuted: false, drumsSolo: false, chordsColor: null, drumsColor: null, ...start }))
  useStore.getState().setSaved(null, null)
  clearHistory()
}

export const openDemo = () => openSong(demoSong(), 'Demo song')

/** Moves a sketch to Recently deleted, where it can be put back for DELETED_DAYS; its takes stay until then. */
export async function deleteSketch(id: string) {
  const record = await idb<SketchRecord | undefined>(SKETCHES, 'readonly', (store) => store.get(id))
  if (!record) return
  await idb(SKETCHES, 'readwrite', (store) => store.put({ ...record, deleted: Date.now() } satisfies SketchRecord, id))
  // The open sketch stays on screen, as unsaved work.
  if (useStore.getState().sketchId === id) useStore.getState().setSaved(null, null)
  await refreshLibrary()
  showUndoNote(`Deleted ${record.song.title || 'Untitled sketch'}`, () => void restoreSketch(id).catch(reportStorageError('put that sketch back')))
}

/** Puts a recently deleted sketch back among the others. */
export async function restoreSketch(id: string) {
  const record = await idb<SketchRecord | undefined>(SKETCHES, 'readonly', (store) => store.get(id))
  if (!record) return
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { deleted, ...kept } = record
  await idb(SKETCHES, 'readwrite', (store) => store.put(kept satisfies SketchRecord, id))
  await refreshLibrary()
}

/** Deletes a sketch and its takes for good. */
export async function deleteForever(id: string, refresh = true) {
  await idb(SKETCHES, 'readwrite', (store) => store.delete(id))
  await deleteSketchTakes(id)
  if (refresh) await refreshLibrary()
}
