import { create } from 'zustand'
import { emptyParts, sectionsNow, useStore, type Section, type SectionParts } from './store'

// Undo covers the song itself: its chords, drums, key, tempo, meter and loop,
// and its sections and their order. Vocal tracks are steps of their own, kept
// only when a take is deleted or recorded over (the audio stays in memory for
// the visit, so it can come back); muting, naming and the like aren't steps.
const pick = (s: ReturnType<typeof useStore.getState>) => ({
  chords: s.chords,
  key: s.key,
  mode: s.mode,
  bpm: s.bpm,
  timeSig: s.timeSig,
  loop: s.loop,
  drums: s.drums,
  sectionKey: s.sectionKey,
  sections: s.sections,
  arrangement: s.arrangement,
  activeSection: s.activeSection,
})
type Snapshot = ReturnType<typeof pick>

/** A section's vocal tracks, as kept for undoing a deleted take. */
const vocalsOf = (sec: Pick<Section, keyof VocalParts>): VocalParts => {
  const { takes, vocalMuted, vocalSolo, vocalNames, vocalVolume, vocalReverb, vocalColors, vocalTracks } = sec
  return { takes, vocalMuted, vocalSolo, vocalNames, vocalVolume, vocalReverb, vocalColors, vocalTracks }
}
type VocalParts = Pick<SectionParts, 'takes' | 'vocalMuted' | 'vocalSolo' | 'vocalNames' | 'vocalVolume' | 'vocalReverb' | 'vocalColors' | 'vocalTracks'>

type Step = { kind: 'song'; snapshot: Snapshot } | { kind: 'vocals'; sectionId: string; parts: VocalParts }

const LIMIT = 100
/** Changes closer together than this (a drag, typing a tempo) undo as one step. */
const MERGE_MS = 600

const past: Step[] = []
const future: Step[] = []
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
    now.some((sec, i) => sec.id !== before[i].id || sec.name !== before[i].name || sec.chords !== before[i].chords || sec.loop !== before[i].loop || sec.drums !== before[i].drums || sec.sectionKey !== before[i].sectionKey)
  )
}

useStore.subscribe((s, prev) => {
  if (applying) return
  if (!songChanged(s, prev)) return
  const before = pick(prev)
  const now = Date.now()
  if (now - lastChange > MERGE_MS || !past.length) {
    past.push({ kind: 'song', snapshot: before })
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
  const vocalsNow = (id: string) => vocalsOf(now.get(id) ?? emptyParts())
  const sections = snapshot.sections.map((sec) => ({ ...sec, ...vocalsNow(sec.id) }))
  const switched = snapshot.activeSection !== s.activeSection
  useStore.setState({
    ...snapshot,
    sections,
    // The open section's vocal tracks live at the top, with its chords.
    ...vocalsNow(snapshot.activeSection),
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

/** Puts a section's vocal tracks back as they were, takes included. */
function restoreVocals(sectionId: string, parts: VocalParts) {
  applying = true
  const s = useStore.getState()
  if (sectionId === s.activeSection) useStore.setState({ ...parts, selectedVocal: null })
  else useStore.setState({ sections: s.sections.map((sec) => (sec.id === sectionId ? { ...sec, ...parts } : sec)) })
  applying = false
  lastChange = 0
  publish()
}

/**
 * Keeps the open section's vocal tracks as they are, as a step to undo to:
 * called just before a take is deleted or recorded over.
 */
export function keepVocals() {
  const s = useStore.getState()
  past.push({ kind: 'vocals', sectionId: s.activeSection, parts: vocalsOf(s) })
  if (past.length > LIMIT) past.shift()
  future.length = 0
  lastChange = 0
  publish()
}

/** The step that undoes `step` from how things are now. */
function inverse(step: Step): Step | null {
  const s = useStore.getState()
  if (step.kind === 'song') return { kind: 'song', snapshot: pick(s) }
  const section = sectionsNow(s).find((sec) => sec.id === step.sectionId)
  return section ? { kind: 'vocals', sectionId: step.sectionId, parts: vocalsOf(section) } : null
}

function apply(step: Step) {
  if (step.kind === 'song') restore(step.snapshot)
  else restoreVocals(step.sectionId, step.parts)
}

export function undo() {
  const step = past.pop()
  if (!step) return
  const back = inverse(step)
  // A section's vocals can't come back once the section itself is gone.
  if (!back) return publish()
  future.push(back)
  apply(step)
}

export function redo() {
  const step = future.pop()
  if (!step) return
  const back = inverse(step)
  if (!back) return publish()
  past.push(back)
  apply(step)
}
