import * as Tone from 'tone'
import { keyOf, useStore, loopRange, vocalTrackName, type Chord } from '../store'
import { bassNote, chordOf, voiceChord } from '../music/theory'
import { arrange, playedSound, type Hit } from './arrange'
import { applySound, createInstruments, createVocalRoom, midiToHz, routeVocal, type Bass, type Instruments, type Pad } from './instruments'
import { createKit, disposeKit, KIT_VOLUME, playDrum, type DrumHit, type Kit } from './drums'
import type { Sound } from './sound'
import { expectedRoundTrip, findClicks, keepLatency, measuredLatency, measureLatency, micProblem, openMic, roundTrip, startCapture, type Capture } from './recorder'
import { newId } from '../id'
import { keepStorage, loadLanes, passesOf, quantize, storageErrorMessage, storeLanes, takeInfo, toAudioBuffer, type SectionTakes, type Take, type Trim } from './take'
import { playbackOf, sectionBeatOf, songBeatOf, takeIdsBySection, type Playback } from '../song'
import { keepVocals } from '../history'
import { quietly, showUndoNote } from '../undoNote'
import { tally } from '../analytics'
import { monoStart, safely } from './timing'

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
  /** When the take's first beat plays, and when each count-in click did, to hear them back and measure the round trip. */
  startAt: number
  clicks: number[]
  beatSeconds: number
  /** Recording round the loop: how long each pass is, and the least of the last that's kept; null when it plays once. */
  cycle: { passSeconds: number; minSeconds: number } | null
}

interface DrumEvent extends DrumHit {
  time: string
}

interface ClickEvent {
  time: string
  accent: boolean
}

/** How far ahead notes are handed to the audio clock: Tone's usual, and more while recording, when steady playback matters more than a quick response. */
const LOOK_AHEAD = 0.1
const RECORDING_LOOK_AHEAD = 0.3

/**
 * When a note played by hand (a chord previewed, a chord key) should sound:
 * straight away, a moment from now on the audio clock. Tone.now() is the
 * look-ahead from now, there for the song's scheduled notes, and would have
 * them answer a tenth of a second late, three tenths while recording.
 */
const playNow = () => Tone.immediate() + 0.01

/**
 * Hands notes to the audio clock `seconds` ahead, still checking every 50ms
 * (Tone would otherwise check only half as often as it looks ahead), so the
 * page can be held up for nearly all of it before a note comes late.
 */
function setLookAhead(seconds: number) {
  const context = Tone.getContext() as Tone.Context
  context.lookAhead = seconds
  context.updateInterval = 0.05
}

class Engine {
  private ready = false
  private instruments!: Instruments
  private pad!: Pad
  private bass!: Bass
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
    const s = useStore.getState()
    this.instruments = createInstruments(playedSound(s.sound, s.arp, s.bpm))
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

