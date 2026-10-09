import * as Tone from 'tone'
import { useStore, loopRange, type Chord, type LoopRegion, type TimeSig } from '../store'
import { bassNote, chordInfo, voiceChord, type Mode } from '../music/theory'
import { arrange, type Arp, type Hit } from './arrange'
import { applySound, createInstruments, midiToHz, type Instruments } from './instruments'
import type { Sound } from './sound'
import { openMic, outputLatency, startCapture, type Capture } from './recorder'
import { LANES, deleteSavedTake, loadTakes, saveTake, takeInfo, toAudioBuffer, type Take, type TakeInfo } from './take'

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
  takes: (TakeInfo | null)[]
  vocalMuted: boolean[]
}

interface HitEvent extends Hit {
  time: string
}

interface VocalEvent {
  time: string
  /** Seconds into the take, and how much of it to play. */
  offset: number
  duration: number
}

interface Recording {
  capture: Capture
  /** Audio-clock time whose input lines up with the take's first beat. */
  alignTime: number
  startBeat: number
  bpm: number
  lane: number
  /** Plays the count-in; thrown away if the recording is cancelled during it. */
  countClick: Tone.Synth
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
  private vocalParts: Tone.Part<VocalEvent>[] = []
  private vocals: (Tone.Player | null)[] = Array(LANES).fill(null)
  private takes: (Take | null)[] = Array(LANES).fill(null)
  private recording: Recording | null = null
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
    this.vocals = this.takes.map((take) => (take ? new Tone.Player(toAudioBuffer(take)).toDestination() : null))
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

    // Each vocal starts wherever the loop enters it, every time round. The
    // lane being recorded into stays quiet; the others play along.
    this.vocalParts.forEach((part) => part.dispose())
    this.vocalParts = []
    const quartersPerBeat = 4 / den
    const secondsPerQuarter = 60 / song.bpm
    song.takes.forEach((info, lane) => {
      const player = this.vocals[lane]
      if (!player || !info || song.vocalMuted[lane] || this.recording?.lane === lane) return
      const takeStart = info.startBeat * quartersPerBeat
      const takeEnd = takeStart + info.seconds / secondsPerQuarter
      const from = Math.max(takeStart, region.start * quartersPerBeat)
      const to = Math.min(takeEnd, region.end * quartersPerBeat)
      if (to <= from) return
      this.vocalParts.push(
        new Tone.Part<VocalEvent>(
          (time, ev) => player.start(time, ev.offset, ev.duration),
          [{ time: `${Math.round(from * t.PPQ)}i`, offset: (from - takeStart) * secondsPerQuarter, duration: (to - from) * secondsPerQuarter }],
        ).start(0),
      )
    })

    this.clickPart?.dispose()
    this.clickPart = null
    if (song.metronome || this.recording) {
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
          setTimeout(() => this.onEnd?.(), Math.max(0, (time - Tone.immediate()) * 1000))
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
    this.vocalParts.forEach((part) => part.dispose())
    this.vocals.forEach((player) => player?.dispose())
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
    this.vocals.forEach((player) => player?.stop())
  }

  /** Puts a take in a lane for playback, or empties the lane. */
  setTake(lane: number, take: Take | null) {
    this.takes[lane] = take
    this.vocals[lane]?.dispose()
    this.vocals[lane] = take && this.ready ? new Tone.Player(toAudioBuffer(take)).toDestination() : null
  }

  /** Each lane's audio, for exporting. */
  get allTakes(): readonly (Take | null)[] {
    return this.takes
  }

  get isRecording() {
    return this.recording !== null
  }

