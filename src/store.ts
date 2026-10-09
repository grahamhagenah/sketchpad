import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChordSpec, Mode } from './music/theory'
import { DEFAULT_SOUND, type Sound } from './audio/sound'
import { DEFAULT_ARP, DEFAULT_RHYTHM, type Arp, type Rhythm } from './audio/arrange'
import { LANES, type TakeInfo } from './audio/take'
import type { GrooveId } from './audio/drums'
import { DEFAULT_CHORDS_COLOR, DEFAULT_DRUMS_COLOR, freshColor, vocalColorId, type ColorId } from './colors'
import { newId } from './id'

export type TimeSig = [number, number]
export const TIME_SIG_GROUPS: { label: string; sigs: TimeSig[] }[] = [
  // Simple meters split each beat in two, compound ones in three; asymmetric
  // ones mix groups of two and three (5/8 as 2+3, 7/8 as 2+2+3, and so on).
  { label: 'Simple', sigs: [[4, 4], [3, 4], [2, 4]] },
  { label: 'Compound', sigs: [[6, 8], [9, 8], [12, 8]] },
  { label: 'Asymmetric', sigs: [[5, 4], [7, 4], [5, 8], [7, 8], [11, 8], [13, 8], [15, 16]] },
]
export const TIME_SIGS: TimeSig[] = TIME_SIG_GROUPS.flatMap((g) => g.sigs)
export const MIN_BPM = 30
export const MAX_BPM = 300
/** Timeline zoom steps, as a multiple of the normal beat width. */
export const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3]

