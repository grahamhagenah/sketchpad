import * as Tone from 'tone'
import { useRecordPrefs } from '../recordPrefs'

// Gathers the microphone's input into blocks of about a sixth of a second
// and hands each to the page, with the audio clock's frame number of its
// first sample, so the recording can be lined up with the song. Handing over
// every 128-sample quantum as it came (hundreds of messages a second, each a
// fresh copy) loaded the audio thread and left the page a heap of small
// buffers to clear away, which in Safari made playback stutter mid-take; a
// block is handed over whole, without copying. It runs for as long as the
// microphone is open, keeping only what comes between 'start' and 'stop'.
const WORKLET = `
const BLOCK = 8192
class SketchpadCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.on = false
    this.closed = false
    this.block = new Float32Array(BLOCK)
    this.filled = 0
    this.frame = 0
    this.port.onmessage = (e) => {
      if (e.data === 'start') {
        this.on = true
        this.started = undefined
        this.filled = 0
        return
      }
      if (this.on) this.send()
      this.on = false
      if (e.data === 'close') this.closed = true
    }
  }
  send() {
    if (!this.filled) return
    const data = this.block.subarray(0, this.filled)
    this.port.postMessage({ frame: this.frame, data }, [this.block.buffer])
    this.block = new Float32Array(BLOCK)
    this.filled = 0
  }
  // Silence where the microphone gave nothing (its input can drop out for a
  // moment), so everything after stays in time with the song.
  write(samples, count) {
    let done = 0
    while (done < count) {
      const n = Math.min(count - done, BLOCK - this.filled)
      if (samples) this.block.set(samples.subarray(done, done + n), this.filled)
      else this.block.fill(0, this.filled, this.filled + n)
      this.filled += n
      done += n
      if (this.filled === BLOCK) this.send()
    }
  }
  process(inputs) {
    if (this.closed) return false
    if (!this.on) return true
    const channel = inputs[0] && inputs[0][0]
    if (this.started === undefined) {
      if (!channel) return true
      this.started = currentFrame
      this.next = currentFrame
    }
    if (!this.filled) this.frame = this.next
    // A gap since the last quantum (the audio thread fell behind) is filled too, up to a second.
    const gap = currentFrame - this.next
    if (gap > 0 && gap < sampleRate) this.write(null, gap)
    this.write(channel || null, 128)
    this.next = currentFrame + 128
    return true
  }
}
registerProcessor('sketchpad-capture', SketchpadCapture)
`

let workletLoaded: Promise<void> | null = null

/** Asks for the microphone, with the processing meant for calls turned off. */
/**
 * Why the microphone couldn't be opened, to tell the person. Browsers only
 * offer it on secure pages, so on plain http the fix is the https address.
 */
export function micProblem(doing: string) {
  if (!window.isSecureContext) {
    return `Browsers only allow the microphone on secure pages. To ${doing}, open Bounce at https://${location.host}${location.pathname}`
  }
  return `Bounce needs the microphone to ${doing}. Allow it in your browser’s site settings, then try again.`
}

export async function openMic() {
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  const { micId } = useRecordPrefs.getState()
  if (micId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: micId } } })
    } catch (error) {
      // The one picked is gone (unplugged, say): the browser's own, rather than none. Refused stays refused.
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw error
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio })
}

/** The microphones there are to pick from. Their names show only once the microphone has been allowed. */
export async function listMics(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
}

export interface Capture {
  /** Seconds the input lags behind real time, as the browser reports it. */
  inputLatency: number
  /** How loud the microphone is right now: its loudest sample over the last moment, 0 to 1. */
  level: () => number
  /** Stops recording; returns the samples and the audio-clock time of the first one. */
  stop: () => Promise<{ startTime: number; samples: Float32Array }>
}

/**
 * The microphone, open and running into the capture, which keeps nothing
 * until a take starts. Safari stops all its audio twice when it starts taking
 * input, for a few hundred milliseconds each: at once, and again about three
 * seconds later. Opened ahead of a take (when a vocal track is picked) and
 * left open between takes, that's over before anyone sings.
 */
interface Mic {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  node: AudioWorkletNode
  analyser: AnalyserNode
  /** The blocks of the take under way, as they arrive. */
  chunks: { frame: number; data: Float32Array }[]
  /** Your voice back to you, while singing, if you've asked to hear yourself (on headphones; on speakers it would feed back). */
  monitor: GainNode
}

let mic: Promise<Mic> | null = null
/** The microphone once it's open. */
let open: Mic | null = null
/** Whether to keep it open between takes: a vocal track is picked to record into. */
let wanted = false
/** A take (or a timing check) is using it. */
let capturing = false