  /**
   * Records over the loop (or the whole song) once: a bar of clicks to count
   * in, then the progression plays from the loop's start while the mic records,
   * with the click on. Resolves once the count-in has started.
   */
  async record(song: Song, stream: MediaStream, lane: number, on: { count: (beatsLeft: number) => void; rolling: () => void }) {
    await Tone.start()
    this.setup()
    const t = Tone.getTransport()
    t.stop()
    this.vocals.forEach((player) => player?.stop())
    const capture = await startCapture(stream)

    const [num, den] = song.timeSig
    const total = Math.max(song.chords.reduce((sum, c) => sum + c.beats, 0), num)
    const region = song.loopOn ? loopRange(song.loop, total) : { start: 0, end: total }
    const beatSeconds = (60 / song.bpm) * (4 / den)

    const countClick = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
    }).toDestination()
    countClick.volume.value = -12
    const rec: Recording = { capture, alignTime: 0, startBeat: region.start, bpm: song.bpm, lane, countClick }
    this.recording = rec
    // Run fn when the audio clock reaches time, if this recording is still going.
    // A plain timer, unlike Tone's Draw, never skips a callback that runs late.
    const at = (time: number, fn: () => void) =>
      setTimeout(() => this.recording === rec && fn(), Math.max(0, (time - Tone.immediate()) * 1000))
    // Play the region once, with the click, the other lanes, and not this lane's old take.
    this.sync({ ...song, loopOn: true, loop: region })
    t.loop = false
    if (this.endEvent !== null) t.clear(this.endEvent)
    this.endEvent = t.scheduleOnce((time) => {
      setTimeout(() => this.recording === rec && this.onEnd?.(), Math.max(0, (time - Tone.immediate()) * 1000))
    }, `${Math.round(region.end * this.ticksPerBeat)}i`)

    const countIn = Tone.now() + 0.1
    for (let b = 0; b < num; b++) {
      const time = countIn + b * beatSeconds
      countClick.triggerAttackRelease(b === 0 ? 'C6' : 'G5', 0.03, time, b === 0 ? 1 : 0.6)
      // The button counts down in time with the clicks you hear.
      at(time, () => on.count(num - b))
    }
    const startAt = countIn + num * beatSeconds
    // What the singer hears at startAt leaves the speakers a little later,
    // and their voice reaches us a little later again.
    rec.alignTime = startAt + outputLatency() + capture.inputLatency
    t.start(startAt, `${this.loopStartTicks}i`)
    at(startAt, on.rolling)
  }

  /** Stops a recording and returns the take, lined up with the song, and its lane. */
  async finishRecording(): Promise<{ lane: number; take: Take | null } | null> {
    const rec = this.recording
    if (!rec) return null
    this.recording = null
    // Stopping now also cancels a transport start still waiting on the count-in.
    this.stop()
    rec.countClick.dispose()
    const { startTime, samples } = await rec.capture.stop()
    const sampleRate = Tone.getContext().sampleRate
    const skip = Math.round((rec.alignTime - startTime) * sampleRate)
    // Nothing sung yet means stopped during the count-in.
    if (samples.length - skip < sampleRate * 0.25) return { lane: rec.lane, take: null }
    const aligned =
      skip >= 0 ? samples.slice(skip) : Float32Array.from({ length: samples.length - skip }, (_, i) => (i < -skip ? 0 : samples[i + skip]))
    return { lane: rec.lane, take: { startBeat: rec.startBeat, bpm: rec.bpm, sampleRate, samples: aligned } }
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
    s.arp !== prev.arp ||
    s.takes !== prev.takes ||
    s.vocalMuted !== prev.vocalMuted
  ) {
    engine.sync(s)
  }
})

engine.onEnd = () => {
  if (engine.isRecording) {
    void stopRecording()
    return
  }
  engine.stop()
  useStore.getState().setPlaying(false)
}

export async function togglePlay() {
  const s = useStore.getState()
  if (s.recording !== 'off') {
    await stopRecording()
  } else if (s.playing) {
    engine.stop()
    s.setPlaying(false)
  } else {
    await engine.play(s)
    s.setPlaying(true)
  }
}

/** Starts recording a vocal over the progression, or stops one in progress. */
export async function toggleRecord() {
  const s = useStore.getState()
  if (s.recording !== 'off') return stopRecording()
  if (!s.chords.length) return
  if (s.playing) {
    engine.stop()
    s.setPlaying(false)
  }
  let stream: MediaStream
  try {
    stream = await openMic()
  } catch {
    window.alert('Sketchpad needs the microphone to record. Allow it in your browser’s site settings, then try again.')
    return
  }
  s.setRecording('count-in')
  await engine.record(useStore.getState(), stream, s.armedLane, {
    count: (n) => useStore.getState().setCountIn(n),
    rolling: () => {
      useStore.getState().setRecording('on')
      useStore.getState().setPlaying(true)
    },
  })
}

async function stopRecording() {
  const result = await engine.finishRecording()
  const s = useStore.getState()
  s.setRecording('off')
  s.setPlaying(false)
  if (result?.take) {
    const { lane, take } = result
    engine.setTake(lane, take)
    s.setTake(lane, takeInfo(take))
    await saveTake(lane, take)
  }
}

export async function deleteTake(lane: number) {
  engine.setTake(lane, null)
  useStore.getState().setTake(lane, null)
  await deleteSavedTake(lane)
}

// Bring back the takes from the last visit.
void loadTakes().then((takes) => {
  takes.forEach((take, lane) => {
    if (!take) return
    engine.setTake(lane, take)
    useStore.getState().setTake(lane, takeInfo(take))
  })
})

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
  useStore.getState().setRecording('off')
})
