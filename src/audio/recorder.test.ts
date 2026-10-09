import { describe, expect, it } from 'vitest'
import { findClicks } from './recorder'

const RATE = 8000

/** A recording starting at `start`, with a short burst `delay` seconds after each click (or none where `heard` says so). */
function recording(start: number, clicks: number[], delay: number, { heard = () => true, noise = 0 }: { heard?: (i: number) => boolean; noise?: number } = {}) {
  const samples = new Float32Array(Math.ceil((clicks[clicks.length - 1] + 1 - start) * RATE))
  let seed = 1
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 16807) % 2147483647
    samples[i] = noise * (seed / 2147483647 - 0.5)
  }
  clicks.forEach((time, i) => {
    if (!heard(i)) return
    const at = Math.round((time + delay - start) * RATE)
    for (let j = 0; j < 40; j++) samples[at + j] += 0.6 * Math.exp(-j / 10) * (j % 2 ? -1 : 1)
  })
  return samples
}

const clicks = Array.from({ length: 8 }, (_, i) => 1 + i * 0.45)

describe('findClicks', () => {
  it('finds how long after each click it was heard', () => {
    const latency = findClicks(recording(0.5, clicks, 0.18), RATE, 0.5, clicks, 0.4)
    expect(latency).toBeCloseTo(0.18, 2)
  })

  it('copes with a little room noise and a missed click', () => {
    const latency = findClicks(recording(0.5, clicks, 0.042, { noise: 0.01, heard: (i) => i !== 3 }), RATE, 0.5, clicks, 0.4)
    expect(latency).toBeCloseTo(0.042, 2)
  })

  it('gives up when the clicks can’t be heard', () => {
    expect(findClicks(recording(0.5, clicks, 0.1, { heard: () => false, noise: 0.01 }), RATE, 0.5, clicks, 0.4)).toBeNull()
  })
})
