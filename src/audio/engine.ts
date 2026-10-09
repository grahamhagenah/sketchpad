import * as Tone from 'tone'
import { useStore, loopRange, type Chord, type LoopRegion, type TimeSig } from '../store'
import { bassNote, chordInfo, voiceChord, type Mode } from '../music/theory'
import { arrange, type Arp, type Hit } from './arrange'
import { applySound, createInstruments, midiToHz, type Instruments } from './instruments'
import type { Sound } from './sound'

export interface Song {
  key: number
  mode: Mode
  bpm: number
  timeSig: TimeSig
  chords: Chord[]
  loop: LoopRegion | null
  metronome: boolean
  loopOn: boolean
  sound: Sound
  arp: Arp
}

interface HitEvent extends Hit {
  time: string
}

interface ClickEvent {
  time: string
  accent: boolean
}

class Engine {
  private ready = false
  private instruments!: Instruments
  private pad!: Tone.PolySynth
  private bass!: Tone.MonoSynth
  private click!: Tone.Synth
  private chordPart: Tone.Part<HitEvent> | null = null
  private clickPart: Tone.Part<ClickEvent> | null = null
  private ticksPerBeat = 192
  private loopStartTicks = 0
  private endEvent: number | null = null
  /** Called when a play-through without looping reaches the end. */
  onEnd: (() => void) | null = null

  private setup() {
    if (this.ready) return
    this.instruments = createInstruments(useStore.getState().sound)
    this.pad = this.instruments.pad
    this.bass = this.instruments.bass
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

    const totalBeats = Math.max(
      song.chords.reduce((sum, c) => sum + c.beats, 0),
      num,
    )
    // With looping off, the whole progression plays once.
    const region = song.loopOn ? loopRange(song.loop, totalBeats) : { start: 0, end: totalBeats }

    // Only what sits inside the loop is scheduled; a chord that crosses the
    // loop's edge is cut to it, so it still sounds when the loop comes round.
    const events: HitEvent[] = arrange(song, region).map((h) => ({ ...h, time: `${Math.round(h.start * t.PPQ)}i` }))

    this.chordPart?.dispose()
    this.chordPart = new Tone.Part<HitEvent>((time, ev) => {
      const length = Tone.Ticks(Math.round(ev.dur * t.PPQ)).toSeconds()
      if (ev.pad.length) this.pad.triggerAttackRelease(ev.pad.map(midiToHz), ev.held ? length * 0.97 : length, time, ev.velocity)
      if (ev.bass !== null) this.bass.triggerAttackRelease(midiToHz(ev.bass), length * 0.97, time, 0.9)
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

  /** Tears everything down, so a reloaded copy of this module starts clean. */
  dispose() {
    const t = Tone.getTransport()
    t.stop()
    if (this.endEvent !== null) t.clear(this.endEvent)
    this.chordPart?.dispose()
    this.clickPart?.dispose()
    if (this.ready) {
      Object.values(this.instruments).forEach((node) => node.dispose())
      this.click.dispose()
    }
    this.ready = false
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

  setSound(sound: Sound) {
    if (this.ready) applySound(this.instruments, sound)
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
const unsubscribe = useStore.subscribe((s, prev) => {
  if (s.sound !== prev.sound) engine.setSound(s.sound)
  if (!s.playing) return
  if (
    s.key !== prev.key ||
    s.mode !== prev.mode ||
    s.bpm !== prev.bpm ||
    s.timeSig !== prev.timeSig ||
    s.chords !== prev.chords ||
    s.loop !== prev.loop ||
    s.metronome !== prev.metronome ||
    s.loopOn !== prev.loopOn ||
    s.arp !== prev.arp
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

// In development, a code change reloads this module while Tone's transport
// lives on; without this, the old copy's scheduled chords keep playing too.
import.meta.hot?.dispose(() => {
  unsubscribe()
  engine.dispose()
  useStore.getState().setPlaying(false)
})