export interface Chord extends ChordSpec {
  id: string
  /** Length in beats of the time signature (eighths in 6/8). */
  beats: number
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

/** A key and mode, as a section can have its own. */
export interface SectionKey {
  key: number
  mode: Mode
}

/**
 * What each section of a song keeps of its own: its chords, loop and vocal
 * tracks. The open section's live at the top of the state, where the editor
 * works on them, and are put back in its place among the sections when
 * another one opens.
 */
export interface SectionParts {
  chords: Chord[]
  loop: LoopRegion | null
  /** One recorded vocal per lane, or null; the audio lives in IndexedDB, not here. */
  takes: (TakeInfo | null)[]
  vocalMuted: boolean[]
  vocalSolo: boolean[]
  /** Names given to the vocal tracks; null keeps the usual one. */
  vocalNames: (string | null)[]
  /** Each vocal track's level, in dB from its usual one. */
  vocalVolume: number[]
  /** Colours given to the vocal tracks; null keeps the one its lane takes by default. */
  vocalColors: (ColorId | null)[]
  /** How many vocal tracks show, empty ones included. */
  vocalTracks: number
  /** The drum groove the section plays, or none. */
  drums: GrooveId | null
  /** The section's own key, for a key change; null plays it in the song's key. */
  sectionKey: SectionKey | null
}

/** A part of the song, such as a verse or chorus, that can play in it any number of times. */
export interface Section extends SectionParts {
  id: string
  name: string
}

/** One place in the song where a section plays. */
export interface SongEntry {
  id: string
  section: string
}

export const SECTION_KINDS = ['Intro', 'Verse', 'Pre-chorus', 'Chorus', 'Bridge', 'Outro']

interface State extends SectionParts {
  key: number
  mode: Mode
  bpm: number
  timeSig: TimeSig
  /** Every section; the open one's parts here are out of date (see sectionsNow). */
  sections: Section[]
  /** The section open in the editor. */
  activeSection: string
  /** The song: which section plays when, repeats included. */
  arrangement: SongEntry[]
  /** Editing one section, or looking over the whole song. */
  view: 'section' | 'song'
  selectedId: string | null
  metronome: boolean
  loopOn: boolean
  sound: Sound
  arp: Arp
  rhythm: Rhythm
  chordsMuted: boolean
  chordsSolo: boolean
  /** Whether the song has a drum track; each section picks its own groove for it. */
  drumTrack: boolean
  drumsMuted: boolean
  drumsSolo: boolean
  /** The chords' and drums' levels, in dB from their usual ones. */
  chordsVolume: number
  drumsVolume: number
  /** The chords' and drums' colours, or null for their usual ones. */
  chordsColor: ColorId | null
  drumsColor: ColorId | null
  /** The sketch's name; empty until you give it one. */
  title: string
  /** Which saved sketch this is, once it's been saved. */
  sketchId: string | null
  /** The sketch as last saved (see sketchSignature), to tell whether it has changed since. */
  savedSignature: string | null
  /** The name given to the chords track; null keeps the usual one. */
  chordsName: string | null
  drumsName: string | null
  /** The lane that recording goes into. */
  armedLane: number
  /** The vocal take that's selected, by lane; a chord and a take are never both selected. */
  selectedVocal: number | null
  /** The chords track as a whole is selected (deleting then clears the progression). */
  chordsTrackSelected: boolean
  /** The drum track is selected (deleting then removes it). */
  drumsTrackSelected: boolean
  recording: 'off' | 'count-in' | 'on'
  /** Beats left in the count-in, shown on the record button. */
  countIn: number | null
  /** How late recordings arrive on this device, in seconds, once measured; kept with the device, not the song. */
  latency: number | null
  playing: boolean
  /** What's playing: the whole song or the open section, as it was when play started; it carries on while you look elsewhere. */
  playingView: 'section' | 'song'
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
  setRhythm: (patch: Partial<Rhythm>) => void
  setTake: (lane: number, take: TakeInfo | null) => void
  /** Moves the vocals in lanes `from` into lanes 0, 1, 2…, with their mute and solo. */
  renumberVocals: (from: number[]) => void
  /** Adds an empty vocal track and selects it, ready to record into. */
  addVocalTrack: () => void
  /** Makes sure at least `count` vocal tracks show. */
  showVocalTracks: (count: number) => void
  setTitle: (title: string) => void
  setSaved: (sketchId: string | null, signature: string | null) => void
  renameChords: (name: string) => void
  renameVocal: (lane: number, name: string) => void
  toggleVocalMute: (lane: number) => void
  toggleVocalSolo: (lane: number) => void
  toggleChordsMute: () => void
  toggleChordsSolo: () => void
  setDrums: (groove: GrooveId | null) => void
  /** Gives a section its own key, or (with null, or the song's own key) puts it back in the song's. */
  setSectionKey: (sectionId: string, sectionKey: SectionKey | null) => void
  /**
   * Copies a section into a new one `semitones` higher, as for a last chorus
   * that lifts, and returns its id. With `entryId`, that place in the song
   * plays the copy instead.
   */
  liftSection: (sectionId: string, semitones: number, entryId?: string) => string | null
  /** Adds the drum track, starting the open section on a backbeat if it has no groove yet. */
  addDrumTrack: () => void
  /** Takes the drum track away; each section keeps its groove, in case it comes back. */
  removeDrumTrack: () => void
  renameDrums: (name: string) => void
  toggleDrumsMute: () => void
  toggleDrumsSolo: () => void
  setChordsVolume: (db: number) => void
  setDrumsVolume: (db: number) => void
  setVocalVolume: (lane: number, db: number) => void
  setChordsColor: (color: ColorId) => void
  setDrumsColor: (color: ColorId) => void
  setVocalColor: (lane: number, color: ColorId) => void
  /** Unmutes every track and clears every solo, so everything plays. */
  unmuteAll: () => void
  setArmedLane: (lane: number) => void
  setRecording: (recording: State['recording']) => void
  setCountIn: (countIn: number | null) => void
  setLatency: (latency: number | null) => void
  setPlaying: (playing: boolean) => void
  setPlayhead: (beat: number) => void
  setLoop: (loop: LoopRegion | null) => void
  zoomBy: (dir: -1 | 1) => void

  /** Adds a chord after the selected one (or at the end), borrowed from the parallel key if asked. */
  addChord: (degree: number, borrowed?: boolean) => void
  updateChord: (id: string, patch: Partial<Omit<Chord, 'id'>>) => void
  removeChord: (id: string) => void
  duplicateChord: (id: string) => void
  moveChord: (id: string, dir: -1 | 1) => void
  reorderChord: (id: string, toIndex: number) => void
  clearChords: () => void
  /** Replaces the progression with these scale degrees, a bar each. */
  loadProgression: (degrees: number[], seventh: boolean) => void
  select: (id: string | null) => void
  /** Selects a lane's vocal take (and records into that lane next), instead of a chord. */
  selectVocal: (lane: number | null) => void
  selectChordsTrack: () => void
  selectDrumsTrack: () => void
  selectRelative: (dir: -1 | 1) => void

