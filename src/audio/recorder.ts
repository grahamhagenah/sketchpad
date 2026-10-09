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
