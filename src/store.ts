import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Mode } from './music/theory'
import { DEFAULT_SOUND, type Sound } from './audio/sound'
import { DEFAULT_ARP, type Arp } from './audio/arrange'
import { LANES, type TakeInfo } from './audio/take'

export type TimeSig = [number, number]
export const TIME_SIG_GROUPS: { label: string; sigs: TimeSig[] }[] = [
  { label: 'Common', sigs: [[4, 4], [3, 4], [2, 4], [6, 8], [12, 8]] },
  { label: 'Odd', sigs: [[5, 4], [7, 4], [5, 8], [7, 8], [9, 8], [11, 8], [13, 8], [15, 16]] },
]
export const TIME_SIGS: TimeSig[] = TIME_SIG_GROUPS.flatMap((g) => g.sigs)
export const MIN_BPM = 30
export const MAX_BPM = 300
/** Timeline zoom steps, as a multiple of the normal beat width. */
export const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3]

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
  sound: Sound
  arp: Arp
  /** One recorded vocal per lane, or null; the audio lives in IndexedDB, not here. */
  takes: (TakeInfo | null)[]
  vocalMuted: boolean[]
  vocalSolo: boolean[]
  chordsMuted: boolean
  chordsSolo: boolean
  /** Names given to the tracks; null keeps the usual one. */
  chordsName: string | null
  vocalNames: (string | null)[]
  /** How many vocal tracks show, empty ones included. */
  vocalTracks: number
  /** The lane that recording goes into. */
  armedLane: number
  /** The vocal take that's selected, by lane; a chord and a take are never both selected. */
  selectedVocal: number | null
  recording: 'off' | 'count-in' | 'on'
  /** Beats left in the count-in, shown on the record button. */
  countIn: number | null
  playing: boolean
  /** Where playback starts next, in beats; it stays where you paused. */
  playhead: number
  zoom: number

  setKey: (key: number) => void
  setMode: (mode: Mode) => void
  setBpm: (bpm: number) => void
  setTimeSig: (sig: TimeSig) => void
  toggleMetronome: () => void
  toggleLoop: () => void
  setSound: (patch: Partial<Sound>) => void
  setArp: (patch: Partial<Arp>) => void
  setTake: (lane: number, take: TakeInfo | null) => void
  /** Moves the vocals in lanes `from` into lanes 0, 1, 2…, with their mute and solo. */
  renumberVocals: (from: number[]) => void
  /** Adds an empty vocal track and selects it, ready to record into. */
  addVocalTrack: () => void
  /** Makes sure at least `count` vocal tracks show. */
  showVocalTracks: (count: number) => void
  renameChords: (name: string) => void
  renameVocal: (lane: number, name: string) => void
  toggleVocalMute: (lane: number) => void
  toggleVocalSolo: (lane: number) => void
  toggleChordsMute: () => void
  toggleChordsSolo: () => void
  setArmedLane: (lane: number) => void
  setRecording: (recording: State['recording']) => void
  setCountIn: (countIn: number | null) => void
  setPlaying: (playing: boolean) => void
  setPlayhead: (beat: number) => void
  setLoop: (loop: LoopRegion | null) => void
  zoomBy: (dir: -1 | 1) => void

  addChord: (degree: number) => void
  updateChord: (id: string, patch: Partial<Omit<Chord, 'id'>>) => void
  removeChord: (id: string) => void
  duplicateChord: (id: string) => void
  moveChord: (id: string, dir: -1 | 1) => void
  reorderChord: (id: string, toIndex: number) => void
  clearChords: () => void
  select: (id: string | null) => void
  /** Selects a lane's vocal take (and records into that lane next), instead of a chord. */
  selectVocal: (lane: number | null) => void
  selectRelative: (dir: -1 | 1) => void
}

export const chordsTrackName = (s: Pick<State, 'chordsName'>) => s.chordsName ?? 'Chords'
export const vocalTrackName = (s: Pick<State, 'vocalNames'>, lane: number) => s.vocalNames[lane] ?? `Vocal ${lane + 1}`

const newId = () => crypto.randomUUID()

const starter = (beats: number): Chord[] =>
  [0, 4, 5, 3].map((degree) => ({ id: newId(), degree, beats, seventh: false }))

/**
 * Which tracks sound: with any track soloed, only soloed tracks play; mute
 * always silences a track, soloed or not. Vocal lanes without a take never play.
 */
