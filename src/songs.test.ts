import { describe, expect, it } from 'vitest'
import { SONG_TEMPLATES } from './songs'
import { chordOf } from './music/theory'

const names = (think: string) => {
  const song = SONG_TEMPLATES.find((t) => t.think === think)!.build()
  return song.sections.map((sec) => [sec.name, sec.chords.map((c) => chordOf(song.key, song.mode, c).name).join(' ')])
}

describe('songs to start from', () => {
  it('play the chords they bring to mind', () => {
    expect(names('Sweet Dreams (Are Made of This)')).toEqual([['Verse', 'Cm A♭ G Cm A♭ G Cm A♭ G Cm A♭ G']])
    expect(names('Smells Like Teen Spirit')).toEqual([
      ['Verse', 'F B♭ A♭ D♭ F B♭ A♭ D♭ F B♭ A♭ D♭ F B♭ A♭ D♭'],
      ['Chorus', 'F B♭ A♭ D♭ F B♭ A♭ D♭ F B♭ A♭ D♭ F B♭ A♭ D♭'],
    ])
    expect(names('Hotel California')).toEqual([
      ['Verse', 'Bm F♯ A E G D Em F♯'],
      ['Chorus', 'G D F♯ Bm G D Em F♯'],
    ])
    expect(names('Despacito')).toEqual([
      ['Verse', 'Bm G D A Bm G D A'],
      ['Chorus', 'Bm G D A Bm G D A'],
    ])
    expect(names('Creep')).toEqual([
      ['Verse', 'G B C Cm G B C Cm'],
      ['Chorus', 'G B C Cm G B C Cm'],
    ])
  })

  it('give each section whole bars, and play every section', () => {
    for (const template of SONG_TEMPLATES) {
      const song = template.build()
      for (const sec of song.sections) expect(sec.chords.reduce((n, c) => n + c.beats, 0) % song.timeSig[0]).toBe(0)
      expect(new Set(song.arrangement.map((e) => e.section)).size).toBe(song.sections.length)
    }
  })
})
