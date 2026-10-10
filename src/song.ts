import { audibleTracks, keyOf, sectionsNow, totalBeats, useStore, type Chord, type LoopRegion } from './store'
import { grooveHits, type DrumHit } from './audio/drums'
import { trimOf, type LaneIds, type StoredLane, type TakeInfo, type Trim } from './audio/take'

type State = ReturnType<typeof useStore.getState>

/** A chord as played; a silent one keeps its place and voicing but isn't heard. One from a section with its own key carries it. */
export interface PlayChord extends Chord {
  silent?: boolean
  key?: number
  mode?: State['mode']
}

/** A take placed where it plays. */
export interface VocalPlacement {
  /** The take's id, which names its audio. */
  id: string
  /** Where it starts playing, and for how long: its trimmed part, if it's trimmed. */
  startBeat: number
  seconds: number
  /** Seconds of its audio trimmed off the start, skipped when it plays. */
  offset?: number
  /** Where it has to stop, in beats: the end of its section, in the song. */
  endBeat: number
  /** Its lane in the open section, so recording into that lane can leave it out. */
  lane: number | null
  /** Which vocal track it's on, in whichever section, for exporting each track on its own. */
  track: number
  /** Its track's level, in dB. */
  db: number
  /** Its track's reverb, from none (0) to plenty (1). */
  reverb: number
}

/** Everything the engine and exports need to play: the open section, or the whole song. */
export interface Playback {
  key: State['key']
  mode: State['mode']
  bpm: number
  timeSig: State['timeSig']
  metronome: boolean
  loopOn: boolean
  sound: State['sound']
  arp: State['arp']
  rhythm: State['rhythm']
  /** The chords' (and bass's) and drums' levels, in dB. */
  chordsDb: number
  drumsDb: number
  chords: PlayChord[]
  loop: LoopRegion | null
  vocals: VocalPlacement[]
  /** The drums, bar after bar under each section's chords. */
  drums: DrumHit[]
  /** Where the drum track's kick plays, muted or not, for the bass to follow; none without a drum track. */
  kicks?: number[]
}

const kicksOf = (hits: DrumHit[]) => hits.filter((h) => h.piece === 'kick').map((h) => h.beat)

/** Where each place in the song starts and how long it is, in beats. */
export function songSpans(s: Pick<State, 'arrangement' | 'sections' | 'activeSection' | 'chords'>) {
  const lengths = new Map(s.sections.map((sec) => [sec.id, totalBeats(sec.id === s.activeSection ? s.chords : sec.chords)]))
  let at = 0
  return s.arrangement.map((entry) => {
    const beats = lengths.get(entry.section) ?? 0
    const span = { entry, start: at, beats }
    at += beats
    return span
  })
}

/** Where a beat of the song falls in the open section, if it's playing there (in the place it's playing); otherwise null. */
export function sectionBeatOf(s: Pick<State, 'arrangement' | 'sections' | 'activeSection' | 'chords'>, songBeat: number) {
  const span = songSpans(s).find((sp) => sp.beats && songBeat >= sp.start && songBeat < sp.start + sp.beats)
  return span && span.entry.section === s.activeSection ? songBeat - span.start : null
}

/** Where a beat of the open section falls in the song: in the first place it plays, or null if it isn't in the song. */
export function songBeatOf(s: Pick<State, 'arrangement' | 'sections' | 'activeSection' | 'chords'>, sectionBeat: number) {
  const span = songSpans(s).find((sp) => sp.entry.section === s.activeSection)
  return span ? span.start + sectionBeat : null
}

/**
 * Where a take plays, trimmed: its trimmed start moved later by what's cut,
 * for as long as is left, skipping that much of its audio. A whole take is as it was.
 */
export function trimmedPlacement(take: TakeInfo, trim: Trim | undefined, beatSeconds: number) {
  if (!trim) return { startBeat: take.startBeat, seconds: take.seconds }
  const { start, end } = trimOf(take, trim)
  return { startBeat: take.startBeat + start / beatSeconds, seconds: end - start, offset: start }
}

