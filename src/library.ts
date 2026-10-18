import { create } from 'zustand'
import { DEFAULT_ARP, DEFAULT_RHYTHM } from './audio/arrange'
import { newSketchSound } from './audio/sound'
import { demoSong, sketchSignature, songOf, songState, useStore, type SavedSong, type SongData, type SongStart } from './store'
import { engine, loadSongTakes } from './audio/engine'
import { SKETCHES, deleteSketchTakes, idb, keepStorage, loadSketchTakes, saveSketchTakes, storageErrorMessage, type SectionTakes } from './audio/take'
import { takeIdsBySection } from './song'
import { clearHistory } from './history'
import { quietly, showUndoNote } from './undoNote'
import { readSketchFile, sketchFile } from './sketchFile'
import { download, exportName } from './audio/export'
import { newId } from './id'
import { tally } from './analytics'

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

/**
 * Where the cloud copy (sync.ts, when someone's signed in) hears of what
 * happens here: a saved sketch changed (saved, deleted, put back or deleted
 * for good), and a sketch about to be opened, whose recordings it fetches
 * first if they aren't on this device (throwing, so it isn't opened, if it
 * can't).
 */
export const syncHooks = {
  changed: (id: string): void => void id,
  beforeOpen: async (id: string): Promise<void> => void id,
}

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

/** Thrown when a sketch isn't opened after all, the person having been told why (its recordings couldn't be fetched, say). */
export class NotOpened extends Error {}

/** Tells the person that something they did wasn't stored, e.g. "save the sketch". */
export function reportStorageError(doing: string) {
  return (error: unknown) => {
    if (error instanceof NotOpened) return
    console.error(error)
    window.alert(`Bounce couldn’t ${doing}. ${storageErrorMessage(error)}`)
  }
}

/** Saves the sketch being worked on, as a new one the first time. */
export async function saveSketch() {
  keepStorage()
  const s = useStore.getState()
  const id = s.sketchId ?? newId()
  const updated = Date.now()
  await idb(SKETCHES, 'readwrite', (store) => store.put({ id, updated, song: songOf(s) } satisfies SketchRecord, id))
  await saveSketchTakes(id, takeIdsBySection(s), (take) => engine.takeAudio(take))
  s.setSaved(id, sketchSignature(useStore.getState()), updated)
  await refreshLibrary()
  syncHooks.changed(id)
}

/**
 * Saves the song as it is now as a new one, named "… copy", and carries on
 * with the copy: the one it came from stays as it was last saved, to go back to.
 */
export async function saveCopy() {
  const s = useStore.getState()
  s.setTitle(`${s.title || 'Untitled sketch'} copy`.slice(0, 40))
  s.setSaved(null, null)
  await saveSketch()
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
  await syncHooks.beforeOpen(id)
  await showSketch(record)
}

/** Puts a saved sketch in the editor, as saved. */
async function showSketch(record: SketchRecord) {
  const takes = await loadSketchTakes(record.id, songState(record.song).activeSection)
  stopEverything()
  putSong(record.song, takes)
  useStore.getState().setSaved(record.id, sketchSignature(useStore.getState()), record.updated)
  clearHistory()
}

/** Whether the editor can be changed under the person now: nothing unsaved, playing or recording. */
const settled = (s = useStore.getState()) => !isDirty(s) && s.recording === 'off' && !s.playing

/**
 * The open sketch's saved copy, when it has changed since the editor showed
 * it (on another device, then synced here) and the editor can show it again
 * (see `settled`); otherwise null. With unsaved changes, they're kept, and
 * saving them wins.
 */
export async function openIsBehind(): Promise<SketchRecord | null> {
  const s = useStore.getState()
  if (!s.sketchId || !settled(s)) return null
  const record = await idb<SketchRecord | undefined>(SKETCHES, 'readonly', (store) => store.get(s.sketchId!))
  return record && !record.deleted && record.updated !== s.savedAt ? record : null
}

/** Shows the open sketch's saved copy again (from openIsBehind), if it's still the one open and nothing changed meanwhile. */
export async function reshow(record: SketchRecord) {
  const s = useStore.getState()
  if (s.sketchId !== record.id || !settled(s)) return
  await showSketch(record)
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
  startBlank()
  tally('new')
  return true
}

/** Throws away the song being worked on, never saved, and starts an empty one: for a song that isn't in your songs to delete. */
export function discardSketch() {
  if (useStore.getState().recording !== 'off') return
  startBlank()
}

function startBlank() {
  stopEverything()
  // One empty section, called Verse, to start from, on a standard sound (the electric piano, its bass held to the kick, no arpeggiator) rather than whatever the last sketch was set to.
  quietly(() => useStore.setState({ ...songState({}), sound: newSketchSound(), arp: DEFAULT_ARP, rhythm: DEFAULT_RHYTHM, title: '', chordsName: null, chordsMuted: false, chordsSolo: false, drumsName: null, drumTrack: false, drumsMuted: false, drumsSolo: false, chordsVolume: 0, drumsVolume: 0, chordsColor: null, drumsColor: null }))
  useStore.getState().setSaved(null, null)
  clearHistory()
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
  // Which ready-made songs get opened, by name.
  tally(`song/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, title)
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
  syncHooks.changed(id)
  showUndoNote(`Deleted ${record.song.title || 'Untitled sketch'}`, () => void restoreSketch(id).catch(reportStorageError('put that sketch back')))
}

/** Puts a recently deleted sketch back among the others. */
export async function restoreSketch(id: string) {
  const record = await idb<SketchRecord | undefined>(SKETCHES, 'readonly', (store) => store.get(id))
  if (!record) return
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { deleted, ...kept } = record
  // Put back now, which counts as a change, so it's put back on other devices too.
  await idb(SKETCHES, 'readwrite', (store) => store.put({ ...kept, updated: Date.now() } satisfies SketchRecord, id))
  await refreshLibrary()
  syncHooks.changed(id)
}

/** Deletes a sketch and its takes for good. */
export async function deleteForever(id: string, refresh = true) {
  await idb(SKETCHES, 'readwrite', (store) => store.delete(id))
  await deleteSketchTakes(id)
  if (refresh) await refreshLibrary()
  syncHooks.changed(id)
}