  /** Opens a section in the editor. */
  openSection: (id: string) => void
  setView: (view: State['view']) => void
  /** Adds an empty section to the end of the song and opens it; the name gets a number if it's taken. */
  addSection: (name: string) => void
  renameSection: (id: string, name: string) => void
  /** Copies a section's chords, loop and drums into a new section after it, and returns its id. */
  duplicateSection: (id: string) => string | null
  /** Deletes a section and its places in the song; the last section can't be deleted. */
  deleteSection: (id: string) => void
  addToSong: (sectionId: string) => void
  removeFromSong: (entryId: string) => void
  moveInSong: (entryId: string, toIndex: number) => void
  /** Gives one place in the song its own copy of its section, to change without changing the others. */
  makeUnique: (entryId: string) => void
  /** Puts loaded takes in a section, showing enough tracks for them. */
  setSectionTakes: (sectionId: string, takes: (TakeInfo | null)[]) => void
}

export const chordsTrackName = (s: Pick<State, 'chordsName'>) => s.chordsName ?? 'Chords'
/** The key a section plays in: its own, or the song's. */
export const keyOf = (s: Pick<State, 'key' | 'mode'> & Pick<SectionParts, 'sectionKey'>): SectionKey => s.sectionKey ?? { key: s.key, mode: s.mode }

/** The colours the open section's tracks have now, for a new track to keep clear of. */
function colorsInUse(s: Pick<State, 'chordsColor' | 'drumsColor' | 'drumTrack' | 'vocalColors' | 'vocalTracks'>): ColorId[] {
  return [
    s.chordsColor ?? DEFAULT_CHORDS_COLOR,
    ...(s.drumTrack ? [s.drumsColor ?? DEFAULT_DRUMS_COLOR] : []),
    ...Array.from({ length: s.vocalTracks }, (_, lane) => vocalColorId(s.vocalColors, lane)),
  ]
}

export const drumsTrackName = (s: Pick<State, 'drumsName'>) => s.drumsName ?? 'Drums'
export const vocalTrackName = (s: Pick<State, 'vocalNames'>, lane: number) => s.vocalNames[lane] ?? `Vocal ${lane + 1}`


const partsOf = (p: SectionParts): SectionParts => ({
  chords: p.chords,
  loop: p.loop,
  takes: p.takes,
  vocalMuted: p.vocalMuted,
  vocalSolo: p.vocalSolo,
  vocalNames: p.vocalNames,
  vocalVolume: p.vocalVolume,
  vocalColors: p.vocalColors,
  vocalTracks: p.vocalTracks,
  drums: p.drums,
  sectionKey: p.sectionKey,
})

export const emptyParts = (): SectionParts => ({
  chords: [],
  loop: null,
  takes: Array(LANES).fill(null),
  vocalMuted: Array(LANES).fill(false),
  vocalSolo: Array(LANES).fill(false),
  vocalNames: Array(LANES).fill(null),
  vocalVolume: Array(LANES).fill(0),
  vocalColors: Array(LANES).fill(null),
  vocalTracks: 0,
  drums: null,
  sectionKey: null,
})

/** Every section as it is now, the open one's parts taken from the editor. */
export function sectionsNow(s: Pick<State, 'sections' | 'activeSection' | keyof SectionParts>): Section[] {
  return s.sections.map((sec) => (sec.id === s.activeSection ? { ...sec, ...partsOf(s) } : sec))
}

/** `name`, or with the lowest number after it that no section has yet ("Verse 2"). */
export function uniqueName(sections: { name: string }[], name: string) {
  const taken = new Set(sections.map((s) => s.name))
  if (!taken.has(name)) return name
  let n = 2
  while (taken.has(`${name} ${n}`)) n++
  return `${name} ${n}`
}

/** Everything a saved sketch keeps, apart from its takes, which are stored with their audio. */
export function songOf(s: State) {
  return {
    key: s.key,
    mode: s.mode,
    bpm: s.bpm,
    timeSig: s.timeSig,
    metronome: s.metronome,
    loopOn: s.loopOn,
    sound: s.sound,
    arp: s.arp,
    rhythm: s.rhythm,
    chordsMuted: s.chordsMuted,
    chordsSolo: s.chordsSolo,
    drumTrack: s.drumTrack,
    drumsMuted: s.drumsMuted,
    drumsSolo: s.drumsSolo,
    chordsVolume: s.chordsVolume,
    drumsVolume: s.drumsVolume,
    chordsColor: s.chordsColor,
    drumsColor: s.drumsColor,
    title: s.title,
    chordsName: s.chordsName,
    drumsName: s.drumsName,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    sections: sectionsNow(s).map(({ takes, ...section }) => section),
    arrangement: s.arrangement,
    activeSection: s.activeSection,
  }
}
export type SongData = ReturnType<typeof songOf>

/** A sketch as saved before songs had sections: one progression and its vocal tracks. */
type LegacySong = Partial<Omit<SectionParts, 'vocalMuted'>> & { vocalMuted?: boolean[] | boolean }

/** Lane settings filled out to every lane; vocalMuted was once a single flag for the one take there was. */
function lanesOf(p: LegacySong) {
  const muted = p.vocalMuted
  return {
    vocalMuted: Array.from({ length: LANES }, (_, i) => (Array.isArray(muted) ? !!muted[i] : i === 0 && !!muted)),
    vocalSolo: Array.from({ length: LANES }, (_, i) => !!p.vocalSolo?.[i]),
    vocalNames: Array.from({ length: LANES }, (_, i) => p.vocalNames?.[i] ?? null),
    vocalVolume: Array.from({ length: LANES }, (_, i) => p.vocalVolume?.[i] ?? 0),
    vocalColors: Array.from({ length: LANES }, (_, i) => p.vocalColors?.[i] ?? null),
  }
}

/**
 * The state for a saved song, with its first (or last open) section open.
 * Songs saved before sections become a song of one section, called Verse.
 * Takes come empty; they're loaded with their audio.
 */
/** A song as saved, by songOf or, before songs had sections, as one progression. */
export type SavedSong = Partial<Omit<SongData, 'sections'>> & LegacySong & { sections?: Partial<Section>[] }

export function songState(p: SavedSong) {
  const sections: Section[] = p.sections?.length
    ? p.sections.map((sec) => ({ ...emptyParts(), id: newId(), name: 'Section', ...sec, ...lanesOf(sec), takes: Array(LANES).fill(null) }))
    : [{ ...emptyParts(), ...lanesOf(p), id: newId(), name: 'Verse', chords: p.chords ?? [], loop: p.loop ?? null, vocalTracks: p.vocalTracks ?? 0, drums: p.drums ?? null }]
  const ids = new Set(sections.map((sec) => sec.id))
  const arrangement = p.arrangement
    ? p.arrangement.filter((entry) => ids.has(entry.section))
    : sections.map((sec) => ({ id: newId(), section: sec.id }))
  const active = sections.find((sec) => sec.id === p.activeSection) ?? sections[0]
  return { sections, arrangement, activeSection: active.id, ...partsOf(active) }
}

/** How long a saved song plays, in beats, and how many sections and vocal tracks it has, for listing it. */
export function songSummary(song: SavedSong) {
  const { sections, arrangement } = songState(song)
  const lengths = sectionBeats(sections)
  return {
    beats: arrangement.reduce((n, entry) => n + (lengths.get(entry.section) ?? 0), 0),
    sections: sections.length,
    vocals: sections.reduce((n, sec) => n + sec.vocalTracks, 0),
  }
}

/**
 * A fingerprint of the sketch, takes included, to compare against the saved
 * one. Which section is open doesn't count: looking around isn't a change.
 */
export function sketchSignature(s: State) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { activeSection, ...song } = songOf(s)
  return JSON.stringify([song, sectionsNow(s).map((sec) => sec.takes.map((t) => t?.id ?? null))])
}

