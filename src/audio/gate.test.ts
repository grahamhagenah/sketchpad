import { describe, expect, it } from 'vitest'
import { gateQuiet, hasSinging, levelUpDb } from './take'

const RATE = 48000
let seed = 7
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2

/** The room: a steady hiss, with the song leaking in from the speakers as a soft tick every half second. */
function room(seconds: number, hiss = 0.002, leak = 0.004) {
  const out = new Float32Array(seconds * RATE)
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE
    const tick = t % 0.5 < 0.03 ? leak * Math.sin(2 * Math.PI * 1000 * t) : 0
    out[i] = hiss * noise() + tick
  }
  return out
}

/** The room, with lines sung over it: `lines` of [start, end] seconds. */
function sung(seconds: number, lines: [number, number][]) {
  const out = room(seconds)
  for (const [from, to] of lines) for (let i = Math.round(from * RATE); i < to * RATE; i++) out[i] += 0.25 * Math.sin((2 * Math.PI * 220 * i) / RATE)
  return out
}

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let sum = 0
  for (let i = from; i < to; i++) sum += x[i] * x[i]
  return Math.sqrt(sum / (to - from))
}
const db = (a: number, b: number) => 20 * Math.log10(a / b)
const at = (s: number) => Math.round(s * RATE)

describe('a take with nothing sung', () => {
  it('isn’t turned up, so the hiss stays quiet', () => {
    const take = room(6)
    expect(hasSinging(take, RATE)).toBe(false)
    expect(levelUpDb(take, RATE)).toBe(0)
  })

  it('has its hiss and the song’s leak turned well down', () => {
    const take = room(6)
    expect(db(rms(gateQuiet(take, RATE)), rms(take))).toBeLessThan(-18)
  })
})

describe('a sung take', () => {
  const take = sung(8, [[1, 3], [4, 6.5]])
  const gated = gateQuiet(take, RATE)

  it('is still turned up to a steady level', () => {
    expect(hasSinging(take, RATE)).toBe(true)
  })

  it('keeps its singing as it was', () => {
    expect(Math.abs(db(rms(gated, at(1.2), at(2.8)), rms(take, at(1.2), at(2.8))))).toBeLessThan(0.5)
    expect(Math.abs(db(rms(gated, at(4.2), at(6.3)), rms(take, at(4.2), at(6.3))))).toBeLessThan(0.5)
  })

  it('doesn’t clip the start of a line', () => {
    expect(db(rms(gated, at(1), at(1.02)), rms(take, at(1), at(1.02)))).toBeGreaterThan(-1)
  })

  it('turns down the room between and after the lines', () => {
    expect(db(rms(gated, at(3.5), at(3.9)), rms(take, at(3.5), at(3.9)))).toBeLessThan(-18)
    expect(db(rms(gated, at(7.2), at(8)), rms(take, at(7.2), at(8)))).toBeLessThan(-18)
  })
})