async function openCapture(): Promise<Mic> {
  const ctx = Tone.getContext()
  workletLoaded ??= ctx.addAudioWorkletModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })))
  await workletLoaded
  const stream = await openMic()
  const source = ctx.createMediaStreamSource(stream)
  const node = ctx.createAudioWorkletNode('sketchpad-capture', { channelCount: 1, channelCountMode: 'explicit' })
  // The node only runs while it leads somewhere; it outputs silence.
  source.connect(node)
  node.connect(ctx.rawContext.destination)
  // A tap on the input, for the level meter; it leads nowhere and changes nothing that's recorded.
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const monitor = ctx.createGain()
  monitor.gain.value = 0
  source.connect(monitor)
  monitor.connect(ctx.rawContext.destination)
  const m: Mic = { stream, source, node, analyser, chunks: [], monitor }
  node.port.onmessage = (e) => m.chunks.push(e.data)
  // Unplugged, or taken away in the browser's settings: opened afresh next time.
  stream.getAudioTracks()[0]?.addEventListener('ended', () => shut(m))
  open = m
  openedAt = performance.now()
  return m
}

/** When the microphone last started running, by the page's clock. */
let openedAt = 0

/**
 * Safari stops all its audio twice when the microphone starts, at once and
 * about three seconds later. Opened when a vocal track is picked, that's
 * usually over by the time Record is pressed; pressed sooner (as just after
 * a reload, picking the track and recording at once), the first click of the
 * count-in went missing and the take stuttered as it began. Other browsers
 * need only a moment.
 */
const SETTLE_MS = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent) ? 3600 : 300

/** Waits until the microphone has been open long enough that starting it won't interrupt the take; at once if it has. */
export async function micSettled() {
  if (!open) return
  const left = openedAt + SETTLE_MS - performance.now()
  if (left > 0) await new Promise((r) => setTimeout(r, left))
}

/** Whether the microphone is still settling (see micSettled): Record waits, and says so. */
export const micSettling = () => !!open && performance.now() - openedAt < SETTLE_MS

/** The microphone, opening it if it isn't open; asked for afresh next time if it can't be (refused, say). */
function micNow() {
  if (!mic) {
    mic = openCapture()
    mic.catch(() => (mic = null))
  }
  return mic
}

function shut(m: Mic) {
  if (open !== m) return
  m.node.port.postMessage('close')
  m.source.disconnect()
  m.node.disconnect()
  m.analyser.disconnect()
  m.monitor.disconnect()
  m.stream.getTracks().forEach((t) => t.stop())
  open = null
  mic = null
}

/** Closes the microphone unless it's wanted or in use. */
function shutIfIdle() {
  if (!wanted && !capturing && open) shut(open)
}

/** Opens the microphone ahead of a take, and keeps it open until closeMic. Rejects if it can't be opened. */
export async function openMicEarly() {
  wanted = true
  try {
    await micNow()
  } catch (error) {
    wanted = false
    throw error
  }
  // Closed again while it was opening.
  shutIfIdle()
}

/** Your voice in your ears while a take is under way, if you've asked for it. */
function hearSelf(m: Mic, taking: boolean) {
  m.monitor.gain.value = taking && useRecordPrefs.getState().monitor ? 1 : 0
}

// Turned on or off mid-take, it's heard (or not) at once; another microphone picked, the open one is swapped for it between takes.
useRecordPrefs.subscribe((prefs, before) => {
  if (open && capturing) hearSelf(open, true)
  if (prefs.micId !== before.micId && open && !capturing) {
    shut(open)
    if (wanted) void micNow().catch(() => undefined)
  }
})

/** Closes the microphone, or once the take using it ends. */
export function closeMic() {
  wanted = false
  shutIfIdle()
}

