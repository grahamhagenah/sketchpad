import { describe, expect, it } from 'vitest'
import { levelUpDb } from './take'

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

