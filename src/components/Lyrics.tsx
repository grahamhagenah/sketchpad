import { useEffect, useRef, useState } from 'react'
import { PART_KEYS, sectionsNow, useFields, useStore } from '../store'
import { chordOf } from '../music/theory'
import { lineSyllables } from '../music/lyrics'
import { engine } from '../audio/engine'
import { songSpans } from '../song'
import { setLyricsOpen, toggleLyrics, useLyricsPanel } from '../lyricsPanel'
import { CloseButton } from './TrackSheet'

/** A sheet of lines, for the lyrics. */
const LYRICS_ICON = 'M6 3h9l4 4v14H6zM9 10h7M9 14h7M9 18h4'

/** Shows or hides the lyrics, from the end of the tab strip. */
export function LyricsButton() {
  const open = useLyricsPanel((s) => s.open)
  return (
    <button type="button" className={`icon-btn lyrics-btn ${open ? 'is-on' : ''}`} aria-pressed={open} aria-label="Lyrics" title={open ? 'Hide the lyrics' : 'Show the lyrics'} onClick={toggleLyrics}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={LYRICS_ICON} />
      </svg>
    </button>
  )
}

/** Which section is playing now, while anything plays: the open one, or wherever the song has got to. */
function usePlayingSection() {
  const playing = useStore((s) => s.playing)
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    if (!playing) {
      setId(null)
      return
    }
    let raf = 0
    const frame = () => {
      const s = useStore.getState()
      const beat = engine.position()
      if (beat === null) setId(null)
      else if (s.playingView === 'section') setId(s.activeSection)
      else setId(songSpans(s).find((span) => span.beats && beat >= span.start && beat < span.start + span.beats)?.entry.section ?? null)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing])
  return id
}

/**
 * The song's words, section by section in the order they first play (and
 * then any not in the song yet), each under its name, letter and chords, with
 * how many syllables each line has beside it. A section that plays more than
 * once has its words written once. The open section is marked, and while the
 * song plays, the section playing lights up and scrolls into view. Beside the
 * editor on a wider screen; over it, on a phone.
 */
export function LyricsPanel({ sheet = false }: { sheet?: boolean }) {
  const s = useFields(...PART_KEYS, 'sections', 'activeSection', 'arrangement', 'view', 'key', 'mode', 'openSection', 'setLyrics', 'recording')
  const sections = sectionsNow(s)
  const firstPlays = new Map<string, number>()
  const uses = new Map<string, number>()
  s.arrangement.forEach((entry, i) => {
    if (!firstPlays.has(entry.section)) firstPlays.set(entry.section, i)
    uses.set(entry.section, (uses.get(entry.section) ?? 0) + 1)
  })
  const ordered = [...sections].sort((x, y) => (firstPlays.get(x.id) ?? Infinity) - (firstPlays.get(y.id) ?? Infinity))
  // The letters the song view gives each section, as A B A B C B.
  const letters = new Map([...firstPlays.keys()].map((id, i) => [id, String.fromCharCode(65 + (i % 26))]))
  const playingId = usePlayingSection()
  const blocks = useRef(new Map<string, HTMLElement>())
  useEffect(() => {
    if (playingId) blocks.current.get(playingId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [playingId])

  return (
    <aside className={`lyrics-panel ${sheet ? 'is-sheet' : ''}`} aria-label="Lyrics">
      <div className="lyrics-head">
        <span className="column-title">Lyrics</span>
        <CloseButton onClick={() => setLyricsOpen(false)} title="Hide the lyrics" />
      </div>
      {ordered.map((sec) => {
        const { key, mode } = sec.sectionKey ?? { key: s.key, mode: s.mode }
        const chords = sec.chords.map((c) => chordOf(key, mode, c).name).join('  ')
        const times = uses.get(sec.id) ?? 0
        const open = s.view === 'section' && sec.id === s.activeSection
        const field = `lyrics-${sec.id}`
        return (
          <section
            key={sec.id}
            ref={(el) => {
              if (el) blocks.current.set(sec.id, el)
              else blocks.current.delete(sec.id)
            }}
            className={`lyrics-section ${open ? 'is-open' : ''} ${sec.id === playingId ? 'is-playing' : ''}`}
          >
            <div className="lyrics-section-head">
              {letters.has(sec.id) && (
                <span className="song-row-letter" aria-hidden="true">
                  {letters.get(sec.id)}
                </span>
              )}
              <button
                type="button"
                className="lyrics-section-name"
                title={s.view === 'section' ? `Open ${sec.name} and write its words` : `Write ${sec.name}’s words`}
                onClick={() => {
                  // In the section view the section opens too, its chords beside its words.
                  if (s.view === 'section' && s.recording === 'off') s.openSection(sec.id)
                  document.getElementById(field)?.focus()
                }}
              >
                {sec.name}
              </button>
              <span className="lyrics-section-plays">{times === 0 ? 'Not in the song' : times > 1 ? `Plays ${times}×` : ''}</span>
            </div>
            {chords && <p className="lyrics-chords">{chords}</p>}
            <LyricLines id={field} label={`${sec.name} lyrics`} value={sec.lyrics} onChange={(text) => s.setLyrics(sec.id, text)} />
          </section>
        )
      })}
    </aside>
  )
}

/**
 * A section's words, a line to each line (long lines scroll rather than wrap,
 * so each keeps its own row), with each line's syllables counted beside it.
 */
function LyricLines({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (text: string) => void }) {
  const lines = value.split('\n')
  return (
    <div className="lyrics-lines" style={{ ['--lines' as string]: Math.max(2, lines.length) }}>
      <textarea id={id} aria-label={label} value={value} wrap="off" spellCheck placeholder="Write the words…" onChange={(e) => onChange(e.target.value)} />
      <div className="lyrics-counts" aria-hidden="true" title="Syllables in each line">
        {lines.map((line, i) => (
          <span key={i}>{lineSyllables(line) || ''}</span>
        ))}
      </div>
    </div>
  )
}
