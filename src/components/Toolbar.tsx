import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useDismiss } from '../hooks/useDismiss'
import { audibleTracks, useStore, vocalTrackName, TIME_SIGS, TIME_SIG_GROUPS, MIN_BPM, MAX_BPM, ZOOMS, type Chord } from '../store'
import { chordOf, keyLabel, type Mode } from '../music/theory'
import { audition, deleteTake, engine, seek, togglePlay, toggleRecord } from '../audio/engine'
import { redo, undo, useHistory } from '../history'
import { SoundButton } from './SoundPanel'
import { ShortcutsButton } from './Shortcuts'
import { Position } from './Position'
import { SongTitle } from './SongTitle'
import { download, exportName, songToMidi, songToWav, takeToWav } from '../audio/export'
import { LANES } from '../audio/take'

/** The one bar for playback, song settings and editing the selected chord. */
export function Toolbar() {
  const { key, mode, timeSig, playing, metronome, loopOn, chords, selectedId } = useStore()
  const { setKey, setMode, setTimeSig, toggleMetronome, toggleLoop } = useStore()
  const { updateChord, removeChord, duplicateChord } = useStore()
  const chord = chords.find((c) => c.id === selectedId)
  const selectedVocal = useStore((s) => s.selectedVocal)
  const vocalNames = useStore((s) => s.vocalNames)
  const recording = useStore((s) => s.recording)
  const vocalSelected = selectedVocal !== null && recording === 'off'
  const chordsTrackSelected = useStore((s) => s.chordsTrackSelected) && chords.length > 0
  const clearChords = useStore((s) => s.clearChords)

  const editChord = (c: Chord, patch: Partial<Omit<Chord, 'id'>>) => {
    updateChord(c.id, patch)
    audition({ ...c, ...patch })
  }

  return (
    <div className="toolbar">
      <div className="toolbar-row" role="toolbar" aria-label="Playback">
        <div className="toolbar-group">
          <SongTitle />
        </div>

        {/* Laid out like a DAW's control bar: transport, then a display of where you are and the song's settings, then modes. */}
        <div className="toolbar-group">
          <div className="transport" role="group" aria-label="Transport">
            <button type="button" className="to-start" onClick={() => void seek(0)} aria-label="Go to the start" title="Go to the start (↵)">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="5" width="2.5" height="14" rx="1" fill="currentColor" />
                <path d="M19 5.5v13L9 12z" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              className={`play ${playing ? 'is-playing' : ''}`}
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              title="Play / pause (Space)"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <RecordButton />
          </div>

          <div className="lcd" role="group" aria-label="Position and song settings">
            <Position />
            <TempoField />
            {/* Meter over key, stacked in one cell as Logic shows them. */}
            <div className="lcd-cell lcd-stack">
              <select
                aria-label="Time signature"
                title="Time signature"
                value={timeSig.join('/')}
                onChange={(e) => {
                  const sig = TIME_SIGS.find((s) => s.join('/') === e.target.value)
                  if (sig) setTimeSig(sig)
                }}
              >
                {TIME_SIG_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.sigs.map((s) => (
                      <option key={s.join('/')} value={s.join('/')}>
                        {s.join('/')}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <select
                aria-label="Key"
                title="Key"
                value={`${key}-${mode}`}
                onChange={(e) => {
                  const [pc, m] = e.target.value.split('-')
                  setKey(Number(pc))
                  setMode(m as Mode)
                }}
              >
                {(['major', 'minor'] as const).map((m) => (
                  <optgroup key={m} label={m === 'major' ? 'Major' : 'Minor'}>
                    {Array.from({ length: 12 }, (_, pc) => (
                      <option key={pc} value={`${pc}-${m}`}>
                        {keyLabel(pc, m)} {m === 'major' ? 'maj' : 'min'}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <IconToggle label="Cycle (L)" pressed={loopOn} onClick={toggleLoop}>
            <Icon d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />
          </IconToggle>
          <IconToggle label="Metronome (M)" pressed={metronome} onClick={toggleMetronome}>
            <Icon d="M9 3h6l4 18H5zM12 15l5-8" />
          </IconToggle>
          <SoundButton />
        </div>

        <div className="toolbar-group" aria-label="Edit" role="group">
          <UndoRedo />
        </div>

        {/* Shown only for what's selected, rather than sitting greyed out. */}
        {(chord || vocalSelected || chordsTrackSelected) && (
          <div className="toolbar-group" aria-label={chord ? 'Selected chord' : 'Selected track'} role="group">
            {chord && (
              <>
                <select
                  aria-label="Selected chord"
                  title="Change the selected chord"
                  className="chord-select"
                  value={chord.degree}
                  onChange={(e) => editChord(chord, { degree: Number(e.target.value) })}
                >
                  {Array.from({ length: 7 }, (_, d) => {
                    const o = chordOf(key, mode, { ...chord, degree: d })
                    return (
                      <option key={d} value={d}>
                        {o.name} — {o.roman}
                      </option>
                    )
                  })}
                </select>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={chord.seventh}
                  onClick={() => editChord(chord, { seventh: !chord.seventh })}
                  title="Add 7th (S)"
                >
                  7th
                </button>
                <select
                  aria-label="Chord colour"
                  title="Sus or added note"
                  value={chord.color ?? ''}
                  onChange={(e) => editChord(chord, { color: (e.target.value || undefined) as Chord['color'] })}
                >
                  <option value="">Triad</option>
                  <option value="sus2">sus2</option>
                  <option value="sus4">sus4</option>
                  <option value="add9">add9</option>
                </select>
                <select
                  aria-label="Bass note"
                  title="Bass note (slash chord)"
                  value={chord.bass ?? ''}
                  onChange={(e) => editChord(chord, { bass: (e.target.value || undefined) as Chord['bass'] })}
                >
                  <option value="">Root</option>
                  <option value="third">/3rd</option>
                  <option value="fifth">/5th</option>
                </select>
                <button type="button" className="icon-btn" aria-label="Duplicate" title="Duplicate (D)" onClick={() => duplicateChord(chord.id)}>
                  <Icon d="M9 9h10v10H9zM5 15V5h10" />
                </button>
              </>
            )}
            <button
              type="button"
              className="icon-btn danger"
              aria-label={
                vocalSelected ? `Delete ${vocalTrackName({ vocalNames }, selectedVocal!)}` : chordsTrackSelected ? 'Clear the progression' : 'Delete'
              }
              title={
                vocalSelected
                  ? 'Delete the selected track (⌫)'
                  : chordsTrackSelected
                    ? 'Clear every chord (⌫); undo brings them back'
                    : 'Delete the selected chord (⌫)'
              }
              onClick={() =>
                vocalSelected ? void deleteTake(selectedVocal!) : chordsTrackSelected ? clearChords() : chord && removeChord(chord.id)
              }
            >
              <Icon d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
            </button>
          </div>
        )}
        <div className="toolbar-group toolbar-end">
          <ExportButton />
          <ShortcutsButton />
        </div>
      </div>
    </div>
  )
}

/** Widens or narrows the beats on the timeline. */
export function ZoomButtons() {
  const zoom = useStore((s) => s.zoom)
  const zoomBy = useStore((s) => s.zoomBy)
  return (
    <>
      <button type="button" className="icon-btn" aria-label="Zoom out" title="Zoom out (−)" disabled={zoom === ZOOMS[0]} onClick={() => zoomBy(-1)}>
        <Icon d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.9-4.9M7.5 10.5h6" />
      </button>
      <button type="button" className="icon-btn" aria-label="Zoom in" title="Zoom in (+)" disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => zoomBy(1)}>
        <Icon d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.9-4.9M7.5 10.5h6M10.5 7.5v6" />
      </button>
    </>
  )
}

function UndoRedo() {
  const { canUndo, canRedo } = useHistory()
  return (
    <>
      <button type="button" className="icon-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}>
        <Icon d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
      </button>
      <button type="button" className="icon-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}>
        <Icon d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
      </button>
    </>
  )
}

/** Adds an empty vocal track, selected and ready to record into. */
export function AddTrackButton() {
  const full = useStore((s) => s.vocalTracks >= LANES)
  const recording = useStore((s) => s.recording !== 'off')
  const addVocalTrack = useStore((s) => s.addVocalTrack)
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Add a vocal track"
      title={full ? `Up to ${LANES} vocal tracks` : 'Add a vocal track to record into'}
      disabled={full || recording}
      onClick={addVocalTrack}
    >
      {/* Track lanes with a plus. */}
      <Icon d="M4 7h11M4 12h11M4 17h7M18 14v6M15 17h6" />
    </button>
  )
}

/** One Export button with a small menu to pick MIDI or WAV. */
function ExportButton() {
  const hasChords = useStore((s) => s.chords.length > 0)
  const takes = useStore((s) => s.takes)
  const vocalNames = useStore((s) => s.vocalNames)
  const hasTake = takes.some(Boolean)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const [rendering, setRendering] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useDismiss(open, close, ref)

  const exportMidi = () => {
    const s = useStore.getState()
    download(songToMidi(s), `${exportName(s)}.mid`)
    setOpen(false)
  }
  const exportWav = async () => {
    const s = useStore.getState()
    setRendering(true)
    try {
      // The mix is what you hear: muted and un-soloed tracks are left out.
      const audible = audibleTracks(s)
      const takes = engine.allTakes.filter((t, lane): t is NonNullable<typeof t> => !!t && audible.vocals[lane])
      download(await songToWav(s, takes, audible.chords), `${exportName(s)}.wav`)
      setOpen(false)
    } finally {
      setRendering(false)
    }
  }
  const exportVocal = (lane: number) => {
    const s = useStore.getState()
    const take = engine.allTakes[lane]
    if (!take) return
    const slug = vocalTrackName(s, lane).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `vocal-${lane + 1}`
    download(takeToWav(s, take), `${exportName(s)}-${slug}.wav`)
    setOpen(false)
  }

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Export"
        disabled={!hasChords}
        aria-expanded={open}
        aria-controls="export-menu"
        onClick={() => setOpen(!open)}
        title="Download the progression"
      >
        <Icon d="M12 4v11M7 10l5 5 5-5M5 20h14" />
      </button>
      {open && (
        <div className="menu" id="export-menu" aria-label="Export as">
          <button type="button" className="menu-item" onClick={exportMidi} disabled={rendering}>
            <span className="menu-item-title">MIDI</span>
            <span className="menu-item-about">Chords and bass on separate tracks, for a DAW</span>
          </button>
          <button type="button" className="menu-item" onClick={exportWav} disabled={rendering} aria-live="polite">
            <span className="menu-item-title">{rendering ? 'Rendering…' : 'WAV'}</span>
            <span className="menu-item-about">24-bit audio, played through once{hasTake ? ', with the vocals' : ''}</span>
          </button>
          {takes.map(
            (t, lane) =>
              t && (
                <button type="button" key={lane} className="menu-item" onClick={() => exportVocal(lane)} disabled={rendering}>
                  <span className="menu-item-title">{vocalTrackName({ vocalNames }, lane)}</span>
                  <span className="menu-item-about">This take alone, lined up to bar 1</span>
                </button>
              ),
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A red dot when idle; during the count-in it counts down the beats left;
 * while recording it's solid red with a stop square.
 */
function RecordButton() {
  const recording = useStore((s) => s.recording)
  const countIn = useStore((s) => s.countIn)
  const hasChords = useStore((s) => s.chords.length > 0)
  const label = recording === 'off' ? 'Record a vocal (R)' : recording === 'count-in' ? 'Cancel recording (R)' : 'Stop recording (R)'
  return (
    <button
      type="button"
      className={`icon-btn record-btn is-${recording}`}
      aria-label={label}
      aria-pressed={recording !== 'off'}
      title={recording === 'off' ? 'Record a vocal over the loop (R). Headphones help keep the chords out of the take.' : label}
      disabled={!hasChords}
      onClick={() => void toggleRecord()}
    >
      {recording === 'count-in' ? (
        <span className="record-count" aria-live="assertive">
          {countIn ?? ''}
        </span>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          {recording === 'on' ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /> : <circle cx="12" cy="12" r="9" fill="currentColor" />}
        </svg>
      )}
    </button>
  )
}

function TempoField() {
  const bpm = useStore((s) => s.bpm)
  const setBpm = useStore((s) => s.setBpm)
  const [text, setText] = useState(String(bpm))
  useEffect(() => setText(String(bpm)), [bpm])

  return (
    <label className="lcd-cell" title="Tempo">
      <input
        className="tempo"
        type="number"
        inputMode="numeric"
        min={MIN_BPM}
        max={MAX_BPM}
        value={text}
        aria-label="Tempo in BPM"
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value !== '' && v >= MIN_BPM && v <= MAX_BPM) setBpm(v)
        }}
        onBlur={() => setText(String(bpm))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      <span className="lcd-label" aria-hidden="true">
        Tempo
      </span>
    </label>
  )
}

function IconToggle({ label, pressed, onClick, children }: { label: string; pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="icon-btn toggle-btn" aria-pressed={pressed} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  )
}

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
const PlayIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
  </svg>
)
const PauseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="5.5" y="4.5" width="4.5" height="15" rx="1.5" fill="currentColor" />
    <rect x="14" y="4.5" width="4.5" height="15" rx="1.5" fill="currentColor" />
  </svg>
)
