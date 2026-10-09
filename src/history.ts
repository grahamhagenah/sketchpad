import { create } from 'zustand'
import { useStore } from './store'

// Undo covers the song itself: its chords, key, tempo, meter and loop. Takes
// are left out, since a deleted recording's audio is gone for good.
const pick = (s: ReturnType<typeof useStore.getState>) => ({
  chords: s.chords,
  key: s.key,
  mode: s.mode,
  bpm: s.bpm,
  timeSig: s.timeSig,
  loop: s.loop,
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

const changed = (a: Snapshot, b: Snapshot) => (Object.keys(a) as (keyof Snapshot)[]).some((k) => a[k] !== b[k])

useStore.subscribe((s, prev) => {
  if (applying) return
  const before = pick(prev)
  if (!changed(pick(s), before)) return
  const now = Date.now()
  if (now - lastChange > MERGE_MS || !past.length) {
    past.push(before)
    if (past.length > LIMIT) past.shift()
  }
  lastChange = now
  future.length = 0
  publish()
})

function restore(snapshot: Snapshot) {
  applying = true
  const { selectedId } = useStore.getState()
  // Keep the selection only if that chord is still there.
  useStore.setState({ ...snapshot, selectedId: snapshot.chords.some((c) => c.id === selectedId) ? selectedId : null })
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
