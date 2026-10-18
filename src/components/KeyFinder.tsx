import { useEffect, useRef } from 'react'
import { keyOf, useFields } from '../store'
import { findKeys, type KeyGuess } from '../music/findKey'
import { keyLabel, noteName, type Mode } from '../music/theory'
import { playNote } from '../audio/engine'
import { HIGHEST_OCTAVE, LOWEST_OCTAVE, shiftOctave, useKeyFinder } from '../keyFinder'
import { Icon } from './Toolbar'
import { TrackSheet } from './TrackSheet'
import { toggleTool, useToolSheet } from './SoundPanel'

/** The notes it takes before it says what key they're in. */
const ENOUGH = 3
/** Until then, in the keys' places, how to go about it. */
const TIPS = [
  ['Sing or hum the tune', 'then tap each note you hear'],
  ['Start with three notes', 'the more you add, the better the guess'],
  ['Two keys look right?', 'choose the one that sounds like home'],
]
/** A note's key on the computer keyboard, as a piano lies along it in most music apps: A to J the white notes, W E T Y U the black. */
const TYPED = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ']

const SEARCH = 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20'

/** Beside the lyrics: finds the key of a tune from its notes, in the side panel, or on a phone in the sheet along the bottom. */
export function KeyFinderButton() {
  const open = useToolSheet((s) => s.open === 'key')
  return (
    <button
      type="button"
      className={`icon-btn tab-tool-btn key-finder-btn ${open ? 'is-on' : ''}`}
      // It opens and closes the sheet itself, so a tap on it isn't a tap outside the sheet.
      data-sheet-toggle
      aria-label="Find the key"
      aria-expanded={open}
      aria-controls="key-panel"
      title="Find the key of a tune from its notes"
      onClick={() => toggleTool('key')}
    >
      <Icon d={SEARCH} />
      <span className="tab-tool-label" aria-hidden="true">
        Find key
      </span>
    </button>
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

/** Adds a note to the end of the tune, sounding it: again and again for a note the tune repeats, since how often each comes counts. */
const add = (pc: number) => {
  useKeyFinder.setState((s) => ({ notes: [...s.notes, pc] }))
  // In the octave picked, to sound where the tune's sung; which octave doesn't change the key.
  void playNote(12 * (useKeyFinder.getState().octave + 1) + pc)
}
const removeAt = (i: number) => useKeyFinder.setState((s) => ({ notes: s.notes.filter((_, j) => j !== i) }))

/**
 * Play a tune's notes in order, on its keyboard (or the computer's), and it
 * says which key they're likeliest in, and which others they'd fit, with a
 * button to put the song (or a section with a key of its own) in that key.
 */
export function KeyFinder({ titled = true }: { titled?: boolean }) {
  const notes = useKeyFinder((s) => s.notes)
  const octave = useKeyFinder((s) => s.octave)
  const s = useFields('key', 'mode', 'sectionKey', 'view', 'activeSection', 'setKey', 'setMode', 'setSectionKey')
  const current = keyOf(s)
  const ownKey = s.view === 'section' && s.sectionKey !== null
  const ranked = notes.length >= ENOUGH ? findKeys(notes) : []
  const [best, ...rest] = ranked
  // Spelled as the likeliest key spells them; until there is one, with flats, as C major does.
  const name = (pc: number) => (best ? noteName(pc, best.key, best.mode) : noteName(pc, 0, 'major'))
  const played = new Set(notes)
  // The tune's chips run along one line; the newest is kept in view.
  const tuneRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = tuneRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [notes.length])
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
      // Z and X an octave down and up, as in most music apps.
      const shift = e.code === 'KeyZ' ? -1 : e.code === 'KeyX' ? 1 : 0
      if (pc === -1 && !back && !shift) return
      e.preventDefault()
      e.stopPropagation()
      if (shift) shiftOctave(shift)
      else if (pc !== -1) add(pc)
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
          {/* Nearly as likely as the top one: said on its own line, so the list stays the same height. */}
          <small>{g === close ? `${fits(g)} · a close call` : fits(g)}</small>
        </span>
        {isCurrent ? (
          <span className="key-finder-current" title={ownKey ? 'This section is in this key' : 'The song is in this key'}>
            {ownKey ? 'Section key' : 'Song key'}
          </span>
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
        Pick the notes in your tune, in the order they come<span className="key-finder-typed">, here or on your keyboard</span>; repeat notes as the tune does. Tap one below to take it out. The first and last count as likelier home notes.
      </p>

      {/* Which octave the pads sound in, to match a low or high voice: it only changes what you hear. */}
      <div className="key-finder-octave" role="group" aria-label="Octave">
        <span className="key-finder-label">Octave</span>
        <button type="button" onClick={() => shiftOctave(-1)} disabled={octave <= LOWEST_OCTAVE} aria-label="An octave lower" title="An octave lower (Z)">
          −
        </button>
        <span className="key-finder-octave-value" aria-live="polite">
          C{octave}
          <small>{octave === 4 ? 'middle' : octave < 4 ? 'lower' : 'higher'}</small>
        </span>
        <button type="button" onClick={() => shiftOctave(1)} disabled={octave >= HIGHEST_OCTAVE} aria-label="An octave higher" title="An octave higher (X)">
          +
        </button>
      </div>

      {/* The twelve notes as pads, as the chords are in the chord pad; those in the tune outlined. */}
      <div className="chord-pad-grid key-finder-notes-grid" role="group" aria-label="Notes">
        {Array.from({ length: 12 }, (_, pc) => (
          <button
            type="button"
            key={pc}
            className={`chord-pad-pad ${played.has(pc) ? 'is-picked' : ''}`}
            onClick={() => add(pc)}
            aria-label={name(pc)}
            title={`Add ${name(pc)}${played.has(pc) ? ' again' : ''}`}
          >
            <span className="chord-pad-name">{name(pc)}</span>
            <span className="chord-pad-roman key-finder-typed">{TYPED[pc].slice(3)}</span>
          </button>
        ))}
      </div>

      <div className="key-finder-notes">
        {notes.length ? (
          <ol className="key-finder-tune" aria-label="Your tune" ref={tuneRef}>
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
        {/* Until there are enough notes, the same rows, waiting: so the finder is as tall from the start, and doesn't jump when the keys come in. */}
        <p className="key-finder-label">Most likely</p>
        <ul>
          {best ? (
            row(best, true)
          ) : (
            <li className="key-finder-key is-best is-waiting">
              <span className="key-finder-key-name">
                Pick {notes.length ? `${ENOUGH - notes.length} more` : ENOUGH} {ENOUGH - notes.length === 1 ? 'note' : 'notes'}
                <small>to see what key they’re in</small>
              </span>
            </li>
          )}
        </ul>
        <p className="key-finder-label">{best ? 'Next likeliest' : 'Tips'}</p>
        <ul>
          {best
            ? rest.slice(0, 3).map((g) => row(g))
            : TIPS.map(([tip, more]) => (
                // Laid out as a key's row, so the finder is as tall now as once the keys come in.
                <li key={tip} className="key-finder-key is-tip">
                  <span className="key-finder-key-name">
                    {tip}
                    <small>{more}</small>
                  </span>
                </li>
              ))}
        </ul>
      </div>
    </div>
  )
}
