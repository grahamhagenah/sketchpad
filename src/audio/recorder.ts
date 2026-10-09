import * as Tone from 'tone'

// Hands every block of microphone input to the page along with the audio
// clock's frame number, so the recording can be lined up with the song.
const WORKLET = `
class SketchpadCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.on = true
    this.port.onmessage = () => { this.on = false }
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && this.on) this.port.postMessage({ frame: currentFrame, data: channel.slice(0) })
    return this.on
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

export function openMic() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
}

export interface Capture {
  /** Seconds the input lags behind real time, as the browser reports it. */
  inputLatency: number
  /** Stops recording; returns the samples and the audio-clock time of the first one. */
  stop: () => Promise<{ startTime: number; samples: Float32Array }>
}

export async function startCapture(stream: MediaStream): Promise<Capture> {
  const ctx = Tone.getContext()
  workletLoaded ??= ctx.addAudioWorkletModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })))
  await workletLoaded

  const source = ctx.createMediaStreamSource(stream)
  const node = ctx.createAudioWorkletNode('sketchpad-capture', { channelCount: 1, channelCountMode: 'explicit' })
  // The node only runs while it leads somewhere; it outputs silence.
  source.connect(node)
  node.connect(ctx.rawContext.destination)

  const chunks: { frame: number; data: Float32Array }[] = []
  node.port.onmessage = (e) => chunks.push(e.data)

  const settings = stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number }

  return {
    inputLatency: settings?.latency ?? 0,
    stop: async () => {
      node.port.postMessage('stop')
      // Let the last blocks arrive.
      await new Promise((r) => setTimeout(r, 60))
      source.disconnect()
      node.disconnect()
      stream.getTracks().forEach((t) => t.stop())

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
export function outputLatency() {
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

function keepLatency(seconds: number) {
  try {
    localStorage.setItem(LATENCY_KEY, String(seconds))
  } catch {
    // Not kept; the browser's own estimate is used instead.
  }
}

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
  const stream = await openMic()
  const capture = await startCapture(stream)
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
