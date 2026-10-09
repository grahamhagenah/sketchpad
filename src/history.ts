import { create } from 'zustand'
import { emptyParts, sectionsNow, useStore } from './store'

// Undo covers the song itself: its chords, drums, key, tempo, meter and loop, and its
// sections and their order. Takes and the rest of the vocal tracks are left
// out, since a deleted recording's audio is gone for good.
const pick = (s: ReturnType<typeof useStore.getState>) => ({
  chords: s.chords,
  key: s.key,
  mode: s.mode,
  bpm: s.bpm,
  timeSig: s.timeSig,
  loop: s.loop,
  drums: s.drums,
  sections: s.sections,
  arrangement: s.arrangement,
  activeSection: s.activeSection,
})
type Snapshot = ReturnType<typeof pick>

const LIMIT = 100
/** Changes closer together than this (a drag, typing a tempo) undo as one step. */
const MERGE_MS = 600

const past: Snapshot[] = []
const future: Snapshot[] = []
let lastChange = 0
let applying = false

/** Whether there's anything to undo or redo, for the buttons. */
export const useHistory = create(() => ({ canUndo: false, canRedo: false }))
const publish = () => useHistory.setState({ canUndo: past.length > 0, canRedo: future.length > 0 })

type State = ReturnType<typeof useStore.getState>

/**
 * Whether the song itself changed. Opening another section moves chords
 * between the editor and the sections without changing any, so it isn't a step.
 */
function songChanged(s: State, prev: State) {
  if (s.key !== prev.key || s.mode !== prev.mode || s.bpm !== prev.bpm || s.timeSig !== prev.timeSig || s.arrangement !== prev.arrangement) {
    return true
  }
  const now = sectionsNow(s)
  const before = sectionsNow(prev)
  return (
    now.length !== before.length ||
    now.some((sec, i) => sec.id !== before[i].id || sec.name !== before[i].name || sec.chords !== before[i].chords || sec.loop !== before[i].loop || sec.drums !== before[i].drums)
  )
}

useStore.subscribe((s, prev) => {
  if (applying) return
  if (!songChanged(s, prev)) return
  const before = pick(prev)
  const now = Date.now()
  if (now - lastChange > MERGE_MS || !past.length) {
    past.push(before)
    if (past.length > LIMIT) past.shift()
  }
  lastChange = now
  future.length = 0
  publish()
})

/**
 * Puts the song back as it was. Each section keeps its vocal tracks as they
 * are now; a section that comes back after being deleted comes back without them.
 */
function restore(snapshot: Snapshot) {
  applying = true
  const s = useStore.getState()
  const now = new Map(sectionsNow(s).map((sec) => [sec.id, sec]))
  const vocalsOf = (id: string) => {
    const { takes, vocalMuted, vocalSolo, vocalNames, vocalTracks } = now.get(id) ?? emptyParts()
    return { takes, vocalMuted, vocalSolo, vocalNames, vocalTracks }
  }
  const sections = snapshot.sections.map((sec) => ({ ...sec, ...vocalsOf(sec.id) }))
  const switched = snapshot.activeSection !== s.activeSection
  useStore.setState({
    ...snapshot,
    sections,
    // The open section's vocal tracks live at the top, with its chords.
    ...vocalsOf(snapshot.activeSection),
    // Keep the selection only if that chord is still there.
    selectedId: snapshot.chords.some((c) => c.id === s.selectedId) ? s.selectedId : null,
    ...(switched && { selectedVocal: null, chordsTrackSelected: false, drumsTrackSelected: false, armedLane: 0 }),
  })
  applying = false
  lastChange = 0
  publish()
}

/** Forgets all steps, as when another sketch is opened. */
export function clearHistory() {
  past.length = 0
  future.length = 0
  lastChange = 0
  publish()
}

export function undo() {
  const snapshot = past.pop()
  if (!snapshot) return
  future.push(pick(useStore.getState()))
  restore(snapshot)
}

export function redo() {
  const snapshot = future.pop()
  if (!snapshot) return
  past.push(pick(useStore.getState()))
  restore(snapshot)
}
