import { describe, expect, it, vi } from 'vitest'
import { monoStart, safely } from './audio/timing'

describe('monoStart', () => {
  it('keeps notes where they were asked for when they come in order', () => {
    const bass = {}
    expect(monoStart(bass, 1)).toBe(1)
    expect(monoStart(bass, 1.5)).toBe(1.5)
  })

  it('moves a note asked for at or before the last just after it', () => {
    const kick = {}
    expect(monoStart(kick, 2)).toBe(2)
    expect(monoStart(kick, 2)).toBeCloseTo(2.002)
    expect(monoStart(kick, 1.9)).toBeCloseTo(2.004)
  })

  it('keeps each instrument to itself', () => {
    const snare = {}
    const hat = {}
    monoStart(snare, 3)
    expect(monoStart(hat, 3)).toBe(3)
  })
})

describe('safely', () => {
  it('lets a failing note go without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const play = safely((time: number) => {
      if (time > 1) throw new Error('Start time must be strictly greater than previous start time')
    })
    expect(() => play(2)).not.toThrow()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
