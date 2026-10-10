import { describe, expect, it } from 'vitest'
import { changedFrom, extrasOf, PRESETS, presetFor } from './sound'

const preset = (name: string) => PRESETS.find((p) => p.name === name)!.sound

describe('sound extras', () => {
  it('fills in what older sounds don’t have as they sounded then: no effects, the usual width', () => {
    expect(extrasOf(preset('Synth'))).toEqual({ width: 0.36, resonance: 0, delay: 0, delayTime: '1/8.', chorus: 0, drive: 0 })
    expect(extrasOf(preset('Strings')).width).toBe(0.5)
  })

  it('counts an effect as a change from the preset, so it can be reset', () => {
    const pad = preset('Pad')
    expect(changedFrom({ ...pad }, pad)).toBe(false)
    expect(changedFrom({ ...pad, delay: 0.4 }, pad)).toBe(true)
    expect(changedFrom({ ...pad, width: 0.9 }, pad)).toBe(true)
    // Still known as the preset it started from.
    expect(presetFor({ ...pad, chorus: 0.5, preset: 'Pad' })).toBe('Pad')
  })
})
