import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import type { ChordSpec, Mode } from './music/theory'
import { DEFAULT_SOUND, newSketchSound, type Sound } from './audio/sound'
import { DEFAULT_ARP, DEFAULT_RHYTHM, type Arp, type Rhythm } from './audio/arrange'
import { LANES, type TakeInfo, type Trim } from './audio/take'
import type { DrumIntensity, FillId, GrooveId } from './audio/drums'
import { DEFAULT_CHORDS_COLOR, randomColor, vocalColorId, type ColorId } from './colors'
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
  /** The take each lane plays, or null; the audio lives in IndexedDB, not here. */
  takes: (TakeInfo | null)[]
  /** Every take each lane has, the one it plays among them, in the order they were recorded. */
  allTakes: TakeInfo[][]
  /** How takes are trimmed, by take id; a take without one plays whole. */
  trims: Record<string, Trim>
  vocalMuted: boolean[]
  vocalSolo: boolean[]
  /** Names given to the vocal tracks; null keeps the usual one. */
  vocalNames: (string | null)[]
  /** Each vocal track's level, in dB from its usual one. */
  vocalVolume: number[]
  /** How much reverb each vocal track has, from none (0) to plenty (1). */
  vocalReverb: number[]
  /** Colours given to the vocal tracks; null keeps the one its lane takes by default. */
  vocalColors: (ColorId | null)[]
  /** How many vocal tracks show, empty ones included. */
  vocalTracks: number
  /** The drum groove the section plays, or none. */
  drums: GrooveId | null
  /** Where the section's drums play a fill. */
  drumFill: FillId
  /** How busy the section's drums are. */
  drumIntensity: DrumIntensity
  /** The section's own key, for a key change; null plays it in the song's key. */
  sectionKey: SectionKey | null
  /** The colour of the section's chords, or null for their usual one. */
  chordsColor: ColorId | null
  /** The section's words, a line to each line; every place it plays sings them. */
  lyrics: string
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
  /** The drums' colour, or null for its usual one; each section has its own for its chords. */
  drumsColor: ColorId | null
  /** The sketch's name; empty until you give it one. */
  title: string
  /** Which saved sketch this is, once it's been saved. */
  sketchId: string | null
  /** The sketch as last saved (see sketchSignature), to tell whether it has changed since. */
  savedSignature: string | null
  /**
   * A ready-made song as it was when opened, never saved: while it's still
   * just that, it isn't unsaved work (nothing to keep, nothing to warn about).
   */
  startSignature: string | null
  /** When the saved copy shown was saved (its `updated`), to tell when it has changed on another device since. */
  savedAt: number | null
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
  /** While recording round the loop, which pass (and so which take) it's on, from 1; null otherwise. */
  recordPass: number | null
  /** How late recordings arrive on this device, in seconds, once measured; kept with the device, not the song. */
  latency: number | null
  playing: boolean
  /** Chords copied with ⌘C (or cut with ⌘X), to paste with ⌘V into any section. */
  clipboard: Chord[]
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
  /** Puts a take in a lane as its only one, or empties it. */
  setTake: (lane: number, take: TakeInfo | null) => void
  /** Adds a new take to a lane, keeping its others, and plays it. */
  addTake: (lane: number, take: TakeInfo) => void
  /** Plays another of a lane's takes. */
  chooseTake: (lane: number, id: string) => void
  /** Takes a take out of a lane; if it was the one playing, the latest left plays instead. */
  dropTake: (lane: number, id: string) => void
  /** Trims a take in the open section, or with null, plays it whole again. */
  setTrim: (id: string, trim: Trim | null) => void
  /** Moves the vocals in lanes `from` into lanes 0, 1, 2…, with their mute and solo. */
  renumberVocals: (from: number[]) => void
  /** Adds an empty vocal track and selects it, ready to record into. */
  addVocalTrack: () => void
  /** Makes sure at least `count` vocal tracks show. */
  showVocalTracks: (count: number) => void
  setTitle: (title: string) => void
  setSaved: (sketchId: string | null, signature: string | null, savedAt?: number | null) => void
  renameChords: (name: string) => void
  renameVocal: (lane: number, name: string) => void
  toggleVocalMute: (lane: number) => void
  toggleVocalSolo: (lane: number) => void
  toggleChordsMute: () => void
  toggleChordsSolo: () => void
  setDrums: (groove: GrooveId | null) => void
  setDrumFill: (fill: FillId) => void
  setDrumIntensity: (intensity: DrumIntensity) => void
  /** A section's words, open or not. */
  setLyrics: (sectionId: string, lyrics: string) => void
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
  setVocalReverb: (lane: number, amount: number) => void
  setChordsColor: (color: ColorId) => void
  setDrumsColor: (color: ColorId) => void
  setVocalColor: (lane: number, color: ColorId) => void
  /** Unmutes every track and clears every solo, so everything plays. */
  unmuteAll: () => void
  setArmedLane: (lane: number) => void
  setRecording: (recording: State['recording']) => void
  setCountIn: (countIn: number | null) => void
  setRecordPass: (pass: number | null) => void
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
  /** Copies chords to the clipboard. */
  copyChords: (chords: Chord[]) => void
  /** Puts the clipboard's chords after the selected chord (or at the end), and selects the last of them. */
  pasteChords: () => void
  /** Replaces the progression with these scale degrees, a bar each. */
  loadProgression: (degrees: number[], seventh: boolean) => void
  /** Starts the open section with a copy of another section's chords. */
  copyChordsFrom: (sectionId: string) => void
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
  /** Moves a section's tab to another place among them; the song plays as it did. */
  moveSection: (sectionId: string, toIndex: number) => void
  /** Plays a place in the song again, straight after itself. */
  repeatInSong: (entryId: string) => void
  /** Gives one place in the song its own copy of its section, to change without changing the others. */
  makeUnique: (entryId: string) => void
  /** Puts loaded takes in a section, showing enough tracks for them. */
  setSectionTakes: (sectionId: string, lanes: { take: TakeInfo | null; all: TakeInfo[] }[]) => void
}

