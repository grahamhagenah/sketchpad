import { useCallback, useEffect, useRef, useState } from 'react'
import { useDismiss } from '../hooks/useDismiss'
import { useStore, totalBeats } from '../store'
import { keyLabel } from '../music/theory'
import { deleteSketch, isDirty, newSketch, openSketch, refreshLibrary, saveSketch, useLibrary, type SketchRecord } from '../library'

/** Saves the sketch; a dot on it means there are unsaved changes. */
export function SaveButton() {
  const dirty = useStore(isDirty)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try {
      await saveSketch()
    } finally {
      setSaving(false)
    }
  }
  return (
    <button
      type="button"
      className={`icon-btn save-btn ${dirty ? 'has-changes' : ''}`}
      aria-label={dirty ? 'Save' : 'Saved'}
      title={dirty ? 'Save (⌘S)' : 'Nothing new to save'}
      disabled={saving || !dirty}
      onClick={() => void save()}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />
      </svg>
    </button>
  )
}

/** Lists the saved sketches to open or delete, and starts new ones. */
export function SketchesButton() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, close, ref)
  const sketches = useLibrary((s) => s.sketches)
  const current = useStore((s) => s.sketchId)

  useEffect(() => {
    if (open) void refreshLibrary()
  }, [open])

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Sketches"
        title="Your sketches"
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
            onClick={() => {
              void newSketch()
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
                void openSketch(sketch.id)
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
  const bars = Math.ceil(totalBeats(song.chords) / song.timeSig[0])
  const vocals = song.vocalTracks
  const meta = [
    `${keyLabel(song.key, song.mode)} ${song.mode}`,
    `${song.bpm} bpm`,
    `${bars} ${bars === 1 ? 'bar' : 'bars'}`,
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
        onClick={() => (confirming ? void deleteSketch(sketch.id) : setConfirming(true))}
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