/** How long each section is, in beats. */
export const sectionBeats = (sections: Pick<Section, 'id' | 'chords'>[]) => new Map(sections.map((sec) => [sec.id, totalBeats(sec.chords)]))

const progression = (degrees: number[]): Chord[] => degrees.map((degree) => ({ id: newId(), degree, beats: 4, seventh: false }))

/**
 * What a first visit opens on: a short song to press play on, a verse
 * leading into a chorus, with drums and the chords pushed in time with them,
 * so what Bounce does is heard straight away. "New sketch" starts from nothing.
 */
function starterSong() {
  const verse = { id: newId(), name: 'Verse', chords: progression([5, 3, 0, 4]), drums: 'light' as const }
  const chorus = { id: newId(), name: 'Chorus', chords: progression([0, 4, 5, 3]), drums: 'backbeat' as const }
  return {
    ...songState({
      sections: [verse, chorus],
      arrangement: [verse, chorus, verse, chorus].map((sec) => ({ id: newId(), section: sec.id })),
      activeSection: verse.id,
    }),
    view: 'song' as const,
    drumTrack: true,
    rhythm: { ...DEFAULT_RHYTHM, chords: 'tresillo' as const },
  }
}

/**
 * Which tracks sound: with any track soloed, only soloed tracks play; mute
 * always silences a track, soloed or not. Vocal lanes without a take never play.
 */
