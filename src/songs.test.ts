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
    expect(names('Mad World')).toEqual([
      ['Verse', 'Fm A♭ E♭ B♭ Fm A♭ E♭ B♭'],
      ['Chorus', 'Fm B♭ Fm B♭ Fm B♭ Fm B♭'],
    ])
    expect(names('Every Breath You Take')).toEqual([['Verse', 'A♭ Fm D♭ E♭ A♭ Fm D♭ E♭']])
    expect(names('Clocks')).toEqual([
      ['Intro', 'E♭ B♭m B♭m Fm E♭ B♭m B♭m Fm'],
      ['Verse', 'E♭ B♭m B♭m Fm E♭ B♭m B♭m Fm'],
    ])
    expect(names('I Feel Love')).toEqual([
      ['Groove', 'C C'],
      ['Shift', 'B♭'],
    ])
    expect(names('Hey Jude')).toEqual([
      ['Verse', 'F C C7 F B♭ F C7 F'],
      ['Outro', 'F E♭ B♭ F F E♭ B♭ F'],
    ])
    expect(names('With or Without You')).toEqual([
      ['Verse', 'D A Bm G D A Bm G'],
      ['Chorus', 'D A Bm G D A Bm G'],
    ])
    expect(names('Purple Rain')).toEqual([
      ['Verse', 'B♭add9 Gm7 F E♭maj7 B♭add9 Gm7 F E♭maj7'],
      ['Chorus', 'B♭add9 Gm7 F E♭maj7 B♭add9 Gm7 F E♭maj7'],
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

describe('the hyperpop song', () => {
  it('moves key from section to section', () => {
    const song = SONG_TEMPLATES.find((t) => t.name === 'Glitch hyperpop')!.build()
    const chords = song.sections.map((sec) => {
      const { key, mode } = sec.sectionKey ?? song
      return [sec.name, sec.chords.slice(0, sec.name === 'Verse' ? 5 : sec.name === 'Glitch' ? 4 : 6).map((c) => chordOf(key, mode, c).name).join(' ')]
    })
    expect(chords).toEqual([
      ['Verse', 'Eadd9 C G♯ Gsus2 Bsus4'],
      ['Chorus', 'E♭maj7 B♭/D A♭ Gm7 C G♭'],
      ['Glitch', 'Emadd9 Cmaj7 Asus4 B'],
      ['Last chorus', 'Emaj7 B/D♯ A G♯m7 C♯ G'],
    ])
  })
})
