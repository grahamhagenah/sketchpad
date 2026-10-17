import { useEffect } from 'react'
import { keyOf, useFields } from '../store'
import { findKeys, type KeyGuess } from '../music/findKey'
import { keyLabel, noteName, type Mode } from '../music/theory'
import { playNote } from '../audio/engine'
import { useKeyFinder } from '../keyFinder'
import { MenuButton } from './Sections'
import { Icon } from './Toolbar'
import { TrackSheet } from './TrackSheet'
import { useToolSheet } from './SoundPanel'
import { setLyricsOpen } from '../lyricsPanel'
import { useNarrow } from '../hooks/useNarrow'

/** The notes it takes before it says what key they're in. */
const ENOUGH = 3
/** A note's key on the computer keyboard, as a piano lies along it in most music apps: A to J white, W E T Y U black. */
const TYPED = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ']
const WHITE = [0, 2, 4, 5, 7, 9, 11]
const BLACK = [1, 3, 6, 8, 10]
/** Where each black key sits, in white keys from the left: between the two it's between. */
const BLACK_AT: Record<number, number> = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 }

const SEARCH = 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20'

/** Beside the lyrics: finds the key of a tune from its notes, in a panel under it, or on a phone in the sheet along the bottom. */
export function KeyFinderButton() {
  const narrow = useNarrow()
  const sheet = useToolSheet((s) => s.open === 'key')
  if (narrow) {
    return (
      <button
        type="button"
        className={`icon-btn tab-tool-btn key-finder-btn ${sheet ? 'is-on' : ''}`}
        // It opens and closes the sheet itself, so a tap on it isn't a tap outside the sheet.
        data-sheet-toggle
        aria-label="Find the key"
        aria-expanded={sheet}
        title="Find the key of a tune from its notes"
        onClick={() => {
          // One sheet at a time along the bottom: the key finder takes the lyrics' (or the sound's) place.
          if (!sheet) setLyricsOpen(false)
          useToolSheet.setState({ open: sheet ? null : 'key' })
        }}
      >
        <Icon d={SEARCH} />
      </button>
    )
  }
  return (
    <MenuButton
      label="Find the key"
      title="Find the key of a tune from its notes"
      className="icon-btn tab-tool-btn key-finder-btn"
      align="right"
      role="dialog"
      panelClassName="key-finder-menu"
      menu={() => <KeyFinder />}
    >
      <Icon d={SEARCH} />
      <span className="tab-tool-label" aria-hidden="true">
        Find key
      </span>
    </MenuButton>
  )
}

/** On a phone, the key finder in the sheet along the bottom, as the sound and arpeggiator settings are. */
export function KeyFinderSheet() {
  return (
    <TrackSheet name="Find the key" icon={<Icon d={SEARCH} />} onDone={() => useToolSheet.setState({ open: null })} dismiss>
      <KeyFinder titled={false} />
    </TrackSheet>
  )
}

const add = (pc: number) => {
  useKeyFinder.setState((s) => ({ notes: [...s.notes, pc] }))
  void playNote(60 + pc)
}
const removeAt = (i: number) => useKeyFinder.setState((s) => ({ notes: s.notes.filter((_, j) => j !== i) }))

/**
 * Play a tune's notes in order, on its keyboard (or the computer's), and it
 * says which key they're likeliest in, and which others they'd fit, with a
 * button to put the song (or a section with a key of its own) in that key.
 */