/**
 * What plays: in the section view, the open section with its loop; in the
 * song view, each section in turn, with the vocals and the mute and solo of
 * that section, and the chords leading smoothly from one section to the next.
 */
export function playbackOf(s: State, view = s.view): Playback {
  // A beat's length in seconds, to place trimmed takes.
  const beatSeconds = (60 / s.bpm) * (4 / s.timeSig[1])
  const base = {
    key: s.key,
    mode: s.mode,
    bpm: s.bpm,
    timeSig: s.timeSig,
    metronome: s.metronome,
    loopOn: s.loopOn,
    sound: s.sound,
    arp: s.arp,
    rhythm: s.rhythm,
    chordsDb: s.chordsVolume,
    drumsDb: s.drumsVolume,
  }
  if (view === 'section') {
    const audible = audibleTracks(s)
    return {
      ...base,
      ...keyOf(s),
      chords: audible.chords ? s.chords : s.chords.map((c) => ({ ...c, silent: true })),
      loop: s.loop,
      drums: audible.drums && s.drumTrack ? grooveHits(s.drums, s.timeSig, 0, totalBeats(s.chords), s.drumFill) : [],
      kicks: s.drumTrack ? kicksOf(grooveHits(s.drums, s.timeSig, 0, totalBeats(s.chords), s.drumFill)) : undefined,
      vocals: s.takes.flatMap((t, lane) =>
        t && audible.vocals[lane]
          ? [{ id: t.id, ...trimmedPlacement(t, s.trims[t.id], beatSeconds), endBeat: Infinity, lane, track: lane, db: s.vocalVolume[lane] ?? 0, reverb: s.vocalReverb[lane] ?? 0 }]
          : [],
      ),
    }
  }
  const sections = new Map(sectionsNow(s).map((sec) => [sec.id, sec]))
  const chords: PlayChord[] = []
  const vocals: VocalPlacement[] = []
  const drums: DrumHit[] = []
  const kicks: number[] = []
  for (const { entry, start, beats } of songSpans(s)) {
    const section = sections.get(entry.section)
    if (!section) continue
    const audible = audibleTracks({ ...section, chordsMuted: s.chordsMuted, chordsSolo: s.chordsSolo, drumsMuted: s.drumsMuted, drumsSolo: s.drumsSolo })
    // Each place gets its own chord ids, so a section that repeats stays distinct.
    const own = section.sectionKey ?? {}
    chords.push(...section.chords.map((c) => ({ ...c, ...own, id: `${entry.id}:${c.id}`, silent: !audible.chords })))
    const groove = grooveHits(section.drums, s.timeSig, start, beats, section.drumFill)
    if (audible.drums && s.drumTrack) drums.push(...groove)
    kicks.push(...kicksOf(groove))
    section.takes.forEach((t, lane) => {
      if (!t || !audible.vocals[lane]) return
      const placed = trimmedPlacement(t, section.trims?.[t.id], beatSeconds)
      vocals.push({ id: t.id, ...placed, startBeat: start + placed.startBeat, endBeat: start + beats, lane: null, track: lane, db: section.vocalVolume?.[lane] ?? 0, reverb: section.vocalReverb?.[lane] ?? 0 })
    })
  }
  return { ...base, chords, loop: null, vocals, drums, kicks: s.drumTrack ? kicks : undefined }
}

/** Each section's takes by lane, as ids, for storing: the one it plays, and every one it has once there's more than one. */
export function takeIdsBySection(s: State): LaneIds {
  return Object.fromEntries(
    sectionsNow(s).map((sec) => [
      sec.id,
      sec.takes.map((t, lane): StoredLane => {
        const all = sec.allTakes?.[lane] ?? []
        return t && all.length > 1 ? { take: t.id, all: all.map((a) => a.id) } : (t?.id ?? null)
      }),
    ]),
  )
}
