import * as Tone from 'tone'
import { audibleTracks, useStore, loopRange, type Chord, type LoopRegion, type TimeSig } from '../store'
import { bassNote, chordInfo, voiceChord, type Mode } from '../music/theory'
import { arrange, type Arp, type Hit } from './arrange'
import { applySound, createInstruments, midiToHz, type Instruments } from './instruments'
import type { Sound } from './sound'
import { openMic, outputLatency, startCapture, type Capture } from './recorder'
import { LANES, deleteSavedTake, keepStorage, loadTakes, saveTake, storageErrorMessage, takeInfo, toAudioBuffer, type Take, type TakeInfo } from './take'

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
  vocalSolo: boolean[]
  chordsMuted: boolean
  chordsSolo: boolean
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
  /** The region in beats, and what plays in it, kept for starting part-way through. */
  private region = { start: 0, end: 0 }
  private chordEvents: HitEvent[] = []
  private vocalSpans: { player: Tone.Player; from: number; to: number; offset: number }[] = []
  private quartersPerBeat = 1
  private secondsPerQuarter = 0.5
  private endEvent: number | null = null
  /** Called when a play-through without looping reaches the end. */
  onEnd: (() => void) | null = null

  private setup() {
    if (this.ready) return
    setAudioSession('playback')
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
    const audible = audibleTracks(song)
    const events: HitEvent[] = audible.chords
      ? arrange(song, region).map((h) => ({ ...h, time: `${Math.round(h.start * t.PPQ)}i` }))
      : []

    this.chordEvents = events
    this.chordPart?.dispose()
    this.chordPart = new Tone.Part<HitEvent>((time, ev) => this.playHit(ev, ev.dur, time), events).start(0)

    // Each vocal starts wherever the loop enters it, every time round. The
    // lane being recorded into stays quiet; the others play along.
    this.vocalParts.forEach((part) => part.dispose())
    this.vocalParts = []
    this.vocalSpans = []
    const quartersPerBeat = 4 / den
    const secondsPerQuarter = 60 / song.bpm
    this.quartersPerBeat = quartersPerBeat
    this.secondsPerQuarter = secondsPerQuarter
    this.region = region
    song.takes.forEach((info, lane) => {
      const player = this.vocals[lane]
      if (!player || !info || !audible.vocals[lane] || this.recording?.lane === lane) return
      const takeStart = info.startBeat * quartersPerBeat
      const takeEnd = takeStart + info.seconds / secondsPerQuarter
      const from = Math.max(takeStart, region.start * quartersPerBeat)
      const to = Math.min(takeEnd, region.end * quartersPerBeat)
      if (to <= from) return
      this.vocalSpans.push({ player, from, to, offset: (from - takeStart) * secondsPerQuarter })
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

  private playHit(ev: Hit, quarters: number, time: number) {
    const length = quarters * this.secondsPerQuarter
    if (ev.pad.length) this.pad.triggerAttackRelease(ev.pad.map(midiToHz), ev.held ? length * 0.97 : length, time, ev.velocity)
    if (ev.bass !== null) this.bass.triggerAttackRelease(midiToHz(ev.bass), length * 0.97, time, 0.9)
  }

  /** Plays from `fromBeat`, or from the start of the loop when that's outside it. */
  async play(song: Song, fromBeat = 0) {
    await Tone.start()
    this.setup()
    this.sync(song)
    const t = Tone.getTransport()
    t.stop()
    const { start, end } = this.region
    const beat = fromBeat >= start && fromBeat < end ? fromBeat : start
    const time = Tone.now() + 0.05
    t.start(time, `${Math.round(beat * this.ticksPerBeat)}i`)
    // Starting part-way through, sound what's already under way: the rest of
    // the chord (or arp note) and of any take.
    const q = beat * this.quartersPerBeat
    for (const ev of this.chordEvents) {
      if (ev.start < q && q < ev.start + ev.dur) this.playHit(ev, ev.start + ev.dur - q, time)
    }
    for (const v of this.vocalSpans) {
      if (v.from < q && q < v.to) v.player.start(time, v.offset + (q - v.from) * this.secondsPerQuarter, (v.to - q) * this.secondsPerQuarter)
    }
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

  /** The beat the take being recorded will start on, the same beat its take is drawn from. */
  get recordingStartBeat() {
    return this.recording?.startBeat ?? 0
  }

  /**
   * Records over the loop (or the whole song) once: a silent bar counted down
   * on the record button, then the progression plays from the loop's start
   * while the mic records. Resolves once the count-in has started.
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

    const rec: Recording = { capture, alignTime: 0, startBeat: region.start, bpm: song.bpm, lane }
    this.recording = rec
    // Run fn when the audio clock reaches time, if this recording is still going.
    // A plain timer, unlike Tone's Draw, never skips a callback that runs late.
    const at = (time: number, fn: () => void) =>
      setTimeout(() => this.recording === rec && fn(), Math.max(0, (time - Tone.immediate()) * 1000))
    // Play the region once, with the other lanes and not this lane's old take.
    this.sync({ ...song, loopOn: true, loop: region })
    t.loop = false
    if (this.endEvent !== null) t.clear(this.endEvent)
    this.endEvent = t.scheduleOnce((time) => {
      setTimeout(() => this.recording === rec && this.onEnd?.(), Math.max(0, (time - Tone.immediate()) * 1000))
    }, `${Math.round(region.end * this.ticksPerBeat)}i`)

    const countIn = Tone.now() + 0.1
    for (let b = 0; b < num; b++) {
      const time = countIn + b * beatSeconds
      // A silent count-in: the button counts down the beats.
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
    s.vocalMuted !== prev.vocalMuted ||
    s.vocalSolo !== prev.vocalSolo ||
    s.chordsMuted !== prev.chordsMuted ||
    s.chordsSolo !== prev.chordsSolo
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
  // Played through to the end: the next play starts over.
  useStore.getState().setPlayhead(0)
  useStore.getState().setPlaying(false)
}

/**
 * On iPhones, web audio counts as ringer sound and goes quiet with the silent
 * switch; calling it playback, like a music app, keeps it audible.
 */
function setAudioSession(type: 'playback' | 'play-and-record') {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (session) session.type = type
}

/** Plays from the playhead, or pauses and leaves the playhead where it stopped. */
export async function togglePlay() {
  const s = useStore.getState()
  if (s.recording !== 'off') {
    await stopRecording()
  } else if (s.playing) {
    s.setPlayhead(engine.position() ?? s.playhead)
    engine.stop()
    s.setPlaying(false)
  } else {
    await engine.play(s, s.playhead)
    s.setPlaying(true)
  }
}

/** Moves the playhead; playback carries on from there. */
export async function seek(beat: number) {
  const s = useStore.getState()
  if (s.recording !== 'off') return
  s.setPlayhead(Math.max(0, beat))
  if (s.playing) {
    engine.stop()
    await engine.play(useStore.getState(), beat)
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
    setAudioSession('play-and-record')
    stream = await openMic()
  } catch {
    setAudioSession('playback')
    window.alert('Sketchpad needs the microphone to record. Allow it in your browser’s site settings, then try again.')
    return
  }
  // Record into the selected track, or else the first one without a take
  // (adding a track if need be). With every lane full and none selected, the
  // last take selected is replaced.
  const free = s.takes.indexOf(null)
  const lane = s.selectedVocal ?? (free === -1 ? s.armedLane : free)
  s.setArmedLane(lane)
  s.setRecording('count-in')
  await engine.record(useStore.getState(), stream, lane, {
    count: (n) => useStore.getState().setCountIn(n),
    rolling: () => {
      useStore.getState().setRecording('on')
      useStore.getState().setPlaying(true)
    },
  })
}

async function stopRecording() {
  const result = await engine.finishRecording()
  setAudioSession('playback')
  const s = useStore.getState()
  s.setRecording('off')
  s.setPlaying(false)
  if (result?.take) {
    const { lane, take } = result
    engine.setTake(lane, take)
    s.setTake(lane, takeInfo(take))
    s.showVocalTracks(lane + 1)
    keepStorage()
    try {
      await saveTake(lane, take)
    } catch (error) {
      console.error(error)
      window.alert(`This take plays now, but Sketchpad couldn’t store it, so it will be gone if the page reloads. ${storageErrorMessage(error)}`)
    }
  }
}

/** Deletes a vocal track and its take; the tracks after it move up, so they stay numbered 1, 2, 3… */
export async function deleteTake(lane: number) {
  const tracks = Math.max(useStore.getState().vocalTracks, takeCount(engine.allTakes))
  try {
    await renumberTakes(Array.from({ length: tracks }, (_, i) => i).filter((i) => i !== lane))
  } catch (error) {
    console.error(error)
    window.alert(`The track is deleted, but Sketchpad couldn’t store the change, so it may come back if the page reloads. ${storageErrorMessage(error)}`)
  }
}

/** Swaps in a whole set of takes, as when opening a saved sketch. */
export async function replaceTakes(takes: (Take | null)[]) {
  const s = useStore.getState()
  for (let lane = 0; lane < LANES; lane++) {
    const take = takes[lane] ?? null
    engine.setTake(lane, take)
    s.setTake(lane, take ? takeInfo(take) : null)
    if (take) await saveTake(lane, take)
    else await deleteSavedTake(lane)
  }
}

/** Lanes up to and including the last one with a take. */
const takeCount = (takes: readonly (Take | null)[]) => takes.reduce((n, t, lane) => (t ? lane + 1 : n), 0)

/** Puts the takes from lanes `from` into lanes 0, 1, 2…, clearing the rest. */
async function renumberTakes(from: number[]) {
  const old = engine.allTakes.slice()
  const moved = Array.from({ length: LANES }, (_, lane) => (lane < from.length ? old[from[lane]] : null))
  moved.forEach((take, lane) => engine.setTake(lane, take))
  useStore.getState().renumberVocals(from)
  for (let lane = 0; lane < LANES; lane++) {
    const take = moved[lane]
    if (!take) await deleteSavedTake(lane)
    else if (from[lane] !== lane) await saveTake(lane, take)
  }
}

// Bring back the takes from the last visit.
void loadTakes().then((takes) => {
  takes.forEach((take, lane) => {
    if (!take) return
    engine.setTake(lane, take)
    useStore.getState().setTake(lane, takeInfo(take))
  })
  useStore.getState().showVocalTracks(takeCount(takes))
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
