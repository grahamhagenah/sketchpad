import * as Tone from 'tone'
import { keyOf, useStore, loopRange, type Chord } from '../store'
import { bassNote, chordOf, voiceChord } from '../music/theory'
import { arrange, type Hit } from './arrange'
import { applySound, createInstruments, createVocalRoom, midiToHz, routeVocal, type Instruments } from './instruments'
import { createKit, disposeKit, KIT_VOLUME, playDrum, type DrumHit, type Kit } from './drums'
import type { Sound } from './sound'
import { measuredLatency, measureLatency, micProblem, openMic, roundTrip, startCapture, type Capture } from './recorder'
import { newId } from '../id'
import { keepStorage, loadLanes, quantize, storageErrorMessage, storeLanes, takeInfo, toAudioBuffer, type SectionTakes, type Take } from './take'
import { playbackOf, sectionBeatOf, songBeatOf, takeIdsBySection, type Playback } from '../song'
import { keepVocals } from '../history'

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

interface DrumEvent extends DrumHit {
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
  private kit!: Kit
  private drumPart: Tone.Part<DrumEvent> | null = null
  private chordPart: Tone.Part<HitEvent> | null = null
  private clickPart: Tone.Part<ClickEvent> | null = null
  private vocalParts: Tone.Part<VocalEvent>[] = []
  /** Every take's audio this visit, by id, and a player for each once audio has started. */
  private audio = new Map<string, Take>()
  private players = new Map<string, Tone.Player>()
  /** Each take's send to the vocals' reverb, by id, and the reverb itself. */
  private sends = new Map<string, Tone.Gain>()
  private vocalRoom!: Tone.Reverb
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
    this.kit = createKit()
    this.vocalRoom = createVocalRoom()
    this.ready = true
  }

  /** The player for a take, made the first time it's needed. */
  private player(id: string) {
    let player = this.players.get(id)
    const take = this.audio.get(id)
    if (!player && take && this.ready) {
      player = new Tone.Player(toAudioBuffer(take))
      this.sends.set(id, routeVocal(player, this.vocalRoom, 0))
      this.players.set(id, player)
    }
    return player ?? null
  }

  /** Sets each track's level: the chords, the drums, and every take's player, with its reverb. */
  setLevels(song: Pick<Playback, 'chordsDb' | 'drumsDb' | 'vocals'>) {
    if (!this.ready) return
    this.instruments.bus.volume.value = song.chordsDb
    this.kit.out.volume.value = KIT_VOLUME + song.drumsDb
    for (const vocal of song.vocals) {
      const player = this.player(vocal.id)
      if (player) player.volume.value = vocal.db
      const send = this.sends.get(vocal.id)
      if (send) send.gain.value = vocal.reverb
    }
  }

  /** Rebuilds the loop from what plays. Safe to call while playing. */
  sync(song: Playback) {
    if (!this.ready) return
    this.setLevels(song)
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
    song.vocals.forEach((vocal) => {
      const player = this.player(vocal.id)
      if (!player || (this.recording && this.recording.lane === vocal.lane)) return
      const takeStart = vocal.startBeat * quartersPerBeat
      const takeEnd = Math.min(takeStart + vocal.seconds / secondsPerQuarter, vocal.endBeat * quartersPerBeat)
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

    // The drums inside the loop, each hit where it falls.
    this.drumPart?.dispose()
    const drums = song.drums
      .filter((h) => h.beat >= region.start && h.beat < region.end)
      .map((h) => ({ ...h, time: `${Math.round(h.beat * this.ticksPerBeat)}i` }))
    this.drumPart = new Tone.Part<DrumEvent>((time, ev) => playDrum(this.kit, ev.piece, time, ev.velocity), drums).start(0)

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
  async play(song: Playback, fromBeat = 0) {
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
    this.drumPart?.dispose()
    this.clickPart?.dispose()
    this.vocalParts.forEach((part) => part.dispose())
    this.players.forEach((player) => player.dispose())
    this.players.clear()
    this.sends.forEach((send) => send.dispose())
    this.sends.clear()
    if (this.ready) {
      this.vocalRoom.dispose()
      Object.values(this.instruments).forEach((node) => node.dispose())
      this.click.dispose()
      disposeKit(this.kit)
    }
    this.ready = false
  }

  stop() {
    if (!this.ready) return
    Tone.getTransport().stop()
    this.pad.releaseAll()
    this.bass.triggerRelease()
    this.players.forEach((player) => player.stop())
  }

  /** Keeps a take's audio, for playing and storing. */
  addTake(take: Take) {
    this.audio.set(take.id, take)
  }

  /** A take's audio, for exporting and storing. */
  takeAudio(id: string) {
    return this.audio.get(id)
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
  async record(song: Playback, stream: MediaStream, lane: number, on: { count: (beatsLeft: number) => void; rolling: () => void }) {
    await Tone.start()
    this.setup()
    const t = Tone.getTransport()
    t.stop()
    this.players.forEach((player) => player.stop())
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
    // and their voice reaches us a little later again: measured, if it has been, or else the browser's estimate.
    rec.alignTime = startAt + roundTrip(capture)
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
    return { lane: rec.lane, take: { id: newId(), startBeat: rec.startBeat, bpm: rec.bpm, sampleRate, samples: quantize(aligned) } }
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

  async audition(song: Pick<Playback, 'key' | 'mode'>, chord: Chord) {
    await Tone.start()
    this.setup()
    const info = chordOf(song.key, song.mode, chord)
    const now = Tone.now()
    this.pad.triggerAttackRelease(voiceChord(info.pcs, null).map(midiToHz), 0.9, now, 0.8)
    this.bass.triggerAttackRelease(midiToHz(bassNote(info.bassPc)), 0.9, now, 0.9)
  }
}

export const engine = new Engine()

useStore.setState({ latency: measuredLatency() })

// Keep the loop in step with edits made while it plays.
const unsubscribe = useStore.subscribe((s, prev) => {
  if (s.sound !== prev.sound) engine.setSound(s.sound)
  // Levels change straight away, playing or not, so a chord auditioned after turning the chords down is quieter too.
  if (s.chordsVolume !== prev.chordsVolume || s.drumsVolume !== prev.drumsVolume || s.vocalVolume !== prev.vocalVolume || s.vocalReverb !== prev.vocalReverb || s.sections !== prev.sections) {
    engine.setLevels(playbackOf(s))
  }
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
    s.rhythm !== prev.rhythm ||
    s.takes !== prev.takes ||
    s.vocalMuted !== prev.vocalMuted ||
    s.vocalSolo !== prev.vocalSolo ||
    s.chordsMuted !== prev.chordsMuted ||
    s.chordsSolo !== prev.chordsSolo ||
    s.drums !== prev.drums ||
    s.drumFill !== prev.drumFill ||
    s.sectionKey !== prev.sectionKey ||
    s.drumTrack !== prev.drumTrack ||
    s.drumsMuted !== prev.drumsMuted ||
    s.drumsSolo !== prev.drumsSolo ||
    s.sections !== prev.sections ||
    s.arrangement !== prev.arrangement ||
    s.activeSection !== prev.activeSection
  ) {
    // What was started keeps playing, whichever view is open now.
    engine.sync(playbackOf(s, s.playingView))
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
    // Paused where it got to, as a beat of the view that's open, which may not be what was playing.
    const at = engine.position() ?? s.playhead
    const here = s.playingView === s.view ? at : s.view === 'section' ? sectionBeatOf(s, at) : songBeatOf(s, at)
    s.setPlayhead(here ?? 0)
    engine.stop()
    s.setPlaying(false)
  } else {
    useStore.setState({ playingView: s.view })
    await engine.play(playbackOf(s), s.playhead)
    s.setPlaying(true)
  }
}

/** Moves the playhead; playback carries on from there. */
export async function seek(beat: number) {
  const s = useStore.getState()
  if (s.recording !== 'off') return
  s.setPlayhead(Math.max(0, beat))
  if (s.playing) {
    // Moving the playhead plays from there in the view it was moved in.
    useStore.setState({ playingView: s.view })
    engine.stop()
    await engine.play(playbackOf(useStore.getState()), beat)
  }
}

/** Starts recording a vocal over the open section, or stops one in progress. */
export async function toggleRecord() {
  const s = useStore.getState()
  if (s.recording !== 'off') return stopRecording()
  // Vocals belong to a section, so they're recorded in one, not over the whole song.
  if (!s.chords.length || s.view !== 'section') return
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
    window.alert(micProblem('record'))
    return
  }
  // Record into the selected track, or else the first one without a take
  // (adding a track if need be). With every lane full and none selected, the
  // last take selected is replaced.
  const free = s.takes.indexOf(null)
  const lane = s.selectedVocal ?? (free === -1 ? s.armedLane : free)
  s.setArmedLane(lane)
  s.setRecording('count-in')
  await engine.record(playbackOf(useStore.getState()), stream, lane, {
    count: (n) => useStore.getState().setCountIn(n),
    rolling: () => {
      // A recording plays the open section.
      useStore.setState({ playingView: 'section' })
      useStore.getState().setRecording('on')
      useStore.getState().setPlaying(true)
    },
  })
}

/**
 * Measures how late recordings arrive on this device, by playing clicks and
 * listening for them, so takes line up with the beat with any speakers or
 * headphones. Tells the person how it went.
 */
export async function checkLatency() {
  const s = useStore.getState()
  if (s.recording !== 'off') return
  const go = window.confirm(
    'Bounce will play eight clicks and listen for them on the microphone, to line your recordings up with the beat.\n\nTurn the volume up. On headphones, hold one up to the microphone.',
  )
  if (!go) return
  if (s.playing) {
    engine.stop()
    s.setPlaying(false)
  }
  let latency: number | null
  try {
    setAudioSession('play-and-record')
    latency = await measureLatency()
  } catch {
    window.alert(micProblem('check the timing'))
    return
  } finally {
    setAudioSession('playback')
  }
  useStore.getState().setLatency(latency ?? useStore.getState().latency)
  window.alert(
    latency === null
      ? 'Bounce couldn’t hear the clicks clearly. Turn the volume up (or hold your headphones to the microphone), keep the room quiet, and try again.'
      : `Recording timing set: ${Math.round(latency * 1000)} ms. New takes will line up with that on this device.`,
  )
}

async function stopRecording() {
  const result = await engine.finishRecording()
  setAudioSession('playback')
  const s = useStore.getState()
  s.setRecording('off')
  s.setPlaying(false)
  if (result?.take) {
    const { lane, take } = result
    keepStorage()
    // Recording over a take can be undone, as deleting one can.
    if (s.takes[lane]) keepVocals()
    // The audio first, so it's there to store when the lane changes.
    engine.addTake(take)
    s.setTake(lane, takeInfo(take))
    s.showVocalTracks(lane + 1)
  }
}

/** Lanes up to and including the last one with a take. */
const takeCount = (takes: readonly unknown[]) => takes.reduce<number>((n, t, lane) => (t ? lane + 1 : n), 0)

/** Deletes a vocal track and its take; the tracks after it move up, so they stay numbered 1, 2, 3… */
export async function deleteTake(lane: number) {
  const s = useStore.getState()
  const tracks = Math.max(s.vocalTracks, takeCount(s.takes))
  // Undo brings the track and its take back.
  keepVocals()
  s.renumberVocals(Array.from({ length: tracks }, (_, i) => i).filter((i) => i !== lane))
}

/** Puts a whole song's takes in its sections, as when opening a saved sketch. */
export function loadSongTakes(takes: SectionTakes) {
  const s = useStore.getState()
  const known = new Set(s.sections.map((sec) => sec.id))
  for (const [section, lanes] of Object.entries(takes)) {
    if (!known.has(section)) continue
    lanes.forEach((take) => take && engine.addTake(take))
    s.setSectionTakes(
      section,
      lanes.map((take) => (take ? takeInfo(take) : null)),
    )
  }
}

// Store each section's takes whenever they change: after recording,
// deleting a track or a section, or opening a sketch. Not until the last
// visit's takes are back, so an early change can't store an empty song over them.
let lanesLoaded = false
let storedLanes = ''
const unsubscribeLanes = useStore.subscribe((s) => {
  if (!lanesLoaded) return
  const lanes = takeIdsBySection(s)
  const key = JSON.stringify(lanes)
  if (key === storedLanes) return
  storedLanes = key
  storeLanes(lanes, (id) => engine.takeAudio(id)).catch((error) => {
    console.error(error)
    storedLanes = ''
    window.alert(`Bounce couldn’t store your vocal tracks, so recent changes to them will be gone if the page reloads. ${storageErrorMessage(error)}`)
  })
})

// Bring back the takes from the last visit. Takes kept before sections go to the open section.
void loadLanes(useStore.getState().activeSection)
  .then((takes) => {
    const known = new Set(useStore.getState().sections.map((sec) => sec.id))
    // If the song itself was lost (cleared site data, say) the takes still go somewhere they can be heard.
    const stray = Object.entries(takes).find(([section, lanes]) => !known.has(section) && lanes.some(Boolean))
    if (stray && !Object.keys(takes).some((section) => known.has(section))) takes = { [useStore.getState().activeSection]: stray[1] }
    loadSongTakes(takes)
    storedLanes = JSON.stringify(takeIdsBySection(useStore.getState()))
  })
  .catch((error) => console.error(error))
  .finally(() => {
    lanesLoaded = true
  })

export function audition(chord: Chord) {
  const s = useStore.getState()
  if (!s.playing) void engine.audition(keyOf(s), chord)
}

// In development, a code change reloads this module while Tone's transport
// lives on; without this, the old copy's scheduled chords keep playing too.
import.meta.hot?.dispose(() => {
  unsubscribe()
  unsubscribeLanes()
  engine.dispose()
  useStore.getState().setPlaying(false)
  useStore.getState().setRecording('off')
})
