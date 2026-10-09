import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Mode } from './music/theory'

export type TimeSig = [number, number]
export const TIME_SIGS: TimeSig[] = [[4, 4], [3, 4], [2, 4], [5, 4], [6, 8], [12, 8]]
export const MIN_BPM = 30
export const MAX_BPM = 300

export interface Chord {
  id: string
  /** Scale degree, 0–6. */
  degree: number
  /** Length in beats of the time signature (eighths in 6/8). */
  beats: number
  seventh: boolean
}

/** Loop region in beats; null loops the whole progression. */
export interface LoopRegion {
  start: number
  end: number
}

export function totalBeats(chords: Chord[]) {
  return chords.reduce((sum, c) => sum + c.beats, 0)
}

/** The region that actually loops, kept inside the progression. */
export function loopRange(loop: LoopRegion | null, total: number): LoopRegion {
  if (!loop || total < 1) return { start: 0, end: Math.max(total, 1) }
  const start = Math.min(Math.max(0, loop.start), total - 1)
  const end = Math.min(Math.max(start + 1, loop.end), total)
  return { start, end }
}

interface Song {
  key: number
  mode: Mode
  bpm: number
  timeSig: TimeSig
  chords: Chord[]
  loop: LoopRegion | null
}

interface State extends Song {
  selectedId: string | null
  metronome: boolean
  loopOn: boolean
  playing: boolean

  setKey: (key: number) => void
  setMode: (mode: Mode) => void
  setBpm: (bpm: number) => void
  setTimeSig: (sig: TimeSig) => void
  toggleMetronome: () => void
  toggleLoop: () => void
  setPlaying: (playing: boolean) => void
  setLoop: (loop: LoopRegion | null) => void

  addChord: (degree: number) => void
  updateChord: (id: string, patch: Partial<Omit<Chord, 'id'>>) => void
  removeChord: (id: string) => void
  duplicateChord: (id: string) => void
  moveChord: (id: string, dir: -1 | 1) => void
  reorderChord: (id: string, toIndex: number) => void
  clearChords: () => void
  select: (id: string | null) => void
  selectRelative: (dir: -1 | 1) => void
}

const newId = () => crypto.randomUUID()

const starter = (beats: number): Chord[] =>
  [0, 4, 5, 3].map((degree) => ({ id: newId(), degree, beats, seventh: false }))

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      key: 0,
      mode: 'major',
      bpm: 96,
      timeSig: [4, 4],
      chords: starter(4),
      loop: null,
      selectedId: null,
      metronome: false,
      loopOn: true,
      playing: false,

      setKey: (key) => set({ key }),
      setMode: (mode) => set({ mode }),
      setBpm: (bpm) => set({ bpm: Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm))) }),
      setTimeSig: (timeSig) => {
        // Keep each chord the same number of bars.
        const old = get().timeSig[0]
        const chords = get().chords.map((c) => ({
          ...c,
          beats: Math.max(1, Math.round((c.beats / old) * timeSig[0])),
        }))
        const loop = get().loop
        const scale = (b: number) => Math.round((b / old) * timeSig[0])
        set({ timeSig, chords, loop: loop && { start: scale(loop.start), end: scale(loop.end) } })
      },
      toggleMetronome: () => set({ metronome: !get().metronome }),
      toggleLoop: () => set({ loopOn: !get().loopOn }),
      setPlaying: (playing) => set({ playing }),
      setLoop: (loop) => set({ loop }),

      addChord: (degree) => {
        const { chords, selectedId, timeSig } = get()
        const chord: Chord = { id: newId(), degree, beats: timeSig[0], seventh: false }
        const at = chords.findIndex((c) => c.id === selectedId)
        const next = [...chords]
        next.splice(at === -1 ? chords.length : at + 1, 0, chord)
        set({ chords: next, selectedId: chord.id })
      },
      updateChord: (id, patch) =>
        set({ chords: get().chords.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),
      removeChord: (id) => {
        const { chords, selectedId } = get()
        const i = chords.findIndex((c) => c.id === id)
        const next = chords.filter((c) => c.id !== id)
        const neighbor = next[Math.min(i, next.length - 1)]
        set({ chords: next, selectedId: selectedId === id ? (neighbor?.id ?? null) : selectedId })
      },
      duplicateChord: (id) => {
        const { chords } = get()
        const i = chords.findIndex((c) => c.id === id)
        if (i === -1) return
        const copy = { ...chords[i], id: newId() }
        const next = [...chords]
        next.splice(i + 1, 0, copy)
        set({ chords: next, selectedId: copy.id })
      },
      clearChords: () => set({ chords: [], selectedId: null, loop: null }),
      reorderChord: (id, toIndex) => {
        const chords = get().chords
        const chord = chords.find((c) => c.id === id)
        if (!chord) return
        const next = chords.filter((c) => c.id !== id)
        next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, chord)
        if (next.some((c, i) => c !== chords[i])) set({ chords: next })
      },
      moveChord: (id, dir) => {
        const chords = [...get().chords]
        const i = chords.findIndex((c) => c.id === id)
        const j = i + dir
        if (i === -1 || j < 0 || j >= chords.length) return
        ;[chords[i], chords[j]] = [chords[j], chords[i]]
        set({ chords })
      },
      select: (selectedId) => set({ selectedId }),
      selectRelative: (dir) => {
        const { chords, selectedId } = get()
        if (!chords.length) return
        const i = chords.findIndex((c) => c.id === selectedId)
        const j = i === -1 ? (dir === 1 ? 0 : chords.length - 1) : Math.min(chords.length - 1, Math.max(0, i + dir))
        set({ selectedId: chords[j].id })
      },
    }),
    {
      name: 'sketchpad-song',
      partialize: (s) => ({
        key: s.key,
        mode: s.mode,
        bpm: s.bpm,
        timeSig: s.timeSig,
        chords: s.chords,
        loop: s.loop,
        metronome: s.metronome,
        loopOn: s.loopOn,
      }),
    },
  ),
)