export const chordsTrackName = (s: Pick<State, 'chordsName'>) => s.chordsName ?? 'Chords'
/** The key a section plays in: its own, or the song's. */
export const keyOf = (s: Pick<State, 'key' | 'mode'> & Pick<SectionParts, 'sectionKey'>): SectionKey => s.sectionKey ?? { key: s.key, mode: s.mode }
export const drumsTrackName = (s: Pick<State, 'drumsName'>) => s.drumsName ?? 'Drums'
export const vocalTrackName = (s: Pick<State, 'vocalNames'>, lane: number) => s.vocalNames[lane] ?? `Vocal ${lane + 1}`

// Every one of SectionParts' fields, listed so a new one can't be left out.
const PART_FIELDS: Record<keyof SectionParts, true> = {
  chords: true,
  loop: true,
  takes: true,
  allTakes: true,
  trims: true,
  vocalMuted: true,
  vocalSolo: true,
  vocalNames: true,
  vocalVolume: true,
  vocalReverb: true,
  vocalColors: true,
  vocalTracks: true,
  drums: true,
  drumFill: true,
  drumIntensity: true,
  sectionKey: true,
  chordsColor: true,
  lyrics: true,
}
export const PART_KEYS = Object.keys(PART_FIELDS) as (keyof SectionParts)[]

const partsOf = (p: SectionParts) => Object.fromEntries(PART_KEYS.map((k) => [k, p[k]])) as unknown as SectionParts

export const emptyParts = (): SectionParts => ({
  chords: [],
  loop: null,
  takes: Array(LANES).fill(null),
  allTakes: Array.from({ length: LANES }, () => []),
  trims: {},
  vocalMuted: Array(LANES).fill(false),
  vocalSolo: Array(LANES).fill(false),
  vocalNames: Array(LANES).fill(null),
  vocalVolume: Array(LANES).fill(0),
  vocalReverb: Array(LANES).fill(0),
  vocalColors: Array(LANES).fill(null),
  vocalTracks: 0,
  drums: null,
  drumFill: 'none',
  drumIntensity: 'normal',
  sectionKey: null,
  chordsColor: null,
  lyrics: '',
})

/** Every section as it is now, the open one's parts taken from the editor. */
export function sectionsNow(s: Pick<State, 'sections' | 'activeSection' | keyof SectionParts>): Section[] {
  return s.sections.map((sec) => (sec.id === s.activeSection ? { ...sec, ...partsOf(s) } : sec))
}