function KeyFinder({ titled = true }: { titled?: boolean }) {
  const notes = useKeyFinder((s) => s.notes)
  const s = useFields('key', 'mode', 'sectionKey', 'view', 'activeSection', 'setKey', 'setMode', 'setSectionKey')
  const current = keyOf(s)
  const ownKey = s.view === 'section' && s.sectionKey !== null
  const ranked = notes.length >= ENOUGH ? findKeys(notes) : []
  const [best, ...rest] = ranked
  // Spelled as the likeliest key spells them; until there is one, with flats, as C major does.
  const name = (pc: number) => (best ? noteName(pc, best.key, best.mode) : noteName(pc, 0, 'major'))
  const counts = notes.reduce((n, pc) => ((n[pc] = (n[pc] ?? 0) + 1), n), {} as Record<number, number>)
  // Another key every bit as good: the same notes, with the tune sounding nearly as at home in it.
  const close = best && rest[0] && rest[0].outside.length === best.outside.length && best.likeness - rest[0].likeness < 0.08 ? rest[0] : null

  // While it's open, the computer's keys play notes into it (and ⌫ takes the last back), ahead of their usual shortcuts.
  useEffect(() => {
    useKeyFinder.setState({ open: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable]')) return
      const pc = TYPED.indexOf(e.code)
      const back = e.key === 'Backspace' || e.key === 'Delete'
      if (pc === -1 && !back) return
      e.preventDefault()
      e.stopPropagation()
      if (pc !== -1) add(pc)
      else useKeyFinder.setState((st) => ({ notes: st.notes.slice(0, -1) }))
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      useKeyFinder.setState({ open: false })
    }
  }, [])

  const use = (key: number, mode: Mode) => {
    if (ownKey) return s.setSectionKey(s.activeSection, { key, mode })
    s.setKey(key)
    s.setMode(mode)
  }
  const fits = (g: KeyGuess) =>
    g.outside.length === 0 ? 'Every note fits' : `${g.outside.map(name).join(', ')} ${g.outside.length === 1 ? 'isn’t' : 'aren’t'} in it`
  const row = (g: KeyGuess, top = false) => {
    const isCurrent = g.key === current.key && g.mode === current.mode
    const label = `${keyLabel(g.key, g.mode)} ${g.mode}`
    return (
      <li key={`${g.key}-${g.mode}`} className={`key-finder-key ${top ? 'is-best' : ''}`}>
        <span className="key-finder-key-name">
          {label}
          <small>{fits(g)}</small>
        </span>
        {isCurrent ? (
          <span className="key-finder-current">{ownKey ? 'This section’s key' : 'The song’s key'}</span>
        ) : (
          <button type="button" className="key-finder-use" onClick={() => use(g.key, g.mode)} title={`Put ${ownKey ? 'this section' : 'the song'} in ${label}; the chords move with it`}>
            Use
          </button>
        )}
      </li>
    )
  }

  return (
    <div className="key-finder">
      {/* In the sheet, its header names it. */}
      {titled && <p className="key-finder-title">Find the key</p>}
      <p className="key-finder-about">
        Play your tune’s notes in order<span className="key-finder-typed">, here or on your keyboard (A to J)</span>. Repeats count.
      </p>

      <div className="key-finder-piano" role="group" aria-label="Notes">
        {WHITE.map((pc, i) => (
          <button type="button" key={pc} className={`key-finder-white ${counts[pc] ? 'is-played' : ''}`} style={{ left: `${(i / 7) * 100}%` }} onClick={() => add(pc)} aria-label={`Add ${name(pc)}`}>
            {counts[pc] > 1 && <b className="key-finder-count">{counts[pc]}</b>}
            <span className="key-finder-note">{name(pc)}</span>
            <kbd>{TYPED[pc].slice(3)}</kbd>
          </button>
        ))}
        {BLACK.map((pc) => (
          <button type="button" key={pc} className={`key-finder-black ${counts[pc] ? 'is-played' : ''}`} style={{ left: `${(BLACK_AT[pc] / 7) * 100}%` }} onClick={() => add(pc)} aria-label={`Add ${name(pc)}`}>
            {counts[pc] > 1 && <b className="key-finder-count">{counts[pc]}</b>}
            <kbd>{TYPED[pc].slice(3)}</kbd>
          </button>
        ))}
      </div>

      <div className="key-finder-notes">
        {notes.length ? (
          <ol className="key-finder-tune" aria-label="Your tune">
            {notes.map((pc, i) => (
              <li key={i}>
                <button type="button" onClick={() => removeAt(i)} title={`Take this ${name(pc)} out`}>
                  {name(pc)}
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <span className="key-finder-empty">Your notes show here</span>
        )}
        {notes.length > 0 && (
          <span className="key-finder-edit">
            <button type="button" onClick={() => useKeyFinder.setState({ notes: notes.slice(0, -1) })} title="Take the last note out (⌫)">
              Undo
            </button>
            <button type="button" onClick={() => useKeyFinder.setState({ notes: [] })}>
              Clear
            </button>
          </span>
        )}
      </div>

      <div className="key-finder-results" aria-live="polite">
        {!best ? (
          <p className="key-finder-hint">
            {notes.length ? `${ENOUGH - notes.length} more ${ENOUGH - notes.length === 1 ? 'note' : 'notes'} and it’ll say what key they’re in.` : `Play at least ${ENOUGH} notes to see what key they’re in.`}
          </p>
        ) : (
          <>
            <p className="key-finder-label">Most likely</p>
            <ul>{row(best, true)}</ul>
            {close && (
              <p className="key-finder-hint">
                A close call with {keyLabel(close.key, close.mode)} {close.mode}: go with the one whose first note sounds like home.
              </p>
            )}
            <p className="key-finder-label">Next likeliest</p>
            <ul>{rest.slice(0, 3).map((g) => row(g))}</ul>
          </>
        )}
      </div>
    </div>
  )
}