  /**
   * Builds the instruments ahead of time, while nothing's happening, so the
   * first play, take or chord doesn't wait the tenth of a second or so it
   * takes. The audio stays silent until it's first asked for.
   */
  warmUp() {
    try {
      this.setup()
    } catch (error) {
      // Built on first use instead.
      console.warn(error)
    }
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
    this.chordPart = new Tone.Part<HitEvent>(safely((time, ev) => this.playHit(ev, ev.dur, time)), events).start(0)

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
      // Into its audio by however much is trimmed off its start, and however far the region starts into it.
      const offset = (vocal.offset ?? 0) + (from - takeStart) * secondsPerQuarter
      this.vocalSpans.push({ player, from, to, offset })
      this.vocalParts.push(
        new Tone.Part<VocalEvent>(
          safely((time, ev) => player.start(time, ev.offset, ev.duration)),
          [{ time: `${Math.round(from * t.PPQ)}i`, offset, duration: (to - from) * secondsPerQuarter }],
        ).start(0),
      )
    })

    // The drums inside the loop, each hit where it falls.
    this.drumPart?.dispose()
    const drums = song.drums
      .filter((h) => h.beat >= region.start && h.beat < region.end)
      .map((h) => ({ ...h, time: `${Math.round(h.beat * this.ticksPerBeat)}i` }))
    this.drumPart = new Tone.Part<DrumEvent>(safely((time, ev) => playDrum(this.kit, ev.piece, time, ev.velocity)), drums).start(0)

    this.clickPart?.dispose()
    this.clickPart = null
    if (song.metronome || this.recording) {
      const clicks: ClickEvent[] = []
      for (let b = region.start; b < region.end; b++) {
        clicks.push({ time: `${Math.round(b * this.ticksPerBeat)}i`, accent: b % num === 0 })
      }
      this.clickPart = new Tone.Part<ClickEvent>(
        safely((time, ev) => this.click.triggerAttackRelease(ev.accent ? 'C6' : 'G5', 0.03, monoStart(this.click, time), ev.accent ? 1 : 0.6)),
        clicks,
      ).start(0)
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

    // Already playing: a take muted (or otherwise dropped) stops now rather than
    // at its end, and one unmuted part-way through comes in where it's got to.
    if (t.state === 'started') {
      const live = new Set(this.vocalSpans.map((v) => v.player))
      this.players.forEach((player) => {
        if (!live.has(player) && player.state === 'started') player.stop()
      })
      const q = t.ticks / t.PPQ
      const time = Tone.now()
      for (const v of this.vocalSpans) {
        if (v.player.state !== 'started' && v.from < q && q < v.to) {
          v.player.start(time, v.offset + (q - v.from) * this.secondsPerQuarter, (v.to - q) * this.secondsPerQuarter)
        }
      }
    }
  }

  private playHit(ev: Hit, quarters: number, time: number) {
    const length = quarters * this.secondsPerQuarter
    if (ev.pad.length) this.pad.triggerAttackRelease(ev.pad.map(midiToHz), ev.held ? length * 0.97 : length, time, ev.velocity)
    if (ev.bass !== null) this.bass.play(ev.bass, length * 0.97, time, 0.9)
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
    this.bass.release()
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
   * Records over the loop (or the whole song) once: a bar counted in on the
   * click (and counted down on the record button), then the progression
   * plays from the loop's start while the mic records. Resolves once the
   * count-in has started.
   */
  async record(song: Playback, stream: MediaStream, lane: number, on: { count: (beatsLeft: number) => void; rolling: () => void; pass: (pass: number) => void }) {
    await Tone.start()
    this.setup()
    const t = Tone.getTransport()
    t.stop()
    this.players.forEach((player) => player.stop())
    const capture = await startCapture(stream)
    // Scheduled further ahead while recording, so a moment's hold-up on the page (the browser tidying memory, say) can't make the music stutter under the singer.
    setLookAhead(RECORDING_LOOK_AHEAD)

    const [num, den] = song.timeSig
    const total = Math.max(song.chords.reduce((sum, c) => sum + c.beats, 0), num)
    const region = song.loopOn ? loopRange(song.loop, total) : { start: 0, end: total }
    const beatSeconds = (60 / song.bpm) * (4 / den)

    // With the loop on, it goes round and round, a take each time, until stopped; the last is kept if at least a bar of it was sung.
    const cycle = song.loopOn ? { passSeconds: (region.end - region.start) * beatSeconds, minSeconds: num * beatSeconds } : null
    const rec: Recording = { capture, alignTime: 0, startAt: 0, clicks: [], beatSeconds, startBeat: region.start, bpm: song.bpm, lane, cycle }
    this.recording = rec
    // Run fn when the audio clock reaches time, if this recording is still going.
    // A plain timer, unlike Tone's Draw, never skips a callback that runs late.
    const at = (time: number, fn: () => void) =>
      setTimeout(() => this.recording === rec && fn(), Math.max(0, (time - Tone.immediate()) * 1000))
    // Play the region, with the other lanes and not this lane's old take: round and round with the loop on, else once.
    this.sync({ ...song, loopOn: true, loop: region })
    if (this.endEvent !== null) t.clear(this.endEvent)
    this.endEvent = null
    if (cycle) {
      // Each time round, the next take.
      let pass = 1
      this.onLoop = (time: number) => at(time, () => on.pass(++pass))
      t.on('loop', this.onLoop)
    } else {
      t.loop = false
      this.endEvent = t.scheduleOnce((time) => {
        setTimeout(() => this.recording === rec && this.onEnd?.(), Math.max(0, (time - Tone.immediate()) * 1000))
      }, `${Math.round(region.end * this.ticksPerBeat)}i`)
    }

    const countIn = Tone.now() + 0.1
    for (let b = 0; b < num; b++) {
      const time = countIn + b * beatSeconds
      rec.clicks.push(time)
      // A bar counted in out loud on the metronome's click, the first beat higher, so the tempo is in your head before the take starts;
      // each handed over a moment ahead, so cancelling the count-in stops the clicks still to come. The button counts down the beats too.
      at(time - 0.08, () => this.click.triggerAttackRelease(b === 0 ? 'C6' : 'G5', 0.03, monoStart(this.click, time), b === 0 ? 1 : 0.6))
      at(time, () => on.count(num - b))
    }
    const startAt = countIn + num * beatSeconds
    // What the singer hears at startAt leaves the speakers a little later,
    // and their voice reaches us a little later again: measured, if it has been, or else the browser's estimate.
    rec.startAt = startAt
    rec.alignTime = startAt + roundTrip(capture)
    t.start(startAt, `${this.loopStartTicks}i`)
    at(startAt, on.rolling)
  }

  /** How loud the microphone is while recording (0 to 1), or null when nothing's recording. */
  inputLevel(): number | null {
    return this.recording ? this.recording.capture.level() : null
  }

  /** What counts the passes of a recording round the loop, while one goes on. */
  private onLoop: ((time: number) => void) | null = null

  /**
   * Stops a recording and returns its takes, lined up with the song, and
   * their lane: one, or recorded round the loop, one for each time round.
   */
  async finishRecording(): Promise<{ lane: number; takes: Take[] } | null> {
    const rec = this.recording
    if (!rec) return null
    this.recording = null
    setLookAhead(LOOK_AHEAD)
    if (this.onLoop) Tone.getTransport().off('loop', this.onLoop)
    this.onLoop = null
    // Stopping now also cancels a transport start still waiting on the count-in.
    this.stop()
    const { startTime, samples } = await rec.capture.stop()
    const sampleRate = Tone.getContext().sampleRate
    // Where the microphone heard the count-in's clicks (singing to speakers, it does), the round trip is measured
    // right there: the take is lined up by that, and the next ones too. On headphones it hears nothing, and the last measure stands.
    const heard = rec.clicks.length >= 3 ? findClicks(samples, sampleRate, startTime, rec.clicks, rec.beatSeconds - 0.05) : null
    if (heard !== null && heard > 0.002 && heard < 0.6) {
      rec.alignTime = rec.startAt + heard
      keepLatency(heard)
      useStore.getState().setLatency(heard)
    }
    const skip = Math.round((rec.alignTime - startTime) * sampleRate)
    // Nothing sung yet means stopped during the count-in.
    if (samples.length - skip < sampleRate * 0.25) return { lane: rec.lane, takes: [] }
    const aligned =
      skip >= 0 ? samples.slice(skip) : Float32Array.from({ length: samples.length - skip }, (_, i) => (i < -skip ? 0 : samples[i + skip]))
    const passes = rec.cycle ? passesOf(aligned.length, sampleRate, rec.cycle.passSeconds, rec.cycle.minSeconds) : [[0, aligned.length] as [number, number]]
    const takes = passes.map(([from, to]) => ({ id: newId(), startBeat: rec.startBeat, bpm: rec.bpm, sampleRate, samples: quantize(aligned.slice(from, to)) }))
    return { lane: rec.lane, takes }
  }

  /**
   * Current loop position in beats, or null when stopped: where the song is a
   * usual look-ahead from now, as the transport's own position would be, so
   * the playhead keeps its place when recording schedules further ahead.
   */
  position(): number | null {
    const t = Tone.getTransport()
    if (t.state !== 'started') return null
    return t.getTicksAtTime(Tone.immediate() + LOOK_AHEAD) / this.ticksPerBeat
  }

  setSound(sound: Sound) {
    if (this.ready) applySound(this.instruments, sound)
  }

  /** The arpeggio a chord preview is playing, as timers yet to fire; a new preview cuts it short. */
  private auditionTimers: ReturnType<typeof setTimeout>[] = []

  /**
   * Plays a chord to hear it. With the arpeggiator on, it's arpeggiated, as it
   * would be in the song, for up to a bar at the song's tempo; otherwise struck
   * and held a moment.
   */
  async audition(song: Pick<Playback, 'key' | 'mode' | 'timeSig' | 'bpm' | 'arp'>, chord: Chord) {
    await Tone.start()
    this.setup()
    this.auditionTimers.forEach(clearTimeout)
    this.auditionTimers = []
    const now = playNow()
    if (!song.arp.on) {
      const info = chordOf(song.key, song.mode, chord)
      this.pad.triggerAttackRelease(voiceChord(info.pcs, null).map(midiToHz), 0.9, now, 0.8)
      this.bass.play(bassNote(info.bassPc), 0.9, now, 0.9)
      return
    }
    const quarter = 60 / song.bpm
    const hits = arrange({ key: song.key, mode: song.mode, timeSig: song.timeSig, chords: [{ ...chord, beats: Math.min(chord.beats, song.timeSig[0]) }], arp: song.arp, rhythm: { chords: 'held', bass: 'held' } })
    const start = now + 0.02
    for (const h of hits) {
      const at = start + h.start * quarter
      const play = () => {
        if (h.pad.length) this.pad.triggerAttackRelease(h.pad.map(midiToHz), h.dur * quarter, at, h.velocity)
        if (h.bass !== null) this.bass.play(h.bass, h.dur * quarter * 0.97, at, 0.9)
      }
      // Handed to the synths a moment ahead, on the audio clock; until then, a newer preview can call it off.
      const lead = (at - Tone.now() - 0.1) * 1000
      if (lead <= 0) play()
      else this.auditionTimers.push(setTimeout(play, lead))
    }
  }

  /** Counts holds, so the bass (which plays one note) is let go only by the hold that last took it. */
  private holds = 0
  private bassHolder = 0
  /** The arpeggio a held key is playing; one at a time, as an arpeggiator plays. */
  private stopArp: (() => void) | null = null

  /**
   * Sounds a chord for as long as a key is held: struck when it goes down,
   * let go with `release` (what this returns) when it comes up. A sound that
   * fades by itself (a piano, a pluck, a bell) still fades while held; one
   * that sustains rings on until let go, then rings out as it does. With the
   * arpeggiator on, its pattern goes round and round for as long as the key
   * is down, each note as long as its length says. A minute at most, so a key
   * whose release goes missing can't ring forever.
   */
  hold(song: Pick<Playback, 'key' | 'mode' | 'timeSig' | 'bpm' | 'arp'>, chord: Chord): () => void {
    const id = ++this.holds
    let released = false
    let stop = () => {}
    void (async () => {
      await Tone.start()
      this.setup()
      const now = playNow()
      const limit = setTimeout(() => release(), 60_000)
      if (!song.arp.on) {
        const info = chordOf(song.key, song.mode, chord)
        const freqs = voiceChord(info.pcs, null).map(midiToHz)
        this.pad.triggerAttack(freqs, now, 0.8)
        this.bass.attack(bassNote(info.bassPc), now, 0.9)
        this.bassHolder = id
        stop = () => {
          clearTimeout(limit)
          const at = playNow()
          this.pad.triggerRelease(freqs, at)
          if (this.bassHolder === id) this.bass.release(at)
        }
      } else {
        // A newer held key takes over the arpeggio.
        this.stopArp?.()
        const quarter = 60 / song.bpm
        const barQuarters = song.timeSig[0] * (4 / song.timeSig[1])
        const bar = arrange({ key: song.key, mode: song.mode, timeSig: song.timeSig, chords: [{ ...chord, beats: song.timeSig[0] }], arp: song.arp, rhythm: { chords: 'held', bass: 'held' } })
        const timers: ReturnType<typeof setTimeout>[] = []
        const start = now + 0.02
        // A bar at a time, each handed to the synths a moment ahead of its notes, so letting go stops it at the next note.
        const queue = (n: number) => {
          const barStart = start + n * barQuarters * quarter
          for (const h of bar) {
            const at = barStart + h.start * quarter
            const play = () => {
              if (h.pad.length) this.pad.triggerAttackRelease(h.pad.map(midiToHz), h.dur * quarter, at, h.velocity)
              if (h.bass !== null) {
                this.bass.attack(h.bass, at, 0.9)
                this.bassHolder = id
              }
            }
            const lead = (at - Tone.now() - 0.1) * 1000
            if (lead <= 0) play()
            else timers.push(setTimeout(play, lead))
          }
          timers.push(setTimeout(() => queue(n + 1), (barStart + barQuarters * quarter - Tone.now() - 0.3) * 1000))
        }
        queue(0)
        const stopThis = () => {
          clearTimeout(limit)
          timers.forEach(clearTimeout)
          if (this.bassHolder === id) this.bass.release(playNow())
          if (this.stopArp === stopThis) this.stopArp = null
        }
        this.stopArp = stopThis
        stop = stopThis
      }
      // Let go before the audio was ready (a quick tap, the first time): struck, then let go at once, as a tapped key is.
      if (released) stop()
    })()
    const release = () => {
      if (released) return
      released = true
      stop()
    }
    return release
  }
}