/** `name`, or with the lowest number after it that no section has yet ("Verse 2"). */
function uniqueName(sections: { name: string }[], name: string) {
  const taken = new Set(sections.map((s) => s.name))
  if (!taken.has(name)) return name
  let n = 2
  while (taken.has(`${name} ${n}`)) n++
  return `${name} ${n}`
}

/** The song-wide settings a saved sketch keeps. */
const SONG_FIELDS = [
  'key', 'mode', 'bpm', 'timeSig', 'metronome', 'loopOn', 'sound', 'arp', 'rhythm',
  'chordsMuted', 'chordsSolo', 'drumTrack', 'drumsMuted', 'drumsSolo', 'chordsVolume', 'drumsVolume',
  'drumsColor', 'title', 'chordsName', 'drumsName',
] as const satisfies readonly (keyof State)[]

/** Everything a saved sketch keeps, apart from its takes, which are stored with their audio. */
export function songOf(s: State) {
  return {
    ...(Object.fromEntries(SONG_FIELDS.map((k) => [k, s[k]])) as Pick<State, (typeof SONG_FIELDS)[number]>),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    sections: sectionsNow(s).map(({ takes, allTakes, ...section }) => section),
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
    vocalReverb: Array.from({ length: LANES }, (_, i) => p.vocalReverb?.[i] ?? 0),
    vocalColors: Array.from({ length: LANES }, (_, i) => p.vocalColors?.[i] ?? null),
  }
}

/** A song as saved, by songOf or, before songs had sections, as one progression. */
export type SavedSong = Partial<Omit<SongData, 'sections'>> & LegacySong & { sections?: Partial<Section>[] }

/**
 * The state for a saved song, with its first (or last open) section open.
 * Songs saved before sections become a song of one section, called Verse.
 * Takes come empty; they're loaded with their audio.
 */
