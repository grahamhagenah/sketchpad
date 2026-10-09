import { useCallback, useEffect, useRef, useState } from 'react'
import { useDismiss } from '../hooks/useDismiss'
import { songSummary, useStore } from '../store'
import { keyLabel } from '../music/theory'
import { deleteSketch, isDirty, newSketch, openSketch, refreshLibrary, reportStorageError, saveSketch, useLibrary, type SketchRecord } from '../library'

/**
 * One button for the sketch file: save, start a new sketch, or open a saved
 * one. A dot on it means there are unsaved changes; ⌘S saves without opening it.
 */
export function SketchesButton() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, close, ref)
  const sketches = useLibrary((s) => s.sketches)
  const current = useStore((s) => s.sketchId)
  const dirty = useStore(isDirty)

  useEffect(() => {
    if (open) void refreshLibrary()
  }, [open])

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className={`icon-btn save-btn ${dirty ? 'has-changes' : ''}`}
        aria-label={`Sketches${dirty ? ', unsaved changes' : ''}`}
        title={dirty ? 'Save, open or start a sketch (unsaved changes)' : 'Save, open or start a sketch'}
        aria-expanded={open}
        aria-controls="sketches-menu"
        onClick={() => setOpen(!open)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
        </svg>
      </button>
      {open && (
        <div className="menu sketches-menu" id="sketches-menu" role="dialog" aria-label="Your sketches">
          <button
            type="button"
            className="menu-item"
            disabled={!dirty}
            onClick={() => {
              void saveSketch().catch(reportStorageError('save the sketch'))
              close()
            }}
          >
            <span className="menu-item-title">
              {dirty ? 'Save' : 'Saved'}
              <kbd>⌘S</kbd>
            </span>
            <span className="menu-item-about">{dirty ? 'Keep the changes to this sketch' : 'Nothing new since the last save'}</span>
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              void newSketch().catch(reportStorageError('start a new sketch'))
              close()
            }}
          >
            <span className="menu-item-title">New sketch</span>
            <span className="menu-item-about">Your current one is saved first</span>
          </button>
          {sketches.length > 0 && <div className="menu-divider" role="separator" />}
          {sketches.map((sketch) => (
            <SketchRow
              key={sketch.id}
              sketch={sketch}
              current={sketch.id === current}
              onOpen={() => {
                void openSketch(sketch.id).catch(reportStorageError('open that sketch'))
                close()
              }}
            />
          ))}
          {sketches.length === 0 && <p className="menu-empty">Sketches you save show up here.</p>}
        </div>
      )}
    </div>
  )
}

function SketchRow({ sketch, current, onOpen }: { sketch: SketchRecord; current: boolean; onOpen: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const { song } = sketch
  const summary = songSummary(song)
  const bars = Math.ceil(summary.beats / song.timeSig[0])
  const vocals = summary.vocals
  const meta = [
    `${keyLabel(song.key, song.mode)} ${song.mode}`,
    `${song.bpm} bpm`,
    `${bars} ${bars === 1 ? 'bar' : 'bars'}`,
    summary.sections > 1 ? `${summary.sections} sections` : null,
    vocals ? `${vocals} ${vocals === 1 ? 'vocal' : 'vocals'}` : null,
    when(sketch.updated),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={`sketch-row ${current ? 'is-current' : ''}`}>
      <button type="button" className="menu-item" onClick={onOpen} aria-current={current || undefined}>
        <span className="menu-item-title">{song.title || 'Untitled sketch'}</span>
        <span className="menu-item-about">{meta}</span>
      </button>
      <button
        type="button"
        className={confirming ? 'chip sketch-delete is-confirming' : 'icon-btn sketch-delete'}
        aria-label={confirming ? `Confirm deleting ${song.title || 'this sketch'}` : `Delete ${song.title || 'this sketch'}`}
        title="Delete this sketch"
        onClick={() => (confirming ? void deleteSketch(sketch.id).catch(reportStorageError('delete that sketch')) : setConfirming(true))}
        onBlur={() => setConfirming(false)}
      >
        {confirming ? (
          'Delete'
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
          </svg>
        )}
      </button>
    </div>
  )
}

/** "14:05" for today, otherwise "9 Oct". */
function when(time: number) {
  const date = new Date(time)
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
