import { audibleTracks, sectionsNow, totalBeats, useStore, type Chord, type LoopRegion } from './store'
import { grooveHits, type DrumHit } from './audio/drums'

type State = ReturnType<typeof useStore.getState>

/** A chord as played; a silent one keeps its place and voicing but isn't heard. */
export interface PlayChord extends Chord {
  silent?: boolean
}

/** A take placed where it plays. */
export interface VocalPlacement {
  /** The take's id, which names its audio. */
  id: string
  startBeat: number
  seconds: number
  /** Where it has to stop, in beats: the end of its section, in the song. */
  endBeat: number
  /** Its lane in the open section, so recording into that lane can leave it out. */
  lane: number | null
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
  chords: PlayChord[]
  loop: LoopRegion | null
  vocals: VocalPlacement[]
  /** The drums, bar after bar under each section's chords. */
  drums: DrumHit[]
}

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

/**
 * What plays: in the section view, the open section with its loop; in the
 * song view, each section in turn, with the vocals and the mute and solo of
 * that section, and the chords leading smoothly from one section to the next.
 */
export function playbackOf(s: State, view = s.view): Playback {
  const base = {
    key: s.key,
    mode: s.mode,
    bpm: s.bpm,
    timeSig: s.timeSig,
    metronome: s.metronome,
    loopOn: s.loopOn,
    sound: s.sound,
    arp: s.arp,
  }
  if (view === 'section') {
    const audible = audibleTracks(s)
    return {
      ...base,
      chords: audible.chords ? s.chords : s.chords.map((c) => ({ ...c, silent: true })),
      loop: s.loop,
      drums: audible.drums && s.drumTrack ? grooveHits(s.drums, s.timeSig, 0, totalBeats(s.chords)) : [],
      vocals: s.takes.flatMap((t, lane) =>
        t && audible.vocals[lane] ? [{ id: t.id, startBeat: t.startBeat, seconds: t.seconds, endBeat: Infinity, lane }] : [],
      ),
    }
  }
  const sections = new Map(sectionsNow(s).map((sec) => [sec.id, sec]))
  const chords: PlayChord[] = []
  const vocals: VocalPlacement[] = []
  const drums: DrumHit[] = []
  for (const { entry, start, beats } of songSpans(s)) {
    const section = sections.get(entry.section)
    if (!section) continue
    const audible = audibleTracks({ ...section, chordsMuted: s.chordsMuted, chordsSolo: s.chordsSolo, drumsMuted: s.drumsMuted, drumsSolo: s.drumsSolo })
    // Each place gets its own chord ids, so a section that repeats stays distinct.
    chords.push(...section.chords.map((c) => ({ ...c, id: `${entry.id}:${c.id}`, silent: !audible.chords })))
    if (audible.drums && s.drumTrack) drums.push(...grooveHits(section.drums, s.timeSig, start, beats))
    section.takes.forEach((t, lane) => {
      if (t && audible.vocals[lane]) vocals.push({ id: t.id, startBeat: start + t.startBeat, seconds: t.seconds, endBeat: start + beats, lane: null })
    })
  }
  return { ...base, chords, loop: null, vocals, drums }
}

/** Each section's takes by lane, as ids, for storing. */
export function takeIdsBySection(s: State): Record<string, (string | null)[]> {
  return Object.fromEntries(sectionsNow(s).map((sec) => [sec.id, sec.takes.map((t) => t?.id ?? null)]))
}
