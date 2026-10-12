import { describe, expect, it } from 'vitest'
import { bassVoiceOf, DEFAULT_SOUND, hasTone } from './sound'

describe('bassVoiceOf', () => {
  it('gives a sound saved before the bass could change the round bass it had', () => {
    expect(bassVoiceOf(DEFAULT_SOUND)).toEqual({ kind: 'round', octave: 0, tone: 0.5, glide: 0, level: 0 })
  })

  it('keeps what a sound says, filling in the rest', () => {
    expect(bassVoiceOf({ ...DEFAULT_SOUND, bassVoice: { kind: 'acid', glide: 0.4 } })).toEqual({ kind: 'acid', octave: 0, tone: 0.5, glide: 0.4, level: 0 })
  })

  it('has no tone to change on the sine basses', () => {
    expect(hasTone('sub')).toBe(false)
    expect(hasTone('808')).toBe(false)
    expect(hasTone('acid')).toBe(true)
  })
})

describe('newSketchSound', () => {
  it('is the electric piano as it comes, with the bass on', async () => {
    const { newSketchSound, presetFor, changedFrom, PRESETS } = await import('./sound')
    const sound = newSketchSound()
    expect(presetFor(sound)).toBe('E-piano')
    expect(changedFrom(sound, PRESETS.find((p) => p.name === 'E-piano')!.sound)).toBe(false)
    expect(sound.bass).toBe(true)
    expect(sound.bassVoice).toBeUndefined()
  })
})
