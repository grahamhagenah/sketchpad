import { beforeEach, describe, expect, it } from 'vitest'
import { audibleTracks, loopRange, totalBeats, useStore } from './store'

describe('loopRange', () => {
  it('loops the whole progression when there is no region', () => {
    expect(loopRange(null, 16)).toEqual({ start: 0, end: 16 })
    expect(loopRange(null, 0)).toEqual({ start: 0, end: 1 })
  })

  it('keeps the region inside the progression, at least a beat long', () => {
    expect(loopRange({ start: 4, end: 8 }, 16)).toEqual({ start: 4, end: 8 })
    expect(loopRange({ start: 12, end: 20 }, 16)).toEqual({ start: 12, end: 16 })
    expect(loopRange({ start: 20, end: 24 }, 16)).toEqual({ start: 15, end: 16 })
    expect(loopRange({ start: 5, end: 5 }, 16)).toEqual({ start: 5, end: 6 })
  })
})

describe('audibleTracks', () => {
  const base = {
    chordsMuted: false,
    chordsSolo: false,
    vocalMuted: [false, false],
    vocalSolo: [false, false],
    takes: [{ id: 'a', startBeat: 0, bpm: 96, seconds: 1, peaks: [] }, null],
  }

  it('plays everything with a take by default', () => {
    expect(audibleTracks(base)).toEqual({ chords: true, vocals: [true, false] })
  })

  it('plays only soloed tracks once any is soloed', () => {
    expect(audibleTracks({ ...base, vocalSolo: [true, false] })).toEqual({ chords: false, vocals: [true, false] })
  })

  it('ignores a solo on a lane without a take', () => {
    expect(audibleTracks({ ...base, vocalSolo: [false, true] })).toEqual({ chords: true, vocals: [true, false] })
  })

  it('silences a muted track even when soloed', () => {
    expect(audibleTracks({ ...base, chordsSolo: true, chordsMuted: true })).toEqual({ chords: false, vocals: [false, false] })
  })
})

describe('setTimeSig', () => {
  beforeEach(() => {
    useStore.setState({ timeSig: [4, 4], loop: null })
    useStore.getState().loadProgression([0, 4, 5, 3], false)
  })

  it('keeps each chord the same number of bars', () => {
    useStore.getState().setTimeSig([3, 4])
    expect(useStore.getState().chords.map((c) => c.beats)).toEqual([3, 3, 3, 3])
    useStore.getState().setTimeSig([6, 8])
    expect(totalBeats(useStore.getState().chords)).toBe(24)
  })

  it('scales the loop region with it', () => {
    useStore.getState().setLoop({ start: 4, end: 12 })
    useStore.getState().setTimeSig([6, 8])
    expect(useStore.getState().loop).toEqual({ start: 6, end: 18 })
  })

  it('never shrinks a chord to nothing', () => {
    useStore.getState().setTimeSig([12, 8])
    useStore.getState().updateChord(useStore.getState().chords[0].id, { beats: 1 })
    useStore.getState().setTimeSig([4, 4])
    expect(useStore.getState().chords[0].beats).toBe(1)
  })
})
