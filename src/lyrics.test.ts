import { beforeEach, describe, expect, it } from 'vitest'
import { sectionsNow, sketchSignature, songOf, songState, useStore } from './store'
import { clearHistory, undo } from './history'

const s = () => useStore.getState()
const lyricsOf = (name: string) => sectionsNow(s()).find((sec) => sec.name === name)?.lyrics

describe('lyrics', () => {
  beforeEach(() => {
    useStore.setState({ ...songState({ sections: [{ name: 'Verse' }, { name: 'Chorus' }] }), recording: 'off' })
    clearHistory()
  })

  it('keeps each section’s words, open or not, and saves them with the song', () => {
    const [verse, chorus] = s().sections
    s().setLyrics(verse.id, 'First line\nSecond line')
    s().setLyrics(chorus.id, 'Hook')
    expect(s().lyrics).toBe('First line\nSecond line')
    expect(lyricsOf('Chorus')).toBe('Hook')
    expect(songOf(s()).sections.map((sec) => sec.lyrics)).toEqual(['First line\nSecond line', 'Hook'])
    // Opening the chorus brings its words to the top, and puts the verse's back.
    s().openSection(chorus.id)
    expect(s().lyrics).toBe('Hook')
    expect(lyricsOf('Verse')).toBe('First line\nSecond line')
  })

  it('count as a change to the sketch', () => {
    const before = sketchSignature(s())
    s().setLyrics(s().activeSection, 'New words')
    expect(sketchSignature(s())).not.toBe(before)
  })

  it('stay as they are when undo takes back a change to the chords', () => {
    s().loadProgression([0, 4], false)
    s().setLyrics(s().activeSection, 'Written after')
    s().setLyrics(s().sections[1].id, 'Chorus words')
    undo()
    expect(s().chords).toEqual([])
    expect(s().lyrics).toBe('Written after')
    expect(lyricsOf('Chorus')).toBe('Chorus words')
  })

  it('go along with a duplicated section', () => {
    s().setLyrics(s().activeSection, 'Same words')
    s().duplicateSection(s().activeSection)
    expect(sectionsNow(s()).map((sec) => sec.lyrics)).toEqual(['Same words', 'Same words', ''])
  })

  it('load as empty from a sketch saved before there were lyrics', () => {
    expect(songState({ sections: [{ name: 'Old' }] }).lyrics).toBe('')
  })
})