export function audibleTracks(s: Pick<State, 'chordsMuted' | 'chordsSolo' | 'drumsMuted' | 'drumsSolo' | 'vocalMuted' | 'vocalSolo' | 'takes'>) {
  const anySolo = s.chordsSolo || s.drumsSolo || s.vocalSolo.some((solo, lane) => solo && s.takes[lane])
  return {
    chords: !s.chordsMuted && (!anySolo || s.chordsSolo),
    drums: !s.drumsMuted && (!anySolo || s.drumsSolo),
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
      ...starterSong(),
      selectedId: null,
      metronome: false,
      loopOn: true,
      sound: DEFAULT_SOUND,
      arp: DEFAULT_ARP,
      chordsMuted: false,
      chordsSolo: false,
      drumsMuted: false,
      drumsSolo: false,
      chordsVolume: 0,
      drumsVolume: 0,
      chordsColor: null,
      drumsColor: null,
      title: '',
      sketchId: null,
      savedSignature: null,
      chordsName: null,
      drumsName: null,
      armedLane: 0,
      selectedVocal: null,
      chordsTrackSelected: false, drumsTrackSelected: false,
      recording: 'off',
      countIn: null,
      latency: null,
      playing: false,
      playingView: 'section',
      playhead: 0,
      zoom: 1,

      setKey: (key) => set({ key }),
      setMode: (mode) => set({ mode }),
      setBpm: (bpm) => set({ bpm: Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm))) }),
      setTimeSig: (timeSig) => {
        // Keep each chord, in every section, the same number of bars.
        const { activeSection, sections } = get()
        const old = get().timeSig[0]
        const scale = (b: number) => Math.round((b / old) * timeSig[0])
        const rescale = ({ chords, loop }: Pick<SectionParts, 'chords' | 'loop'>) => ({
          chords: chords.map((c) => ({ ...c, beats: Math.max(1, scale(c.beats)) })),
          loop: loop && { start: scale(loop.start), end: scale(loop.end) },
        })
        set({
          timeSig,
          ...rescale(get()),
          sections: sections.map((sec) => (sec.id === activeSection ? sec : { ...sec, ...rescale(sec) })),
        })
      },
      toggleMetronome: () => set({ metronome: !get().metronome }),
      toggleLoop: () => set({ loopOn: !get().loopOn }),
      setSound: (patch) => set({ sound: { ...get().sound, ...patch } }),
      setArp: (patch) => set({ arp: { ...get().arp, ...patch } }),
      setRhythm: (patch) => set({ rhythm: { ...get().rhythm, ...patch } }),
      setTake: (lane, take) => set({ takes: get().takes.map((t, i) => (i === lane ? take : t)) }),
      renumberVocals: (from) => {
        const { takes, vocalMuted, vocalSolo, vocalNames, vocalVolume, vocalColors } = get()
        const pick = <T,>(list: T[], empty: T) => list.map((_, lane) => (lane < from.length ? list[from[lane]] : empty))
        // Nothing stays selected; the next recording goes in the first free lane.
        set({
          takes: pick(takes, null),
          vocalMuted: pick(vocalMuted, false),
          vocalSolo: pick(vocalSolo, false),
          vocalNames: pick(vocalNames, null),
          vocalVolume: pick(vocalVolume, 0),
          vocalColors: pick(vocalColors, null),
          vocalTracks: from.length,
          selectedVocal: null,
        })
      },
      addVocalTrack: () => {
        const s = get()
        const lane = s.vocalTracks
        if (lane >= LANES || !s.chords.length) return
        // A colour of its own, at random, from those no other track has.
        const vocalColors = s.vocalColors.map((c, i) => (i === lane ? freshColor(colorsInUse(s)) : c))
        set({ vocalTracks: lane + 1, vocalColors, selectedVocal: lane, armedLane: lane, selectedId: null, chordsTrackSelected: false, drumsTrackSelected: false })
      },
      setTitle: (title) => set({ title }),
      setSaved: (sketchId, savedSignature) => set({ sketchId, savedSignature }),
      renameChords: (name) => set({ chordsName: name.trim() || null }),
      renameVocal: (lane, name) => set({ vocalNames: get().vocalNames.map((n, i) => (i === lane ? name.trim() || null : n)) }),
      showVocalTracks: (count) => {
        const s = get()
        const vocalTracks = Math.max(s.vocalTracks, Math.min(count, LANES))
        // Tracks a recording brings in get colours of their own, as added ones do.
        const vocalColors = [...s.vocalColors]
        for (let lane = s.vocalTracks; lane < vocalTracks; lane++) {
          vocalColors[lane] ??= freshColor(colorsInUse({ ...s, vocalColors, vocalTracks: lane }))
        }
        set({ vocalTracks, vocalColors })
      },
      toggleVocalMute: (lane) => set({ vocalMuted: get().vocalMuted.map((m, i) => (i === lane ? !m : m)) }),
      toggleVocalSolo: (lane) => set({ vocalSolo: get().vocalSolo.map((m, i) => (i === lane ? !m : m)) }),
      toggleChordsMute: () => set({ chordsMuted: !get().chordsMuted }),
      toggleChordsSolo: () => set({ chordsSolo: !get().chordsSolo }),
      setDrums: (drums) => set({ drums }),
      setSectionKey: (sectionId, k) => {
        const s = get()
        const sectionKey = k && (k.key !== s.key || k.mode !== s.mode) ? k : null
        if (sectionId === s.activeSection) return set({ sectionKey })
        set({ sections: s.sections.map((sec) => (sec.id === sectionId ? { ...sec, sectionKey } : sec)) })
      },
      liftSection: (sectionId, semitones, entryId) => {
        const s = get()
        const section = sectionsNow(s).find((sec) => sec.id === sectionId)
        if (!section || s.recording !== 'off') return null
        const from = keyOf({ key: s.key, mode: s.mode, sectionKey: section.sectionKey })
        const copy = get().duplicateSection(sectionId)
        if (!copy) return null
        get().setSectionKey(copy, { key: (from.key + semitones + 12) % 12, mode: from.mode })
        if (entryId) set({ arrangement: get().arrangement.map((e) => (e.id === entryId ? { ...e, section: copy } : e)) })
        return copy
      },
      addDrumTrack: () => {
        const s = get()
        if (s.chords.length) set({ drumTrack: true, drums: s.drums ?? 'backbeat', drumsColor: freshColor(colorsInUse(s)) })
      },
      removeDrumTrack: () => set({ drumTrack: false, drumsMuted: false, drumsSolo: false, drumsTrackSelected: false }),
      renameDrums: (name) => set({ drumsName: name.trim() || null }),
      toggleDrumsMute: () => set({ drumsMuted: !get().drumsMuted }),
      toggleDrumsSolo: () => set({ drumsSolo: !get().drumsSolo }),
      setChordsVolume: (chordsVolume) => set({ chordsVolume }),
      setDrumsVolume: (drumsVolume) => set({ drumsVolume }),
      setChordsColor: (chordsColor) => set({ chordsColor }),
      setDrumsColor: (drumsColor) => set({ drumsColor }),
      setVocalColor: (lane, color) => set({ vocalColors: get().vocalColors.map((c, i) => (i === lane ? color : c)) }),
      setVocalVolume: (lane, db) => set({ vocalVolume: get().vocalVolume.map((v, i) => (i === lane ? db : v)) }),
      unmuteAll: () =>
        set({ chordsMuted: false, chordsSolo: false, drumsMuted: false, drumsSolo: false, vocalMuted: Array(LANES).fill(false), vocalSolo: Array(LANES).fill(false) }),
      setArmedLane: (armedLane) => set({ armedLane }),
      setRecording: (recording) => set({ recording, countIn: recording === 'count-in' ? get().countIn : null }),
      setCountIn: (countIn) => set({ countIn }),
      setLatency: (latency) => set({ latency }),
      setPlaying: (playing) => set({ playing }),
      setPlayhead: (playhead) => set({ playhead }),
      setLoop: (loop) => set({ loop }),
      zoomBy: (dir) => {
        const i = ZOOMS.indexOf(get().zoom)
        set({ zoom: ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i === -1 ? ZOOMS.indexOf(1) : i) + dir))] })
      },

      addChord: (degree, borrowed) => {
        const { chords, selectedId, timeSig } = get()
        const chord: Chord = { id: newId(), degree, beats: timeSig[0], seventh: false, ...(borrowed ? { borrowed } : {}) }
        const at = chords.findIndex((c) => c.id === selectedId)
        const next = [...chords]
        next.splice(at === -1 ? chords.length : at + 1, 0, chord)
        set({ chords: next, selectedId: chord.id, selectedVocal: null, chordsTrackSelected: false, drumsTrackSelected: false })
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
        set({ chords: next, selectedId: copy.id, selectedVocal: null, chordsTrackSelected: false, drumsTrackSelected: false })
      },
      clearChords: () => set({ chords: [], selectedId: null, loop: null, chordsTrackSelected: false, drumsTrackSelected: false }),
      loadProgression: (degrees, seventh) =>
        set({
          chords: degrees.map((degree) => ({ id: newId(), degree, beats: get().timeSig[0], seventh })),
          selectedId: null,
          selectedVocal: null,
          loop: null,
          playhead: 0,
        }),
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
      select: (selectedId) => set({ selectedId, selectedVocal: null, chordsTrackSelected: false, drumsTrackSelected: false }),
      selectVocal: (lane) =>
        set(lane === null ? { selectedVocal: null } : { selectedVocal: lane, armedLane: lane, selectedId: null, chordsTrackSelected: false, drumsTrackSelected: false }),
      selectChordsTrack: () => set({ chordsTrackSelected: true, drumsTrackSelected: false, selectedId: null, selectedVocal: null }),
      selectDrumsTrack: () => set({ drumsTrackSelected: true, chordsTrackSelected: false, selectedId: null, selectedVocal: null }),
      selectRelative: (dir) => {
        const { chords, selectedId } = get()
        if (!chords.length) return
        const i = chords.findIndex((c) => c.id === selectedId)
        const j = i === -1 ? (dir === 1 ? 0 : chords.length - 1) : Math.min(chords.length - 1, Math.max(0, i + dir))
        set({ selectedId: chords[j].id, selectedVocal: null, chordsTrackSelected: false, drumsTrackSelected: false })
      },

      openSection: (id) => {
        const s = get()
        if (s.recording !== 'off') return
        const target = s.sections.find((sec) => sec.id === id)
        if (!target) return
        const opened = { view: 'section' as const, selectedId: null, selectedVocal: null, chordsTrackSelected: false, drumsTrackSelected: false, playhead: 0 }
        if (id === s.activeSection) return set(opened)
        // Put the open section's parts back in its place, and bring out the other's.
        set({ ...opened, sections: sectionsNow(s), activeSection: id, ...partsOf(target), armedLane: 0 })
      },
      setView: (view) => {
        if (get().recording !== 'off' || view === get().view) return
        set({ view, playhead: 0, selectedId: null, selectedVocal: null, chordsTrackSelected: false, drumsTrackSelected: false })
      },
      addSection: (name) => {
        const s = get()
        if (s.recording !== 'off') return
        const all = sectionsNow(s)
        const section: Section = { ...emptyParts(), id: newId(), name: uniqueName(all, name) }
        set({ sections: [...all, section], arrangement: [...s.arrangement, { id: newId(), section: section.id }] })
        get().openSection(section.id)
      },
      renameSection: (id, name) => {
        const trimmed = name.trim()
        if (!trimmed) return
        set({ sections: get().sections.map((sec) => (sec.id === id ? { ...sec, name: trimmed } : sec)) })
      },
      duplicateSection: (id) => {
        const all = sectionsNow(get())
        const i = all.findIndex((sec) => sec.id === id)
        if (i === -1) return null
        const { name, chords, loop, drums, sectionKey } = all[i]
        // The copy plays the same chords; its vocal tracks start empty, ready for different words.
        const copy: Section = {
          ...emptyParts(),
          id: newId(),
          name: uniqueName(all, name.replace(/\s+\d+$/, '')),
          chords: chords.map((c) => ({ ...c, id: newId() })),
          loop,
          drums,
          sectionKey,
        }
        set({ sections: [...all.slice(0, i + 1), copy, ...all.slice(i + 1)] })
        return copy.id
      },
      deleteSection: (id) => {
        const s = get()
        const all = sectionsNow(s)
        const i = all.findIndex((sec) => sec.id === id)
        if (s.recording !== 'off' || i === -1 || all.length < 2) return
        const sections = all.filter((sec) => sec.id !== id)
        const arrangement = s.arrangement.filter((entry) => entry.section !== id)
        if (id !== s.activeSection) return set({ sections, arrangement })
        const next = sections[Math.min(i, sections.length - 1)]
        set({
          sections,
          arrangement,
          activeSection: next.id,
          ...partsOf(next),
          selectedId: null,
          selectedVocal: null,
          chordsTrackSelected: false, drumsTrackSelected: false,
          armedLane: 0,
          playhead: 0,
        })
      },
      addToSong: (sectionId) => set({ arrangement: [...get().arrangement, { id: newId(), section: sectionId }] }),
      removeFromSong: (entryId) => set({ arrangement: get().arrangement.filter((entry) => entry.id !== entryId) }),
      moveInSong: (entryId, toIndex) => {
        const arrangement = get().arrangement
        const entry = arrangement.find((e) => e.id === entryId)
        if (!entry) return
        const next = arrangement.filter((e) => e.id !== entryId)
        next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, entry)
        if (next.some((e, i) => e !== arrangement[i])) set({ arrangement: next })
      },
      makeUnique: (entryId) => {
        const entry = get().arrangement.find((e) => e.id === entryId)
        if (!entry) return
        const copy = get().duplicateSection(entry.section)
        if (copy) set({ arrangement: get().arrangement.map((e) => (e.id === entryId ? { ...e, section: copy } : e)) })
      },
      setSectionTakes: (sectionId, loaded) => {
        // Stored with however many lanes there were then; filled out to every lane.
        const takes = Array.from({ length: LANES }, (_, lane) => loaded[lane] ?? null)
        const count = takes.reduce((n, t, lane) => (t ? lane + 1 : n), 0)
        const s = get()
        if (sectionId === s.activeSection) return set({ takes, vocalTracks: Math.max(s.vocalTracks, count) })
        set({
          sections: s.sections.map((sec) => (sec.id === sectionId ? { ...sec, takes, vocalTracks: Math.max(sec.vocalTracks, count) } : sec)),
        })
      },
    }),
    {
      // Named before the app was called Bounce; kept, so saved work still loads.
      name: 'sketchpad-song',
      // Fill in settings saved before they existed, and give songs saved before sections one section.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SongData> & LegacySong
        if (!p.sections && !p.chords) return current
        return { ...current, ...p, ...songState(p), sound: { ...DEFAULT_SOUND, ...p.sound }, arp: { ...DEFAULT_ARP, ...p.arp }, rhythm: { ...DEFAULT_RHYTHM, ...p.rhythm } }
      },
      partialize: (s) => ({ ...songOf(s), view: s.view, zoom: s.zoom, sketchId: s.sketchId, savedSignature: s.savedSignature }),
    },
  ),
)
