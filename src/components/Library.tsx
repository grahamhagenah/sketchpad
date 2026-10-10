import { useCallback, useEffect, useRef, useState } from 'react'
import { useDismiss } from '../hooks/useDismiss'
import { useDropBelow } from '../hooks/useDropBelow'
import { songSummary, useStore } from '../store'
import { keyLabel } from '../music/theory'
import {
  backUpSketch,
  deleteForever,
  deleteSketch,
  DELETED_DAYS,
  isDirty,
  newSketch,
  openBackup,
  openDemo,
  openSketch,
  refreshLibrary,
  reportStorageError,
  restoreSketch,
  saveSketch,
  useLibrary,
  type SketchRecord,
} from '../library'
import { ButtonLabel } from './Toolbar'

/**
 * One button for the sketch file: save, start a new sketch, or open a saved
 * one. A dot on it means there are unsaved changes; ⌘S saves without opening it.
 */
export function SketchesButton() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, close, ref)
  const below = useDropBelow(open, ref)
  const sketches = useLibrary((s) => s.sketches)
  const deleted = useLibrary((s) => s.deleted)
  const [showDeleted, setShowDeleted] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
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
        <ButtonLabel>Sketches</ButtonLabel>
      </button>
      {open && (
        <div className="menu sketches-menu" id="sketches-menu" role="dialog" aria-label="Your sketches" style={below}>
          <button
            type="button"
            className="menu-item has-icon"
            disabled={!dirty}
            onClick={() => {
              void saveSketch().catch(reportStorageError('save the sketch'))
              close()
            }}
          >
            <MenuIcon d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />
            <span className="menu-item-title">
              {dirty ? 'Save' : 'Saved'}
              <kbd>⌘S</kbd>
            </span>
            <span className="menu-item-about">{dirty ? 'Keep the changes to this sketch' : 'Nothing new since the last save'}</span>
          </button>
          <button
            type="button"
            className="menu-item has-icon"
            onClick={() => {
              void newSketch().catch(reportStorageError('start a new sketch'))
              close()
            }}
          >
            <MenuIcon d="M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6" />
            <span className="menu-item-title">New sketch</span>
            <span className="menu-item-about">Your current one is saved first</span>
          </button>
          <button
            type="button"
            className="menu-item has-icon"
            onClick={() => {
              void openDemo().catch(reportStorageError('open the demo song'))
              close()
            }}
          >
            <MenuIcon d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM10 8.5v7l6-3.5z" />
            <span className="menu-item-title">Demo song</span>
            <span className="menu-item-about">A short song to hear what Bounce does</span>
          </button>
          <div className="menu-divider" role="separator" />
          {/* Backups: the sketch, recordings and all, as one file to keep anywhere, and back again. */}
          <button
            type="button"
            className="menu-item has-icon"
            onClick={() => {
              void backUpSketch().catch((error) => {
                console.error(error)
                window.alert('Bounce couldn’t make the backup file.')
              })
              close()
            }}
          >
            <MenuIcon d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            <span className="menu-item-title">Back up to a file</span>
            <span className="menu-item-about">This sketch and its recordings, in one file</span>
          </button>
          <button type="button" className="menu-item has-icon" onClick={() => fileRef.current?.click()}>
            <MenuIcon d="M12 15V4M7 9l5-5 5 5M5 20h14" />
            <span className="menu-item-title">Open a backup</span>
            <span className="menu-item-about">A .bounce file, opened as a new sketch</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".bounce,application/zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              close()
              void openBackup(file).catch((error) => window.alert(error instanceof Error ? error.message : 'Bounce couldn’t open that file.'))
            }}
          />
          {sketches.length > 0 && (
            <>
              <div className="menu-divider" role="separator" />
              <p className="menu-heading">Your sketches</p>
            </>
          )}
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
          {/* Deleted sketches wait here a while, to be put back. */}
          {deleted.length > 0 && (
            <>
              <div className="menu-divider" role="separator" />
              <button type="button" className="menu-item deleted-toggle" aria-expanded={showDeleted} onClick={() => setShowDeleted(!showDeleted)}>
                <span className="menu-item-title">
                  Recently deleted ({deleted.length})
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
                <span className="menu-item-about">Kept {DELETED_DAYS} days, to put back</span>
              </button>
              {showDeleted && deleted.map((sketch) => <DeletedRow key={sketch.id} sketch={sketch} />)}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** A deleted sketch: put it back, or delete it for good. */
function DeletedRow({ sketch }: { sketch: SketchRecord }) {
  const [confirming, setConfirming] = useState(false)
  const left = Math.max(1, DELETED_DAYS - Math.floor((Date.now() - (sketch.deleted ?? Date.now())) / (24 * 60 * 60 * 1000)))
  const title = sketch.song.title || 'Untitled sketch'
  return (
    <div className="sketch-row is-deleted">
      <div className="menu-item">
        <span className="menu-item-title">{title}</span>
        <span className="menu-item-about">
          Deleted {when(sketch.deleted ?? Date.now())} · {left} {left === 1 ? 'day' : 'days'} left
        </span>
      </div>
      <button type="button" className="chip" onClick={() => void restoreSketch(sketch.id).catch(reportStorageError('put that sketch back'))}>
        Put back
      </button>
      <button
        type="button"
        className={confirming ? 'chip sketch-delete is-confirming' : 'icon-btn sketch-delete'}
        aria-label={confirming ? `Confirm deleting ${title} for good` : `Delete ${title} for good`}
        title="Delete for good, with its recordings"
        onClick={() => (confirming ? void deleteForever(sketch.id).catch(reportStorageError('delete that sketch')) : setConfirming(true))}
        onBlur={() => setConfirming(false)}
      >
        {confirming ? (
          'Delete for good'
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
          </svg>
        )}
      </button>
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

/** An action's icon, in the menu's left column, setting the actions apart from the sketches listed under them. */
const MenuIcon = ({ d }: { d: string }) => (
  <svg className="menu-item-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
