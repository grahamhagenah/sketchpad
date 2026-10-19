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
  openSketch,
  openSong,
  refreshLibrary,
  reportStorageError,
  restoreSketch,
  saveSketch,
  useLibrary,
  type SketchRecord,
} from '../library'
import { SONG_TEMPLATES } from '../songs'
import { ExportItems, useCanExport } from './ExportItems'
import { closeSheet, toggleTool, useToolSheet } from './SoundPanel'
import { TrackSheet } from './TrackSheet'

/** Saves the sketch (⌘S does too): a dot on it while there are unsaved changes, and nothing to do without them. */
export function SaveButton() {
  const dirty = useStore(isDirty)
  return (
    <button
      type="button"
      className={`icon-btn save-btn ${dirty ? 'has-changes' : ''}`}
      aria-label={dirty ? 'Save, unsaved changes' : 'Saved'}
      title={dirty ? 'Save (⌘S)' : 'Saved: nothing new since the last save'}
      disabled={!dirty}
      onClick={() => void saveSketch().catch(reportStorageError('save the sketch'))}
    >
      <MenuIcon d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />
    </button>
  )
}

/** Opens your songs, and songs to start from, in the side panel (on a phone, the sheet along the bottom). */
export function SongsButton() {
  const open = useToolSheet((s) => s.open === 'songs')
  return (
    <button
      type="button"
      className={`icon-btn songs-btn ${open ? 'is-on' : ''}`}
      data-sheet-toggle
      aria-label="Songs"
      aria-expanded={open}
      aria-controls="songs-panel"
      title="Your songs: open one, start a new one, or start from a song you’d know"
      onClick={() => toggleTool('songs')}
    >
      <MenuIcon d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
    </button>
  )
}

/**
 * Your songs: a new one, those saved on this device (and, signed in, in your
 * account), songs to start from, and those recently deleted. Opening one puts
 * the panel away.
 */
export function SongsPanel() {
  const sketches = useLibrary((s) => s.sketches)
  const deleted = useLibrary((s) => s.deleted)
  const current = useStore((s) => s.sketchId)
  const [showDeleted, setShowDeleted] = useState(false)

  useEffect(() => {
    void refreshLibrary()
  }, [])

  return (
    <div className="songs-panel">
      <button
        type="button"
        className="menu-item has-icon"
        onClick={() => {
          void newSketch().catch(reportStorageError('start a new sketch'))
          closeSheet()
        }}
      >
        <MenuIcon d="M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6" />
        <span className="menu-item-title">New song</span>
        <span className="menu-item-about">Your current one is saved first</span>
      </button>
      {/* Your own songs, set apart from the button above as a list of their own. */}
      <section className="songs-group" aria-label="Your songs">
        <p className="menu-heading">Your songs</p>
        {sketches.map((sketch) => (
          <SketchRow
            key={sketch.id}
            sketch={sketch}
            current={sketch.id === current}
            onOpen={() => {
              void openSketch(sketch.id).catch(reportStorageError('open that sketch'))
              closeSheet()
            }}
          />
        ))}
        {sketches.length === 0 && <p className="menu-empty">Songs you save show up here.</p>}
      </section>
      {/* Songs to start from, in view rather than folded away: there are few enough. */}
      <section className="songs-group" aria-label="Start from a song">
        <p className="menu-heading">Start from a song</p>
        <p className="songs-group-about">{SONG_TEMPLATES.length} songs you’d know, to make your own</p>
        {SONG_TEMPLATES.map((song) => (
          <button
            key={song.name}
            type="button"
            className="menu-item has-icon"
            onClick={() => {
              void openSong(song.build(), song.name).catch(reportStorageError('open that song'))
              closeSheet()
            }}
          >
            <MenuIcon d={song.icon} />
            <span className="menu-item-title">{song.name}</span>
            <span className="menu-item-about">Think “{song.think}”</span>
          </button>
        ))}
      </section>
      {/* Deleted songs wait here a while, to be put back. */}
      {deleted.length > 0 && (
        <section className="songs-group" aria-label="Recently deleted">
          <button type="button" className="menu-item has-icon deleted-toggle" aria-expanded={showDeleted} onClick={() => setShowDeleted(!showDeleted)}>
            <MenuIcon d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
            <span className="menu-item-title">
              Recently deleted ({deleted.length})
              <Chevron />
            </span>
            <span className="menu-item-about">Kept {DELETED_DAYS} days, to put back</span>
          </button>
          {showDeleted && deleted.map((sketch) => <DeletedRow key={sketch.id} sketch={sketch} />)}
        </section>
      )}
    </div>
  )
}

/** On a phone, your songs in the sheet along the bottom, as the other panels are. */
export function SongsSheet() {
  return (
    <TrackSheet name="Songs" icon={<MenuIcon d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />} onDone={closeSheet} dismiss>
      <SongsPanel />
    </TrackSheet>
  )
}

/** Files in and out of Bounce: the song exported for other apps, and backups, made and opened. */
export function ShareButton() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, close, ref)
  const below = useDropBelow(open, ref)
  const canExport = useCanExport()
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className="icon-btn share-btn"
        aria-label="Export and backups"
        title="Export the song, or back it up to a file"
        aria-expanded={open}
        aria-controls="share-menu"
        onClick={() => setOpen(!open)}
      >
        {/* Out of Bounce, to another app: an arrow up out of a tray. */}
        <MenuIcon d="M12 15V4M7 9l5-5 5 5M5 14v6h14v-6" />
      </button>
      {open && (
        <div className="menu share-menu" id="share-menu" role="dialog" aria-label="Export and backups" style={below}>
          <p className="menu-heading">Export</p>
          {canExport ? <ExportItems close={close} /> : <p className="menu-empty">Add some chords to export the song.</p>}
          <div className="menu-divider" role="separator" />
          <p className="menu-heading">Backups</p>
          {/* The sketch, recordings and all, as one file to keep anywhere, and back again. */}
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
            <span className="menu-item-about">This song and its recordings, in one file</span>
          </button>
          <button type="button" className="menu-item has-icon" onClick={() => fileRef.current?.click()}>
            <MenuIcon d="M12 15V4M7 9l5-5 5 5M5 20h14" />
            <span className="menu-item-title">Open a backup</span>
            <span className="menu-item-about">A .bounce file, opened as a new song</span>
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

/** The arrow on a row that opens out more rows under it. */
const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
)