export function audibleTracks(s: Pick<State, 'chordsMuted' | 'chordsSolo' | 'vocalMuted' | 'vocalSolo' | 'takes'>) {
  const anySolo = s.chordsSolo || s.vocalSolo.some((solo, lane) => solo && s.takes[lane])
  return {
    chords: !s.chordsMuted && (!anySolo || s.chordsSolo),
    vocals: s.takes.map((take, lane) => !!take && !s.vocalMuted[lane] && (!anySolo || s.vocalSolo[lane])),
  }
}

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
      sound: DEFAULT_SOUND,
      arp: DEFAULT_ARP,
      takes: Array(LANES).fill(null),
      vocalMuted: Array(LANES).fill(false),
      vocalSolo: Array(LANES).fill(false),
      chordsMuted: false,
      chordsSolo: false,
      vocalTracks: 0,
      chordsName: null,
      vocalNames: Array(LANES).fill(null),
      armedLane: 0,
      selectedVocal: null,
      recording: 'off',
      countIn: null,
      playing: false,
      playhead: 0,
      zoom: 1,

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
      setSound: (patch) => set({ sound: { ...get().sound, ...patch } }),
      setArp: (patch) => set({ arp: { ...get().arp, ...patch } }),
      setTake: (lane, take) => set({ takes: get().takes.map((t, i) => (i === lane ? take : t)) }),
      renumberVocals: (from) => {
        const { takes, vocalMuted, vocalSolo, vocalNames } = get()
        const pick = <T,>(list: T[], empty: T) => list.map((_, lane) => (lane < from.length ? list[from[lane]] : empty))
        // Nothing stays selected; the next recording goes in the first free lane.
        set({
          takes: pick(takes, null),
          vocalMuted: pick(vocalMuted, false),
          vocalSolo: pick(vocalSolo, false),
          vocalNames: pick(vocalNames, null),
          vocalTracks: from.length,
          selectedVocal: null,
        })
      },
      addVocalTrack: () => {
        const lane = get().vocalTracks
        if (lane >= LANES) return
        set({ vocalTracks: lane + 1, selectedVocal: lane, armedLane: lane, selectedId: null })
      },
      renameChords: (name) => set({ chordsName: name.trim() || null }),
      renameVocal: (lane, name) => set({ vocalNames: get().vocalNames.map((n, i) => (i === lane ? name.trim() || null : n)) }),
      showVocalTracks: (count) => set({ vocalTracks: Math.max(get().vocalTracks, Math.min(count, LANES)) }),
      toggleVocalMute: (lane) => set({ vocalMuted: get().vocalMuted.map((m, i) => (i === lane ? !m : m)) }),
      toggleVocalSolo: (lane) => set({ vocalSolo: get().vocalSolo.map((m, i) => (i === lane ? !m : m)) }),
      toggleChordsMute: () => set({ chordsMuted: !get().chordsMuted }),
      toggleChordsSolo: () => set({ chordsSolo: !get().chordsSolo }),
      setArmedLane: (armedLane) => set({ armedLane }),
      setRecording: (recording) => set({ recording, countIn: recording === 'count-in' ? get().countIn : null }),
      setCountIn: (countIn) => set({ countIn }),
      setPlaying: (playing) => set({ playing }),
      setPlayhead: (playhead) => set({ playhead }),
      setLoop: (loop) => set({ loop }),
      zoomBy: (dir) => {
        const i = ZOOMS.indexOf(get().zoom)
        set({ zoom: ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i === -1 ? ZOOMS.indexOf(1) : i) + dir))] })
      },

      addChord: (degree) => {
        const { chords, selectedId, timeSig } = get()
        const chord: Chord = { id: newId(), degree, beats: timeSig[0], seventh: false }
        const at = chords.findIndex((c) => c.id === selectedId)
        const next = [...chords]
        next.splice(at === -1 ? chords.length : at + 1, 0, chord)
        set({ chords: next, selectedId: chord.id, selectedVocal: null })
      },
      updateChord: (id, patch) =>
        set({ chords: get().chords.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),
      removeChord: (id) => {
        const { chords, selectedId } = get()
        const i = chords.findIndex((c) => c.id === id)
        const next = chords.filter((c) => c.id !== id)
        // Select the chord that took its place (or the one before, at the end),
        // so pressing delete again keeps clearing chords.
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
        set({ chords: next, selectedId: copy.id, selectedVocal: null })
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
      select: (selectedId) => set({ selectedId, selectedVocal: null }),
      selectVocal: (lane) => set(lane === null ? { selectedVocal: null } : { selectedVocal: lane, armedLane: lane, selectedId: null }),
      selectRelative: (dir) => {
        const { chords, selectedId } = get()
        if (!chords.length) return
        const i = chords.findIndex((c) => c.id === selectedId)
        const j = i === -1 ? (dir === 1 ? 0 : chords.length - 1) : Math.min(chords.length - 1, Math.max(0, i + dir))
        set({ selectedId: chords[j].id, selectedVocal: null })
      },
    }),
    {
      name: 'sketchpad-song',
      // Fill in sound settings saved before a setting existed.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>
        // vocalMuted was once a single flag for the one take there was.
        const muted = p.vocalMuted as boolean[] | boolean | undefined
        const vocalMuted = Array.from({ length: LANES }, (_, i) => (Array.isArray(muted) ? !!muted[i] : i === 0 && !!muted))
        const solo = p.vocalSolo as boolean[] | undefined
        const vocalSolo = Array.from({ length: LANES }, (_, i) => !!solo?.[i])
        const vocalNames = Array.from({ length: LANES }, (_, i) => p.vocalNames?.[i] ?? null)
        return { ...current, ...p, sound: { ...DEFAULT_SOUND, ...p.sound }, arp: { ...DEFAULT_ARP, ...p.arp }, vocalMuted, vocalSolo, vocalNames }
      },
      partialize: (s) => ({
        key: s.key,
        mode: s.mode,
        bpm: s.bpm,
        timeSig: s.timeSig,
        chords: s.chords,
        loop: s.loop,
        metronome: s.metronome,
        loopOn: s.loopOn,
        zoom: s.zoom,
        sound: s.sound,
        arp: s.arp,
        vocalMuted: s.vocalMuted,
        vocalSolo: s.vocalSolo,
        chordsMuted: s.chordsMuted,
        chordsSolo: s.chordsSolo,
        vocalTracks: s.vocalTracks,
        chordsName: s.chordsName,
        vocalNames: s.vocalNames,
      }),
    },
  ),
)
