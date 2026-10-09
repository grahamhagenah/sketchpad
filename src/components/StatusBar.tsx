import type { ReactNode } from 'react'
import { chordsTrackName, drumsTrackName, keyOf, useStore, vocalTrackName } from '../store'
import { grooveLabel } from '../audio/drums'
import { chordOf } from '../music/theory'
import { isDirty } from '../library'
import { ShortcutsButton } from './Shortcuts'
import { checkLatency } from '../audio/engine'

/**
 * A strip along the bottom of the window: what's selected, with the keys that
 * act on it, whether the sketch is saved, and the list of every shortcut.
 */
export function StatusBar() {
  const dirty = useStore(isDirty)
  const saved = useStore((s) => s.sketchId !== null)

  return (
    <footer className="status-bar">
      <p className="status-main">
        <Status />
      </p>
      <p className="status-save">
        {dirty ? (
          <>
            Unsaved changes <kbd>⌘S</kbd>
          </>
        ) : saved ? (
          'Saved'
        ) : (
          ''
        )}
      </p>
      <ShortcutsButton />
    </footer>
  )
}

function Status() {
  const s = useStore()
  const sel = s.chords.find((c) => c.id === s.selectedId)

  if (s.recording === 'count-in') return <>Counting in…</>
  if (s.recording === 'on')
    return (
      <>
        Recording{' '}
        <Keys>
          · <kbd>R</kbd> or <kbd>Space</kbd> to stop
        </Keys>
      </>
    )

  if (s.view === 'song') {
    const shared = new Set(s.arrangement.map((e) => e.section)).size < s.arrangement.length
    if (!s.arrangement.length) return <>Add sections to the song with +, in the order they play.</>
    return (
      <>
        Click a section to edit it, or drag it to reorder.
        {shared && ' ⧉ marks a section that plays more than once and is the same each time.'}
      </>
    )
  }

  if (sel) {
    const { key, mode } = keyOf(s)
    const info = chordOf(key, mode, sel)
    return (
      <>
        <strong>{info.name}</strong>
        <span className="status-sep">{info.roman}</span>
        <span className="status-sep">
          {sel.beats} {sel.beats === 1 ? 'beat' : 'beats'}
        </span>
        <Keys>
          <kbd>[</kbd> <kbd>]</kbd> length · <kbd>S</kbd> 7th · <kbd>D</kbd> duplicate · <kbd>⌥←</kbd> <kbd>⌥→</kbd> move · <kbd>⌫</kbd> delete
        </Keys>
      </>
    )
  }

  if (s.selectedVocal !== null) {
    const take = s.takes[s.selectedVocal]
    return (
      <>
        <strong>{vocalTrackName(s, s.selectedVocal)}</strong>
        <span className="status-sep">{take ? `${take.seconds.toFixed(1)} s` : 'Empty'}</span>
        {take && (
          <Keys>
            <kbd>⌫</kbd> delete the take
          </Keys>
        )}
        <button
          type="button"
          className="status-action"
          onClick={() => void checkLatency()}
          title="Play a few clicks and listen for them, so takes line up with the beat on this device"
        >
          {s.latency === null ? 'Check recording timing' : `Timing ${Math.round(s.latency * 1000)} ms · check again`}
        </button>
      </>
    )
  }

  if (s.drumsTrackSelected && s.drumTrack) {
    return (
      <>
        <strong>{drumsTrackName(s)}</strong>
        <span className="status-sep">{s.drums ? grooveLabel(s.drums) : 'No drums in this section'}</span>
        <Keys>
          <kbd>⌫</kbd> remove the drum track
        </Keys>
      </>
    )
  }

  if (s.chordsTrackSelected) {
    return (
      <>
        <strong>{chordsTrackName(s)}</strong>
        <span className="status-sep">
          {s.chords.length} {s.chords.length === 1 ? 'chord' : 'chords'}
        </span>
        <Keys>
          <kbd>⌫</kbd> clear them all
        </Keys>
      </>
    )
  }

  if (!s.chords.length) return <>Click + or press 1–7 to add a chord, or pick a progression from +.</>
  return (
    <Keys>
      <kbd>Space</kbd> play · <kbd>R</kbd> record · <kbd>1</kbd>–<kbd>7</kbd> add a chord · <kbd>L</kbd> loop
    </Keys>
  )
}

/** Keyboard hints, which a touch screen leaves out. */
function Keys({ children }: { children: ReactNode }) {
  return <span className="status-keys">{children}</span>
}
