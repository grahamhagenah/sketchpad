import * as Tone from 'tone'
import { useStore, loopRange, type Chord, type LoopRegion, type TimeSig } from '../store'
import { bassNote, chordInfo, voiceChord, voiceProgression, type Mode } from '../music/theory'
import { createInstruments, midiToHz } from './instruments'

export interface Song {
  key: number
  mode: Mode
  bpm: number
  timeSig: TimeSig
  chords: Chord[]
  loop: LoopRegion | null
  metronome: boolean
  loopOn: boolean
}

interface ChordEvent {
  time: string
  durTicks: number
  notes: number[]
  bass: number
}

interface ClickEvent {
  time: string
  accent: boolean
}

class Engine {
  private ready = false
  private pad!: Tone.PolySynth
  private bass!: Tone.MonoSynth
  private click!: Tone.Synth
  private chordPart: Tone.Part<ChordEvent> | null = null
  private clickPart: Tone.Part<ClickEvent> | null = null
  private ticksPerBeat = 192
  private loopStartTicks = 0
  private endEvent: number | null = null
  /** Called when a play-through without looping reaches the end. */
  onEnd: (() => void) | null = null

  private setup() {
    if (this.ready) return
    const { pad, bass } = createInstruments()
    this.pad = pad
    this.bass = bass
    this.click = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
    }).toDestination()
    this.click.volume.value = -12
    this.ready = true
  }

  /** Rebuilds the loop from the song. Safe to call while playing. */
  sync(song: Song) {
    if (!this.ready) return
    const t = Tone.getTransport()
    const [num, den] = song.timeSig
    t.bpm.value = song.bpm
    t.timeSignature = song.timeSig
    this.ticksPerBeat = (t.PPQ * 4) / den

    const voiced = voiceProgression(song.key, song.mode, song.chords)
    let beat = 0
    const spans = song.chords.map((c) => {
      const span = { start: beat, end: beat + c.beats }
      beat += c.beats
      return span
    })
    const totalBeats = Math.max(beat, num)
    // With looping off, the whole progression plays once.
    const region = song.loopOn ? loopRange(song.loop, totalBeats) : { start: 0, end: totalBeats }

    // Only what sits inside the loop is scheduled; a chord that crosses the
    // loop's edge is cut to it, so it still sounds when the loop comes round.
    const events: ChordEvent[] = []
    spans.forEach((span, i) => {
      const start = Math.max(span.start, region.start)
      const end = Math.min(span.end, region.end)
      if (end <= start) return
      events.push({
        time: `${Math.round(start * this.ticksPerBeat)}i`,
        durTicks: Math.round((end - start) * this.ticksPerBeat),
        ...voiced[i],
      })
    })

    this.chordPart?.dispose()
    this.chordPart = new Tone.Part<ChordEvent>((time, ev) => {
      const dur = Tone.Ticks(ev.durTicks).toSeconds() * 0.97
      this.pad.triggerAttackRelease(ev.notes.map(midiToHz), dur, time, 0.8)
      this.bass.triggerAttackRelease(midiToHz(ev.bass), dur, time, 0.9)
    }, events).start(0)

    this.clickPart?.dispose()
    this.clickPart = null
    if (song.metronome) {
      const clicks: ClickEvent[] = []
      for (let b = region.start; b < region.end; b++) {
        clicks.push({ time: `${Math.round(b * this.ticksPerBeat)}i`, accent: b % num === 0 })
      }
      this.clickPart = new Tone.Part<ClickEvent>((time, ev) => {
        this.click.triggerAttackRelease(ev.accent ? 'C6' : 'G5', 0.03, time, ev.accent ? 1 : 0.6)
      }, clicks).start(0)
    }

    this.loopStartTicks = Math.round(region.start * this.ticksPerBeat)
    const loopEndTicks = Math.round(region.end * this.ticksPerBeat)
    t.loop = song.loopOn
    t.loopStart = `${this.loopStartTicks}i`
    t.loopEnd = `${loopEndTicks}i`
    if (this.endEvent !== null) t.clear(this.endEvent)
    this.endEvent = song.loopOn
      ? null
      : t.scheduleOnce((time) => {
          Tone.getDraw().schedule(() => this.onEnd?.(), time)
        }, `${loopEndTicks}i`)
    if (t.ticks < this.loopStartTicks || t.ticks >= loopEndTicks) t.ticks = this.loopStartTicks
  }

  async play(song: Song) {
    await Tone.start()
    this.setup()
    this.sync(song)
    const t = Tone.getTransport()
    t.stop()
    t.start('+0.05', `${this.loopStartTicks}i`)
  }

  stop() {
    if (!this.ready) return
    Tone.getTransport().stop()
    this.pad.releaseAll()
    this.bass.triggerRelease()
  }

  /** Current loop position in beats, or null when stopped. */
  position(): number | null {
    const t = Tone.getTransport()
    if (t.state !== 'started') return null
    return t.ticks / this.ticksPerBeat
  }

  async audition(song: Song, chord: Chord) {
    await Tone.start()
    this.setup()
    const info = chordInfo(song.key, song.mode, chord.degree, chord.seventh)
    const now = Tone.now()
    this.pad.triggerAttackRelease(voiceChord(info.pcs, null).map(midiToHz), 0.9, now, 0.8)
    this.bass.triggerAttackRelease(midiToHz(bassNote(info.rootPc)), 0.9, now, 0.9)
  }
}

export const engine = new Engine()

// Keep the loop in step with edits made while it plays.
useStore.subscribe((s, prev) => {
  if (!s.playing) return
  if (
    s.key !== prev.key ||
    s.mode !== prev.mode ||
    s.bpm !== prev.bpm ||
    s.timeSig !== prev.timeSig ||
    s.chords !== prev.chords ||
    s.loop !== prev.loop ||
    s.metronome !== prev.metronome ||
    s.loopOn !== prev.loopOn
  ) {
    engine.sync(s)
  }
})

engine.onEnd = () => {
  engine.stop()
  useStore.getState().setPlaying(false)
}

export async function togglePlay() {
  const s = useStore.getState()
  if (s.playing) {
    engine.stop()
    s.setPlaying(false)
  } else {
    await engine.play(s)
    s.setPlaying(true)
  }
}

export function audition(chord: Chord) {
  const s = useStore.getState()
  if (!s.playing) void engine.audition(s, chord)
}