/** Starts keeping the microphone's input, opening it first if it isn't open. */
export async function startCapture(): Promise<Capture> {
  const ctx = Tone.getContext()
  capturing = true
  let m: Mic
  try {
    m = await micNow()
  } catch (error) {
    capturing = false
    throw error
  }
  m.chunks = []
  m.node.port.postMessage('start')
  // Heard while singing, if asked for; silent again when the take stops.
  hearSelf(m, true)
  const track = m.stream.getAudioTracks()[0]
  const settings = track?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined
  const frame = new Float32Array(m.analyser.fftSize)

  return {
    inputLatency: settings?.latency ?? 0,
    level: () => {
      m.analyser.getFloatTimeDomainData(frame)
      let peak = 0
      for (let i = 0; i < frame.length; i++) peak = Math.max(peak, Math.abs(frame[i]))
      return Math.min(1, peak)
    },
    stop: async () => {
      m.node.port.postMessage('stop')
      hearSelf(m, false)
      // Let the last block arrive.
      await new Promise((r) => setTimeout(r, 100))
      const chunks = m.chunks
      m.chunks = []
      capturing = false
      // Kept open for the next take while a vocal track is picked; otherwise closed now.
      shutIfIdle()

      const length = chunks.reduce((n, c) => n + c.data.length, 0)
      const samples = new Float32Array(length)
      let offset = 0
      for (const c of chunks) {
        samples.set(c.data, offset)
        offset += c.data.length
      }
      return { startTime: chunks.length ? chunks[0].frame / ctx.sampleRate : 0, samples }
    },
  }
}

/** Seconds between the audio clock and sound actually leaving the speakers. */
function outputLatency() {
  const raw = Tone.getContext().rawContext as AudioContext
  return (raw.outputLatency || 0) + (raw.baseLatency || 0)
}

// ---- Measuring the round trip ----

const LATENCY_KEY = 'bounce-latency'

/**
 * The round trip measured on this device, in seconds: from when a sound is
 * scheduled to when the microphone's copy of it is captured. It's kept apart
 * from the song, since it belongs to the device, not the sketch.
 */
export function measuredLatency(): number | null {
  try {
    const value = Number(localStorage.getItem(LATENCY_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export function keepLatency(seconds: number) {
  try {
    localStorage.setItem(LATENCY_KEY, String(seconds))
  } catch {
    // Not kept; the browser's own estimate is used instead.
  }
}

/** The round trip new takes are lined up by when the input's own lag isn't known: measured, or the output's as the browser reports it. */
export const expectedRoundTrip = () => measuredLatency() ?? outputLatency()

/** How far the take must be moved to line up with the beat: the measured round trip, or the browser's estimate. */
export function roundTrip(capture: Pick<Capture, 'inputLatency'>) {
  return measuredLatency() ?? outputLatency() + capture.inputLatency
}

/**
 * Where each click was heard in a recording, as seconds after it was played,
 * and the middle of them, or null when too few were heard clearly or they
 * disagree. Each click is looked for in the time before the next one.
 */
export function findClicks(samples: Float32Array, sampleRate: number, startTime: number, clicks: number[], window: number) {
  const at = (time: number) => Math.round((time - startTime) * sampleRate)
  // How loud the room is before the first click.
  let floor = 0
  for (let i = Math.max(0, at(clicks[0]) - Math.round(0.2 * sampleRate)); i < Math.max(0, at(clicks[0])); i++) floor = Math.max(floor, Math.abs(samples[i]))

  const heard: number[] = []
  for (const time of clicks) {
    const from = Math.max(0, at(time))
    const to = Math.min(samples.length, at(time + window))
    let peak = 0
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]))
    if (peak < Math.max(0.02, floor * 4)) continue
    // Its start: the first sample at half the click's peak.
    for (let i = from; i < to; i++) {
      if (Math.abs(samples[i]) >= peak / 2) {
        heard.push((i - from) / sampleRate)
        break
      }
    }
  }
  if (heard.length < Math.ceil(clicks.length * 0.6)) return null
  heard.sort((a, b) => a - b)
  const middle = heard[Math.floor(heard.length / 2)]
  // Most should agree within a few milliseconds.
  const agreeing = heard.filter((h) => Math.abs(h - middle) < 0.008)
  return agreeing.length >= Math.ceil(clicks.length * 0.5) ? middle : null
}

/**
 * Plays a few clicks and listens for them on the microphone, to measure how
 * late recordings arrive on this device, and keeps the result. Resolves to the
 * round trip in seconds, or null if the clicks couldn't be heard clearly.
 */
export async function measureLatency(): Promise<number | null> {
  await Tone.start()
  const capture = await startCapture()
  const click = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 } }).toDestination()
  const COUNT = 8
  const GAP = 0.45
  const first = Tone.now() + 0.4
  const clicks = Array.from({ length: COUNT }, (_, i) => first + i * GAP)
  clicks.forEach((time) => click.triggerAttackRelease('A5', 0.02, time, 1))
  await new Promise((r) => setTimeout(r, (first + COUNT * GAP + 0.3 - Tone.immediate()) * 1000))
  const { startTime, samples } = await capture.stop()
  click.dispose()
  const latency = findClicks(samples, Tone.getContext().sampleRate, startTime, clicks, GAP - 0.05)
  if (latency !== null) keepLatency(latency)
  return latency
}
