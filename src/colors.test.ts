import { describe, expect, it } from 'vitest'
import { PALETTE } from './colors'
// The colours and tint amounts as the stylesheet has them, so what's checked is what's drawn.
import css from './index.css?raw'

const token = (name: string) => {
  const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1].trim()
  if (!value) throw new Error(`--${name} isn't in index.css`)
  return value
}
const percent = (name: string) => parseFloat(token(name)) / 100

type Rgb = [number, number, number]
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb
const mix = (a: Rgb, b: Rgb, amount: number): Rgb => a.map((x, i) => x * amount + b[i] * (1 - amount)) as Rgb
const luminance = (c: Rgb) => {
  const [r, g, b] = c.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const [raised, onTrack, line, bg] = ['raised', 'on-track', 'line-strong', 'bg'].map((n) => rgb(token(n)))

describe('track colours on regions', () => {
  // WCAG's minimums: 4.5 for text (the handle, hits and waveform are drawn in it too), 3 for the edge you have to see.
  it.each(PALETTE.map((c) => [c.label, c.hex]))('keep %s readable in every state', (_, hex) => {
    const colour = rgb(hex)
    for (const state of ['tint-fill', 'tint-hover', 'tint-active']) {
      const fill = mix(colour, raised, percent(state))
      expect(contrast(onTrack, fill), `dark text on ${state}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(mix(colour, line, percent('tint-edge')), bg), 'the edge against the page').toBeGreaterThanOrEqual(3)
  })
})
