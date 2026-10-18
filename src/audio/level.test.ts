import { describe, expect, it } from 'vitest'
import { concealDropouts, levelUpDb, storedFromBytes } from './take'

const RATE = 48000

/** A tone at `amplitude`, `seconds` long, then as long again of silence (the gap after a line). */
function sung(amplitude: number, seconds = 1, gap = seconds) {
  const out = new Float32Array(Math.round((seconds + gap) * RATE))
  for (let i = 0; i < seconds * RATE; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE)
  return out
}
const dB = (amplitude: number) => 20 * Math.log10(amplitude / Math.SQRT2)

describe('levelling a take', () => {
  it('raises a quiet take to the target, going by the singing, not the silence between', () => {
    // Sung at -40 dB RMS, with as much silence again: raised the 18 dB it's allowed, not more.
    expect(levelUpDb(sung(0.01414), RATE)).toBeCloseTo(18, 1)
    // At -30 dB: 10 dB up to -20.
    const amp = 0.0447
    expect(levelUpDb(sung(amp), RATE)).toBeCloseTo(-20 - dB(amp), 1)
  })

  it('never turns a take down', () => {
    expect(levelUpDb(sung(0.9), RATE)).toBe(0)
  })

  it('leaves silence alone', () => {
    expect(levelUpDb(new Float32Array(RATE), RATE)).toBe(0)
    expect(levelUpDb(new Float32Array(0), RATE)).toBe(0)
  })
})

describe('smoothing over dropouts', () => {
  const voice = (seconds: number) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE))

  it('fills a block or two of lost input inside singing, without a jump at either edge', () => {
    const take = voice(0.2)
    take.fill(0, 4800, 4800 + 256)
    expect(concealDropouts(take)).toBe(1)
    const gap = take.subarray(4800, 4800 + 256)
    expect(gap.some((x) => x !== 0)).toBe(true)
    // Each edge meets its neighbour about as smoothly as the voice moves from sample to sample.
    const step = 0.3 * 2 * Math.PI * 220 / RATE
    expect(Math.abs(take[4800] - take[4799])).toBeLessThan(step * 2)
    expect(Math.abs(take[4800 + 256] - take[4800 + 255])).toBeLessThan(step * 2)
  })

  it('leaves real silence alone: a pause between lines, or quiet either side', () => {
    const pause = voice(1)
    pause.fill(0, 10000, 10000 + RATE / 2)
    expect(concealDropouts(pause)).toBe(0)
    const quiet = new Float32Array(RATE / 10)
    expect(concealDropouts(quiet)).toBe(0)
  })
})

describe('a recording as bytes, for the cloud', () => {
  it('reads back what it was', async () => {
    const pcm = Int16Array.from([0, 1200, -32767, 32767, 5])
    const bytes = await new Blob([JSON.stringify({ startBeat: 4, bpm: 96, sampleRate: 48000 }) + '\n', pcm]).arrayBuffer()
    expect(storedFromBytes(bytes)).toEqual({ startBeat: 4, bpm: 96, sampleRate: 48000, pcm })
  })

  it('turns down what isn’t a recording', () => {
    expect(storedFromBytes(new TextEncoder().encode('not a take').buffer)).toBeNull()
    expect(storedFromBytes(new TextEncoder().encode('{"bpm":1}\n').buffer)).toBeNull()
  })
})