export function songState(p: SavedSong) {
  const sections: Section[] = p.sections?.length
    ? p.sections.map((sec) => ({ ...emptyParts(), id: newId(), name: 'Section', ...sec, ...lanesOf(sec), chordsColor: sec.chordsColor ?? p.chordsColor ?? null, takes: Array(LANES).fill(null), allTakes: emptyParts().allTakes }))
    : [{ ...emptyParts(), ...lanesOf(p), id: newId(), name: 'Verse', chords: p.chords ?? [], loop: p.loop ?? null, vocalTracks: p.vocalTracks ?? 0, drums: p.drums ?? null, chordsColor: p.chordsColor ?? null }]
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
/** Everything the signature is made from; while none of it changes, neither does the signature. */
const SIGNED_FIELDS = [...SONG_FIELDS, ...PART_KEYS, 'sections', 'arrangement', 'activeSection'] as const
let lastSignature: { from: State; signature: string } | null = null

export function sketchSignature(s: State) {
  const last = lastSignature
  if (last && SIGNED_FIELDS.every((k) => last.from[k] === s[k])) return last.signature
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { activeSection, ...song } = songOf(s)
  const signature = JSON.stringify([song, sectionsNow(s).map((sec) => sec.takes.map((t, lane) => [t?.id ?? null, ...(sec.allTakes[lane] ?? []).map((a) => a.id)]))])
  lastSignature = { from: s, signature }
  return signature
}

/** How long each section is, in beats. */
const sectionBeats = (sections: Pick<Section, 'id' | 'chords'>[]) => new Map(sections.map((sec) => [sec.id, totalBeats(sec.chords)]))

/** A chord to start a ready-made song with: plain, unless `more` says otherwise. */
export const newChord = (degree: number, beats: number, more: Partial<ChordSpec> = {}): Chord => ({ id: newId(), degree, beats, seventh: false, ...more })

/** A section of a ready-made song. */
export interface SectionStart {
  name: string
  chords: Chord[]
  drums: GrooveId | null
  drumFill?: FillId
  drumIntensity?: DrumIntensity
  sectionKey?: SectionKey
}

/** How a ready-made song sounds. */
export type SongSettings = Pick<State, 'key' | 'mode' | 'bpm' | 'timeSig' | 'sound' | 'arp' | 'rhythm' | 'chordsVolume' | 'drumsVolume'> & Partial<Pick<State, 'drumTrack'>>
export type SongStart = SongSettings & ReturnType<typeof songState> & Pick<State, 'view' | 'drumTrack' | 'loopOn'>

/** A ready-made song: its sections played in `order` (by their index), opening on the song view with the first one open. */
export function songStart(settings: SongSettings, sections: SectionStart[], order: number[]): SongStart {
  const made = sections.map((sec) => ({ drumFill: 'none' as FillId, sectionKey: null, ...sec, id: newId() }))
  return {
    view: 'song',
    drumTrack: true,
    loopOn: true,
    ...settings,
    ...songState({ sections: made, arrangement: order.map((i) => ({ id: newId(), section: made[i].id })), activeSection: made[0].id }),
  }
}

/**
 * An empty song: one section, called Verse, on a standard sound (the
 * electric piano, its bass held to the kick, no arpeggiator). What a first
 * visit opens on, where the song view offers it or a ready-made song.
 */
export function blankSong() {
  return {
    ...songState({}),
    sound: newSketchSound(),
    arp: DEFAULT_ARP,
    rhythm: DEFAULT_RHYTHM,
    title: '',
    chordsName: null,
    chordsMuted: false,
    chordsSolo: false,
    drumsName: null,
    drumTrack: false,
    drumsMuted: false,
    drumsSolo: false,
    chordsVolume: 0,
    drumsVolume: 0,
    drumsColor: null,
  }
}

/**
 * The demo song, first of the ready-made songs: a quick minor song in G,
 * a verse into a chorus and back, then the chorus again lifted a half step.
 * A down-arpeggiated saw over half-time drums, so what Bounce does is heard
 * straight away.
 */
export function demoSong() {
  const chord = newChord
  // The hook, C B♭ E♭ · C F E♭: the major IV borrowed from G major, against the minor key's ♭III and ♭VI.
  const hook = (end: Chord[]) => [chord(3, 2, { borrowed: true }), chord(2, 2), chord(5, 4), chord(3, 2, { borrowed: true }), ...end]
  // Gm7 E♭maj7 C B♭, then down to the minor iv and v and up to F, back round to Gm.
  const chorus = () => [chord(0, 4, { seventh: true }), chord(5, 4, { seventh: true }), chord(3, 4, { borrowed: true }), chord(2, 4), chord(0, 4, { seventh: true }), chord(5, 4, { seventh: true }), chord(3, 2), chord(4, 2), chord(6, 4)]
  return songStart(
    {
      key: 7,
      mode: 'minor',
      bpm: 132,
      timeSig: [4, 4],
      sound: { ...DEFAULT_SOUND, instrument: 'synth', preset: 'Synth', wave: 'sawtooth', attack: 0.045, decay: 0.16, sustain: 0.02, release: 0.03, brightness: 6856, reverb: 0.28, bass: true },
      arp: { on: true, pattern: 'down', rate: '1/16', octaves: 3, gate: 0.7, swing: 0, accent: 0.37 },
      rhythm: { ...DEFAULT_RHYTHM, chords: 'held', bass: 'kick' },
      chordsVolume: -3.5,
      drumsVolume: 6,
    },
    [
      { name: 'Verse', chords: [...hook([chord(6, 2), chord(5, 4)]), ...hook([chord(5, 2), chord(6, 4)])], drums: 'halftime', drumFill: 'end' },
      { name: 'Chorus', chords: chorus(), drums: 'backbeat', drumFill: 'four' },
      { name: 'Last chorus', chords: chorus(), drums: 'backbeat', drumFill: 'end', drumIntensity: 'busy', sectionKey: { key: 8, mode: 'minor' } },
    ],
    [0, 1, 0, 1, 2],
  )
}

/**
 * Which tracks sound: with any track soloed, only soloed tracks play; mute
 * always silences a track, soloed or not. Vocal lanes without a take never play.
 */
/** What audibleTracks reads, for a component to watch. */
/** The vocal track a recording goes into: the selected one. With none selected (or none made yet) there's nothing to record into. */
export function recordLane(s: Pick<State, 'selectedVocal' | 'vocalTracks'>): number | null {
  return s.selectedVocal !== null && s.selectedVocal < s.vocalTracks ? s.selectedVocal : null
}

/** How much reverb a new vocal track starts with (0 to 1). */
export const DEFAULT_VOCAL_REVERB = 0.25

export const AUDIBLE_FIELDS = ['chordsMuted', 'chordsSolo', 'drumsMuted', 'drumsSolo', 'vocalMuted', 'vocalSolo', 'takes'] as const

export function audibleTracks(s: Pick<State, (typeof AUDIBLE_FIELDS)[number]>) {
  const anySolo = s.chordsSolo || s.drumsSolo || s.vocalSolo.some((solo, lane) => solo && s.takes[lane])
  return {
    chords: !s.chordsMuted && (!anySolo || s.chordsSolo),
    drums: !s.drumsMuted && (!anySolo || s.drumsSolo),
    vocals: s.takes.map((take, lane) => !!take && !s.vocalMuted[lane] && (!anySolo || s.vocalSolo[lane])),
  }
}

/**
 * localStorage, written a moment after the last change rather than on every
 * one (a slider drag makes dozens), and straight away when the page is hidden.
 */
function lazyStorage<T>(wait = 400): PersistStorage<T> {
  let pending: { name: string; value: StorageValue<T> } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    clearTimeout(timer)
    if (!pending) return
    const { name, value } = pending
    pending = null
    try {
      localStorage.setItem(name, JSON.stringify(value))
    } catch (error) {
      console.error(error)
    }
  }
  if (typeof document !== 'undefined') {
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
  }
  return {
    getItem: (name) => {
      const raw = localStorage.getItem(name)
      return raw === null ? null : JSON.parse(raw)
    },
    setItem: (name, value) => {
      pending = { name, value }
      clearTimeout(timer)
      timer = setTimeout(flush, wait)
    },
    removeItem: (name) => {
      pending = null
      clearTimeout(timer)
      localStorage.removeItem(name)
    },
  }
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      // The demo's key, tempo and meter, on an empty song: a first visit
      // chooses to start its own or open a ready-made one.
      ...demoSong(),
      ...blankSong(),
      view: 'song',
      selectedId: null,
      metronome: false,
      chordsMuted: false,
      chordsSolo: false,
      drumsMuted: false,
      drumsSolo: false,
      drumsColor: null,
      title: '',
      sketchId: null,
      savedSignature: null,
      startSignature: null,
      savedAt: null,
      chordsName: null,
      drumsName: null,
      armedLane: 0,
      selectedVocal: null,
      chordsTrackSelected: false, drumsTrackSelected: false,
      recording: 'off',
      countIn: null,
      recordPass: null,
      latency: null,
      playing: false,
      clipboard: [],
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
      setTake: (lane, take) =>
        set({ takes: get().takes.map((t, i) => (i === lane ? take : t)), allTakes: get().allTakes.map((all, i) => (i === lane ? (take ? [take] : []) : all)) }),
      addTake: (lane, take) => {
        const { takes, allTakes } = get()
        // A lane loaded with only its playing take counts that as its first.
        const before = allTakes[lane]?.length ? allTakes[lane] : takes[lane] ? [takes[lane]] : []
        set({ takes: takes.map((t, i) => (i === lane ? take : t)), allTakes: allTakes.map((all, i) => (i === lane ? [...before, take] : all)) })
      },
      chooseTake: (lane, id) => {
        const take = get().allTakes[lane]?.find((t) => t.id === id)
        if (take) set({ takes: get().takes.map((t, i) => (i === lane ? take : t)) })
      },
      dropTake: (lane, id) => {
        const { takes, allTakes } = get()
        const left = (allTakes[lane] ?? []).filter((t) => t.id !== id)
        const playing = takes[lane]?.id === id ? (left[left.length - 1] ?? null) : takes[lane]
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [id]: _, ...trims } = get().trims
        set({ takes: takes.map((t, i) => (i === lane ? playing : t)), allTakes: allTakes.map((all, i) => (i === lane ? left : all)), trims })
      },
      setTrim: (id, trim) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [id]: _, ...rest } = get().trims
        set({ trims: trim ? { ...rest, [id]: trim } : rest })
      },
      renumberVocals: (from) => {
        const { takes, allTakes, vocalMuted, vocalSolo, vocalNames, vocalVolume, vocalReverb, vocalColors } = get()
        const pick = <T,>(list: T[], empty: T) => list.map((_, lane) => (lane < from.length ? list[from[lane]] : empty))
        // Nothing stays selected; the next recording goes in the first free lane.
        set({
          takes: pick(takes, null),
          allTakes: pick(allTakes, []),
          vocalMuted: pick(vocalMuted, false),
          vocalSolo: pick(vocalSolo, false),
          vocalNames: pick(vocalNames, null),
          vocalVolume: pick(vocalVolume, 0),
          vocalReverb: pick(vocalReverb, 0),
          vocalColors: pick(vocalColors, null),
          vocalTracks: from.length,
          selectedVocal: null,
        })
      },
      addVocalTrack: () => {
        const s = get()
        const lane = s.vocalTracks
        if (lane >= LANES || !s.chords.length) return
        // A colour of its own, picked at random from those the section's other tracks haven't got.
        const color = randomColor([s.chordsColor ?? DEFAULT_CHORDS_COLOR, ...Array.from({ length: lane }, (_, i) => vocalColorId(s.vocalColors, i))])
        const vocalColors = s.vocalColors.map((c, i) => (i === lane ? color : c))
        // Some room on a voice to start with, as a demo's vocal has; turned down to dry, or up, on the track.
        const vocalReverb = s.vocalReverb.map((r, i) => (i === lane ? DEFAULT_VOCAL_REVERB : r))
        set({ vocalTracks: lane + 1, vocalColors, vocalReverb, selectedVocal: lane, armedLane: lane, selectedId: null, chordsTrackSelected: false, drumsTrackSelected: false })
      },
      setTitle: (title) => set({ title }),
      setSaved: (sketchId, savedSignature, savedAt = null) => set({ sketchId, savedSignature, savedAt }),
      renameChords: (name) => set({ chordsName: name.trim() || null }),
      renameVocal: (lane, name) => set({ vocalNames: get().vocalNames.map((n, i) => (i === lane ? name.trim() || null : n)) }),
      showVocalTracks: (count) => {
        const s = get()
        const vocalTracks = Math.max(s.vocalTracks, Math.min(count, LANES))
        set({ vocalTracks })
      },
      toggleVocalMute: (lane) => set({ vocalMuted: get().vocalMuted.map((m, i) => (i === lane ? !m : m)) }),
      toggleVocalSolo: (lane) => set({ vocalSolo: get().vocalSolo.map((m, i) => (i === lane ? !m : m)) }),
      toggleChordsMute: () => set({ chordsMuted: !get().chordsMuted }),
      toggleChordsSolo: () => set({ chordsSolo: !get().chordsSolo }),
      setDrums: (drums) => set({ drums }),
      setDrumFill: (drumFill) => set({ drumFill }),
      setDrumIntensity: (drumIntensity) => set({ drumIntensity }),
      setLyrics: (sectionId, lyrics) => {
        const s = get()
        if (sectionId === s.activeSection) return set({ lyrics })
        set({ sections: s.sections.map((sec) => (sec.id === sectionId ? { ...sec, lyrics } : sec)) })
      },
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
        if (s.chords.length) set({ drumTrack: true, drums: s.drums ?? 'backbeat', drumsColor: randomColor([s.chordsColor ?? DEFAULT_CHORDS_COLOR]) })
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
      setVocalReverb: (lane, amount) => set({ vocalReverb: get().vocalReverb.map((v, i) => (i === lane ? amount : v)) }),
      unmuteAll: () =>
        set({ chordsMuted: false, chordsSolo: false, drumsMuted: false, drumsSolo: false, vocalMuted: Array(LANES).fill(false), vocalSolo: Array(LANES).fill(false) }),
      setArmedLane: (armedLane) => set({ armedLane }),
      setRecording: (recording) => set({ recording, countIn: recording === 'count-in' ? get().countIn : null, recordPass: recording === 'off' ? null : get().recordPass }),
      setCountIn: (countIn) => set({ countIn }),
      setRecordPass: (recordPass) => set({ recordPass }),
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
      copyChords: (chords) => set({ clipboard: chords.map((c) => ({ ...c })) }),
      pasteChords: () => {
        const { chords, clipboard, selectedId } = get()
        if (!clipboard.length) return
        const pasted = clipboard.map((c) => ({ ...c, id: newId() }))
        const at = chords.findIndex((c) => c.id === selectedId)
        const next = [...chords]
        next.splice(at === -1 ? chords.length : at + 1, 0, ...pasted)
        set({ chords: next, selectedId: pasted[pasted.length - 1].id, selectedVocal: null, chordsTrackSelected: false, drumsTrackSelected: false })
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
      copyChordsFrom: (sectionId) => {
        const from = get().sections.find((sec) => sec.id === sectionId && sec.id !== get().activeSection)
        if (!from?.chords.length) return
        set({ chords: from.chords.map((c) => ({ ...c, id: newId() })), selectedId: null, selectedVocal: null, loop: null, playhead: 0 })
      },
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
        // Its chords in a colour picked at random, one the other sections haven't got while there are any left.
        const chordsColor = randomColor(all.map((sec) => sec.chordsColor ?? DEFAULT_CHORDS_COLOR))
        const section: Section = { ...emptyParts(), id: newId(), name: uniqueName(all, name), chordsColor }
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
        const { name, chords, loop, drums, drumFill, drumIntensity, sectionKey, chordsColor, lyrics } = all[i]
        // The copy plays the same chords, and starts from the same words; its vocal tracks start empty.
        const copy: Section = {
          ...emptyParts(),
          id: newId(),
          name: uniqueName(all, name.replace(/\s+\d+$/, '')),
          chords: chords.map((c) => ({ ...c, id: newId() })),
          loop,
          drums,
          drumFill,
          drumIntensity,
          sectionKey,
          chordsColor,
          lyrics,
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
      repeatInSong: (entryId) => {
        const all = get().arrangement
        const i = all.findIndex((e) => e.id === entryId)
        if (i === -1) return
        set({ arrangement: [...all.slice(0, i + 1), { id: newId(), section: all[i].section }, ...all.slice(i + 1)] })
      },
      removeFromSong: (entryId) => set({ arrangement: get().arrangement.filter((entry) => entry.id !== entryId) }),
      moveInSong: (entryId, toIndex) => {
        const arrangement = get().arrangement
        const entry = arrangement.find((e) => e.id === entryId)
        if (!entry) return
        const next = arrangement.filter((e) => e.id !== entryId)
        next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, entry)
        if (next.some((e, i) => e !== arrangement[i])) set({ arrangement: next })
      },
      moveSection: (sectionId, toIndex) => {
        const sections = get().sections
        const from = sections.findIndex((sec) => sec.id === sectionId)
        const to = Math.max(0, Math.min(sections.length - 1, toIndex))
        if (from === -1 || to === from) return
        const next = sections.filter((sec) => sec.id !== sectionId)
        next.splice(to, 0, sections[from])
        set({ sections: next })
      },
      makeUnique: (entryId) => {
        const entry = get().arrangement.find((e) => e.id === entryId)
        if (!entry) return
        const copy = get().duplicateSection(entry.section)
        if (copy) set({ arrangement: get().arrangement.map((e) => (e.id === entryId ? { ...e, section: copy } : e)) })
      },
      setSectionTakes: (sectionId, loaded) => {
        // Stored with however many lanes there were then; filled out to every lane.
        const takes = Array.from({ length: LANES }, (_, lane) => loaded[lane]?.take ?? null)
        const allTakes = Array.from({ length: LANES }, (_, lane) => loaded[lane]?.all ?? [])
        const count = takes.reduce((n, t, lane) => (t ? lane + 1 : n), 0)
        const s = get()
        if (sectionId === s.activeSection) return set({ takes, allTakes, vocalTracks: Math.max(s.vocalTracks, count) })
        set({
          sections: s.sections.map((sec) => (sec.id === sectionId ? { ...sec, takes, allTakes, vocalTracks: Math.max(sec.vocalTracks, count) } : sec)),
        })
      },
    }),
    {
      // Named before the app was called Bounce; kept, so saved work still loads.
      name: 'sketchpad-song',
      storage: lazyStorage(),
      // Fill in settings saved before they existed, and give songs saved before sections one section.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SongData> & LegacySong
        if (!p.sections && !p.chords) return current
        return { ...current, ...p, ...songState(p), sound: { ...DEFAULT_SOUND, ...p.sound }, arp: { ...DEFAULT_ARP, ...p.arp }, rhythm: { ...DEFAULT_RHYTHM, ...p.rhythm } }
      },
      partialize: (s) => ({ ...songOf(s), view: s.view, zoom: s.zoom, sketchId: s.sketchId, savedSignature: s.savedSignature, startSignature: s.startSignature, savedAt: s.savedAt }),
    },
  ),
)

/**
 * Some of the store's fields (actions included, which never change), for a
 * component to re-render only when one of them changes, not on every change.
 */
export function useFields<K extends keyof State>(...keys: K[]): Pick<State, K> {
  return useStore(useShallow((s) => Object.fromEntries(keys.map((k) => [k, s[k]])) as Pick<State, K>))
}
