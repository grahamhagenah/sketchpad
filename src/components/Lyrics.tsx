import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PART_KEYS, sectionsNow, useFields, useStore } from '../store'
import { engine } from '../audio/engine'
import { songSpans } from '../song'
import { setLyricsOpen, toggleLyrics, useLyricsPanel } from '../lyricsPanel'
import { CloseButton, TrackSheet } from './TrackSheet'
import { useToolSheet } from './SoundPanel'

/** A sheet of lines, for the lyrics. */
const LYRICS_ICON = 'M6 3h9l4 4v14H6zM9 10h7M9 14h7M9 18h4'

const LyricsIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={LYRICS_ICON} />
  </svg>
)

/** Shows or hides the lyrics, from the end of the tab strip. */
export function LyricsButton() {
  const open = useLyricsPanel((s) => s.open)
  return (
    <button
      type="button"
      className={`icon-btn lyrics-btn tab-tool-btn ${open ? 'is-on' : ''}`}
      // On a phone it opens and closes the lyrics' sheet itself, so a tap on it isn't a tap outside the sheet.
      data-sheet-toggle
      aria-pressed={open}
      aria-label="Lyrics"
      title={open ? 'Hide the lyrics' : 'Show the lyrics'}
      onClick={() => {
        // One sheet at a time along the bottom of a phone: the lyrics take the sound's or arpeggiator's place.
        if (!open) useToolSheet.setState({ open: null })
        toggleLyrics()
      }}
    >
      <LyricsIcon />
      {/* Named beside its icon on a wider screen, as the section's menu is; a phone shows the icon alone. */}
      <span className="tab-tool-label" aria-hidden="true">
        Lyrics
      </span>
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
 * then any not in the song yet), each under its name. A section that plays
 * more than once has its words written once. The open section is marked, and
 * while the song plays, the section playing lights up and scrolls into view.
 * Beside the editor on a wider screen; in a sheet along the bottom on a phone.
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
  const playingId = usePlayingSection()
  const blocks = useRef(new Map<string, HTMLElement>())
  useEffect(() => {
    if (playingId) blocks.current.get(playingId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [playingId])

  const body = ordered.map((sec) => {
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
            <LyricLines id={field} label={`${sec.name} lyrics`} value={sec.lyrics} onChange={(text) => s.setLyrics(sec.id, text)} />
          </section>
        )
      })

  // On a phone, a sheet along the bottom like the sound's and the tracks' settings: dragged down or tapped outside, it's put away.
  if (sheet) {
    return (
      <TrackSheet name="Lyrics" icon={<LyricsIcon />} onDone={() => setLyricsOpen(false)} dismiss>
        <div className="lyrics-sheet">{body}</div>
      </TrackSheet>
    )
  }
  return (
    <aside className="lyrics-panel" aria-label="Lyrics">
      <div className="lyrics-head">
        <span className="column-title">Lyrics</span>
        <CloseButton onClick={() => setLyricsOpen(false)} title="Hide the lyrics" />
      </div>
      {body}
    </aside>
  )
}

/** A section's words, written straight on the page: long lines wrap, and it grows to fit what's written. */
function LyricLines({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return <textarea ref={ref} id={id} className="lyrics-text" aria-label={label} value={value} rows={1} spellCheck placeholder="Write the words…" onChange={(e) => onChange(e.target.value)} />
}
