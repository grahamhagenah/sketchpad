import { beforeEach, describe, expect, it } from 'vitest'
import { demoSong, isDirty, sketchSignature, useStore } from './store'

beforeEach(() => useStore.setState(useStore.getInitialState(), true))

describe('isDirty', () => {
  it('counts an empty song as nothing to keep', () => {
    expect(isDirty()).toBe(false)
  })

  it('counts a ready-made song nobody has changed as nothing to keep', () => {
    useStore.setState({ ...demoSong(), title: 'Demo song' })
    useStore.setState({ startSignature: sketchSignature(useStore.getState()) })
    expect(isDirty()).toBe(false)
  })

  it('counts a ready-made song once it changes as unsaved work', () => {
    useStore.setState({ ...demoSong(), title: 'Demo song' })
    useStore.setState({ startSignature: sketchSignature(useStore.getState()) })
    useStore.getState().addChord(0)
    expect(isDirty()).toBe(true)
    useStore.getState().setTitle('My demo')
    expect(isDirty()).toBe(true)
  })

  it('counts chords in a song that was never a ready-made one as unsaved work', () => {
    useStore.getState().addChord(0)
    expect(isDirty()).toBe(true)
  })
})
