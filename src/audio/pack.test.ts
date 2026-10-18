import { describe, expect, it } from 'vitest'
import { fromPlanes, pack, toPlanes, unpack } from './pack'
import { storedFromBytes } from './take'

const RATE = 48000

/** Something like a sung take: a voice with a few harmonics, drifting in pitch and loudness, a little room noise, and gaps between lines. */
function voiceLike(seconds: number) {
  const pcm = new Int16Array(seconds * RATE)
  let phase = 0
  let seed = 1
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2
  for (let i = 0; i < pcm.length; i++) {
    const t = i / RATE
    const singing = t % 4 < 3 // three seconds of a line, then a breath
    const pitch = 220 * (1 + 0.03 * Math.sin(2 * Math.PI * 5 * t)) * (1 + 0.25 * Math.floor((t % 4) * 2) / 6)
    phase += (2 * Math.PI * pitch) / RATE
    const loud = singing ? 0.35 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * t)) : 0
    const v = loud * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase) + 0.12 * Math.sin(5 * phase)) / 1.9
    pcm[i] = Math.round((v + 0.003 * noise()) * 32767)
  }
  return pcm
}

describe('packing recordings', () => {
  it('gives back the very same samples, extremes and all', async () => {
    const pcm = Int16Array.from([0, 1, -1, 32767, -32768, 32767, -32768, 0, 12345, -12345])
    expect(fromPlanes(toPlanes(pcm))).toEqual(pcm)
    expect(await unpack(await pack(pcm))).toEqual(pcm)
    const noise = Int16Array.from({ length: 5000 }, (_, i) => ((i * 2654435761) >>> 0) % 65536 - 32768)
    expect(await unpack(await pack(noise))).toEqual(noise)
  })

  it('makes a sung take a good deal smaller', async () => {
    const pcm = voiceLike(20)
    const packed = await pack(pcm)
    const ratio = packed.byteLength / pcm.byteLength
    console.info(`20 s voice-like take: ${(pcm.byteLength / 1e6).toFixed(2)} MB raw, ${(packed.byteLength / 1e6).toFixed(2)} MB packed (${Math.round(ratio * 100)}%)`)
    expect(ratio).toBeLessThan(0.75)
  })

  it('reads an upload back, packed or as the first ones were', async () => {
    const pcm = voiceLike(1)
    const head = { startBeat: 4, bpm: 96, sampleRate: RATE }
    const packed = await new Blob([JSON.stringify({ ...head, packed: 'delta-planes-gzip', samples: pcm.length }) + '\n', await pack(pcm)]).arrayBuffer()
    expect(await storedFromBytes(packed)).toEqual({ ...head, pcm })
    const raw = await new Blob([JSON.stringify(head) + '\n', pcm]).arrayBuffer()
    expect(await storedFromBytes(raw)).toEqual({ ...head, pcm })
  })

  it('turns down a packed upload cut short', async () => {
    const pcm = voiceLike(1)
    const body = await pack(pcm)
    const cut = await new Blob([JSON.stringify({ startBeat: 0, bpm: 96, sampleRate: RATE, packed: 'delta-planes-gzip', samples: pcm.length }) + '\n', body.subarray(0, body.length >> 1)]).arrayBuffer()
    expect(await storedFromBytes(cut)).toBeNull()
  })
})