export const engine = new Engine()

// In a quiet moment after the page has loaded (and only where there's web audio to build on).
if (typeof window !== 'undefined' && 'AudioContext' in window) {
  const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1500))
  idle(() => engine.warmUp())
}

useStore.setState({ latency: measuredLatency() })

// Keep the loop in step with edits made while it plays.
const unsubscribe = useStore.subscribe((s, prev) => {
  // The arpeggiator's length and speed, and the tempo, set how quickly its notes fade.
  if (s.sound !== prev.sound || s.arp !== prev.arp || s.bpm !== prev.bpm) engine.setSound(playedSound(s.sound, s.arp, s.bpm))
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
    s.trims !== prev.trims ||
    s.vocalMuted !== prev.vocalMuted ||
    s.vocalSolo !== prev.vocalSolo ||
    s.chordsMuted !== prev.chordsMuted ||
    s.chordsSolo !== prev.chordsSolo ||
    s.drums !== prev.drums ||
    s.drumFill !== prev.drumFill ||
    s.drumIntensity !== prev.drumIntensity ||
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
    pass: (n) => useStore.getState().setRecordPass(n),
    rolling: () => {
      // A recording plays the open section.
      useStore.setState({ playingView: 'section', recordPass: s.loopOn ? 1 : null })
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
  if (result?.takes.length) {
    const { lane, takes } = result
    keepStorage()
    // Recording over a take can be undone, as deleting one can; takes recorded round the loop go together.
    if (s.takes[lane]) keepVocals()
    // The audio first, so it's there to store when the lane changes. Any take already there is kept, to go back to;
    // of several, the last one recorded plays.
    for (const take of takes) {
      engine.addTake(take)
      useStore.getState().addTake(lane, takeInfo(take))
    }
    s.showVocalTracks(lane + 1)
    tally('record')
  }
}

/** Lanes up to and including the last one with a take. */
const takeCount = (takes: readonly unknown[]) => takes.reduce<number>((n, t, lane) => (t ? lane + 1 : n), 0)

/** Deletes a vocal track and its take; the tracks after it move up, so they stay numbered 1, 2, 3… */
export async function deleteTake(lane: number) {
  const s = useStore.getState()
  const tracks = Math.max(s.vocalTracks, takeCount(s.takes))
  const name = vocalTrackName(s, lane)
  // Undo brings the track and its take back.
  keepVocals()
  quietly(() => s.renumberVocals(Array.from({ length: tracks }, (_, i) => i).filter((i) => i !== lane)))
  showUndoNote(`Deleted ${name}`)
}

/** Trims a take, or with null plays it whole again; undo puts the trim back as it was. */
/** A take's length in seconds, wherever it is in the open section. */
function takeSeconds(id: string) {
  const s = useStore.getState()
  return [...s.takes, ...s.allTakes.flat()].find((t) => t?.id === id)?.seconds ?? null
}

/** Trims a take, or with null plays it whole again; either way it keeps its nudge. */
export function trimTake(id: string, trim: Trim | null) {
  keepVocals()
  const s = useStore.getState()
  const nudge = s.trims[id]?.nudge
  const seconds = takeSeconds(id)
  if (trim) s.setTrim(id, nudge ? { ...trim, nudge } : trim)
  else s.setTrim(id, nudge && seconds !== null ? { start: 0, end: seconds, nudge } : null)
}

/**
 * Moves a take earlier (less than 0) or later by `nudge` seconds from where
 * it was recorded, keeping its trim; a step at a time undoes as one.
 */
let lastNudge = 0
export function nudgeTake(id: string, nudge: number) {
  const s = useStore.getState()
  const seconds = takeSeconds(id)
  if (seconds === null) return
  // Clicks in a row undo together.
  if (Date.now() - lastNudge > 1500) keepVocals()
  lastNudge = Date.now()
  const trim = s.trims[id]
  const kept = { start: trim?.start ?? 0, end: trim?.end ?? seconds }
  const cut = kept.start > 0.001 || kept.end < seconds - 0.001
  s.setTrim(id, Math.abs(nudge) < 0.0005 ? (cut ? kept : null) : { ...kept, nudge })
}

/**
 * Lines up new takes on this device as a nudge lined up this one: a take
 * moved earlier came in late, so the round trip is that much longer.
 */
export function learnFromNudge(nudge: number) {
  const latency = Math.max(0, expectedRoundTrip() - nudge)
  keepLatency(latency)
  useStore.getState().setLatency(latency)
}

/** Deletes one of a track's takes, keeping the track and its others; undo brings it back. */
export function deleteOneTake(lane: number, id: string) {
  const n = useStore.getState().allTakes[lane]?.findIndex((t) => t.id === id) ?? -1
  keepVocals()
  useStore.getState().dropTake(lane, id)
  showUndoNote(n >= 0 ? `Deleted take ${n + 1}` : 'Deleted a take')
}

/** Puts a whole song's takes in its sections, as when opening a saved sketch. */
export function loadSongTakes(takes: SectionTakes) {
  const s = useStore.getState()
  const known = new Set(s.sections.map((sec) => sec.id))
  for (const [section, lanes] of Object.entries(takes)) {
    if (!known.has(section)) continue
    s.setSectionTakes(
      section,
      lanes.map(({ take, all }) => {
        all.forEach((t) => engine.addTake(t))
        const infos = all.map(takeInfo)
        return { take: take ? (infos.find((t) => t.id === take.id) ?? null) : null, all: infos }
      }),
    )
  }
}

// Store each section's takes whenever they change: after recording,
// deleting a track or a section, or opening a sketch. Not until the last
// visit's takes are back, so an early change can't store an empty song over them.
let lanesLoaded = false
let storedLanes = ''
/** Whether the last store failed: said once, not on every change after it, and tried again when the takes next change. */
let storeFailed = false
const unsubscribeLanes = useStore.subscribe((s, prev) => {
  if (!lanesLoaded) return
  // Takes only change with these; anything else (a slider, play) is skipped without looking.
  if (s.takes === prev.takes && s.allTakes === prev.allTakes && s.sections === prev.sections) return
  const lanes = takeIdsBySection(s)
  const key = JSON.stringify(lanes)
  if (key === storedLanes) return
  storedLanes = key
  storeLanes(lanes, (id) => engine.takeAudio(id))
    .then(() => (storeFailed = false))
    .catch((error) => {
      console.error(error)
      if (storeFailed) return
      storeFailed = true
      window.alert(`Bounce couldn’t store your vocal tracks, so recent changes to them will be gone if the page reloads. ${storageErrorMessage(error)}`)
    })
})

// Bring back the takes from the last visit. Takes kept before sections go to the open section.
void loadLanes(useStore.getState().activeSection)
  .then((takes) => {
    const known = new Set(useStore.getState().sections.map((sec) => sec.id))
    // If the song itself was lost (cleared site data, say) the takes still go somewhere they can be heard.
    const stray = Object.entries(takes).find(([section, lanes]) => !known.has(section) && lanes.some((lane) => lane.take))
    if (stray && !Object.keys(takes).some((section) => known.has(section))) takes = { [useStore.getState().activeSection]: stray[1] }
    loadSongTakes(takes)
    storedLanes = JSON.stringify(takeIdsBySection(useStore.getState()))
  })
  .catch((error) => console.error(error))
  .finally(() => {
    lanesLoaded = true
  })

/** Plays a chord on its own: not while the song plays, unless asked for (the chord keys sound whenever they're pressed). */
export function audition(chord: Chord, always = false) {
  const s = useStore.getState()
  if (always || !s.playing) void engine.audition({ ...keyOf(s), timeSig: s.timeSig, bpm: s.bpm, arp: s.arp }, chord)
}

/** Sounds a chord while a key is held, even with the song playing; call what it returns to let go. */
export function holdChord(chord: Chord) {
  const s = useStore.getState()
  return engine.hold({ ...keyOf(s), timeSig: s.timeSig, bpm: s.bpm, arp: s.arp }, chord)
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
