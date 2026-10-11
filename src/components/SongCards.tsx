import { demoSong, type SongStart } from '../store'
import { keyLabel } from '../music/theory'
import { openSong, reportStorageError, startOwnSong } from '../library'
import { SONG_TEMPLATES } from '../songs'

interface Card {
  name: string
  about: string
  build: () => SongStart
}

const CARDS: Card[] = [
  { name: 'Demo song', about: 'Made in Bounce', build: demoSong },
  ...SONG_TEMPLATES.map((song) => ({ name: song.name, about: `Think “${song.think}”`, build: song.build })),
]

/** Each card's key and tempo, worked out once, the first time they're shown. */
let details: string[] | null = null
const detailsOf = () =>
  (details ??= CARDS.map((card) => {
    const { key, mode, bpm } = card.build()
    return `${keyLabel(key, mode)} ${mode} · ${bpm} BPM`
  }))

/**
 * In place of an empty song: a blank one to start, or ready-made songs to open and
 * play with, each a sketch of its own to change. The demo first, then songs
 * you'd know by their chords.
 */
export function SongCards() {
  const meta = detailsOf()
  return (
    <section className="song-cards" aria-labelledby="song-cards-title">
      <h2 className="song-cards-title" id="song-cards-title">
        Start your own, or try a ready-made song
      </h2>
      <p className="song-cards-about">Open a ready-made one to hear it, then make it yours: change the chords, the sound, record over it.</p>
      <div className="song-cards-grid">
        <button type="button" className="progression song-card is-own" onClick={() => void startOwnSong().catch(reportStorageError('start a new song'))}>
          <span className="progression-name">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Start your own song
          </span>
          <span className="song-card-about">A blank song with one section, ready for its first chords</span>
        </button>
        {CARDS.map((card, i) => (
          <button
            key={card.name}
            type="button"
            className="progression song-card"
            onClick={() => void openSong(card.build(), card.name).catch(reportStorageError('open that song'))}
          >
            <span className="progression-name">{card.name}</span>
            <span className="song-card-about">{card.about}</span>
            <span className="progression-numerals">{meta[i]}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
