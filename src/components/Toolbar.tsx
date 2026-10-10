import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useDismiss } from '../hooks/useDismiss'
import { useDropBelow } from '../hooks/useDropBelow'
import { useNarrow } from '../hooks/useNarrow'
import { chordsTrackName, drumsTrackName, sectionsNow, useStore, vocalTrackName, TIME_SIGS, TIME_SIG_GROUPS, MIN_BPM, MAX_BPM, ZOOMS } from '../store'
import { keyLabel, type Mode } from '../music/theory'
import { engine, seek, togglePlay, toggleRecord } from '../audio/engine'
import { redo, undo, useHistory } from '../history'
import { SoundButton } from './SoundPanel'
import { Position } from './Position'
import { SongTitle } from './SongTitle'
import { download, exportName, placedTakes, songToMidi, songToStems, songToWav, takeToWav } from '../audio/export'
import { LANES } from '../audio/take'
import { playbackOf } from '../song'

/** The one bar for playback, song settings and editing the selected chord. */
export function Toolbar() {
  const { key: songKey, mode: songMode, timeSig, playing, metronome, loopOn } = useStore()
  const { setKey, setMode, setTimeSig, toggleMetronome, toggleLoop, setSectionKey } = useStore()
  // In a section with its own key, the display shows and changes that; otherwise the song's.
  const ownKey = useStore((s) => (s.view === 'section' ? s.sectionKey : null))
  const activeSection = useStore((s) => s.activeSection)
  const { key, mode } = ownKey ?? { key: songKey, mode: songMode }
  const narrow = useNarrow()

  // On a phone the bar is one slim row (play, record, where you are, the key) unless opened up for the rest.
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!narrow || !expanded) return
    // Opened up, it folds back as soon as you scroll on to work, but not for a scroll inside its own menus.
    const onScroll = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('.toolbar, .menu, .sound-panel')) return
      setExpanded(false)
    }
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [narrow, expanded])

  const meterCell = (
    <label className="lcd-cell lcd-meter" title="Time signature">
      <select
        aria-label="Time signature"
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
      <span className="lcd-label" aria-hidden="true">
        Time
      </span>
    </label>
  )
  const keyCell = (
    <label
      className={`lcd-cell lcd-key ${ownKey ? 'is-own-key' : ''}`}
      title={ownKey ? `This section’s own key; the song is in ${keyLabel(songKey, songMode)} ${songMode}` : 'Key'}
    >
      <select
        aria-label={ownKey ? 'This section’s key' : 'Key'}
        value={`${key}-${mode}`}
        onChange={(e) => {
          const [pc, m] = e.target.value.split('-')
          if (ownKey) return setSectionKey(activeSection, { key: Number(pc), mode: m as Mode })
          setKey(Number(pc))
          setMode(m as Mode)
        }}
      >
        {(['major', 'minor'] as const).map((m) => (
          <optgroup key={m} label={m === 'major' ? 'Major' : 'Minor'}>
            {Array.from({ length: 12 }, (_, pc) => (
              <option key={pc} value={`${pc}-${m}`}>
                {keyLabel(pc, m)} {m}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="lcd-label" aria-hidden="true">
        {ownKey ? 'Section key' : 'Key'}
      </span>
    </label>
  )
  const modes = (
    <div className="toolbar-icons toolbar-modes">
      <IconToggle label="Cycle (L)" pressed={loopOn} onClick={toggleLoop}>
        <Icon d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />
      </IconToggle>
      <IconToggle label="Metronome (M)" pressed={metronome} onClick={toggleMetronome}>
        <Icon d="M9 3h6l4 18H5zM12 15l5-8" />
      </IconToggle>
      <SoundButton />
    </div>
  )
  const playButton = (
    <button type="button" className={`play ${playing ? 'is-playing' : ''}`} onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
      {playing ? <PauseIcon /> : <PlayIcon />}
    </button>
  )

  if (narrow) {
    return (
      <div className={`toolbar toolbar-compact ${expanded ? 'is-expanded' : ''}`} role="toolbar" aria-label="Song">
        {/* The row that's always there: play and record, cycle, metronome and sound, undo and redo, and a button for the rest. */}
        <div className="toolbar-compact-row">
          <div className="transport" role="group" aria-label="Transport">
            {playButton}
            <RecordButton />
          </div>
          {modes}
          <div className="toolbar-icons toolbar-undo">
            <UndoRedo />
          </div>
          <button
            type="button"
            className="icon-btn toolbar-more"
            aria-label={expanded ? 'Fewer controls' : 'More controls'}
            aria-expanded={expanded}
            aria-controls="toolbar-extra"
            onClick={() => setExpanded(!expanded)}
            title="Title, save, export, where you are, tempo, meter and key"
          >
            <Icon d="M6 9l6 6 6-6" />
          </button>
        </div>
        {/* The rest, sliding open under the row, which stays just as it was. */}
        <div className="toolbar-extra" id="toolbar-extra" inert={!expanded}>
          <div className="toolbar-extra-inner">
            <div className="toolbar-extra-row">
              <SongTitle />
              <div className="toolbar-icons">
                <ExportButton />
              </div>
            </div>
            <div className="toolbar-extra-row">
              <div className="lcd" role="group" aria-label="Position and song settings">
                <Position />
                <TempoField />
                {meterCell}
                {keyCell}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Song">
      <div className="toolbar-zone">
        <SongTitle />
      </div>

      {/* In the middle, as in a DAW's control bar: the transport, then a display of where you are and the song's settings, then modes. */}
      <div className="toolbar-zone toolbar-center">
        <div className="transport" role="group" aria-label="Transport">
          <button type="button" className="to-start" onClick={() => void seek(0)} aria-label="Go to the start" title="Go to the start (↵)">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5" y="5" width="2.5" height="14" rx="1" fill="currentColor" />
              <path d="M19 5.5v13L9 12z" fill="currentColor" />
            </svg>
          </button>
          {playButton}
          <RecordButton />
        </div>

        <div className="lcd" role="group" aria-label="Position and song settings">
          <Position />
          <TempoField />
          {/* Meter and key, each a readout of its own, labelled like the bar and tempo. */}
          {meterCell}
          {keyCell}
        </div>

        {modes}
      </div>

      <div className="toolbar-zone toolbar-end">
        {/* What's selected has its settings in the inspector beside the tracks (on a phone, the sheet along the bottom). */}
        <div className="toolbar-icons">
          <UndoRedo />
        </div>
        <div className="toolbar-icons">
          <ExportButton />
        </div>
      </div>
    </div>
  )
}

/** Widens or narrows the beats on the timeline. The song always fills the width, so it zooms no further out than that. */
export function ZoomButtons() {
  const zoom = useStore((s) => s.zoom)
  const inSong = useStore((s) => s.view === 'song')
  const zoomBy = useStore((s) => s.zoomBy)
  return (
    <>
      <button type="button" className="icon-btn" aria-label="Zoom out" title="Zoom out (−)" disabled={zoom === ZOOMS[0] || (inSong && zoom <= 1)} onClick={() => zoomBy(-1)}>
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

/** What exports: the whole song, or the open section while the song has nothing in it. */
function exported(s = useStore.getState()) {
  const song = playbackOf(s, 'song')
  return song.chords.length ? song : playbackOf(s, 'section')
}

/** The song with every track playing, muted or not, for exports a DAW can mute tracks in itself. */
function unmuted(s: ReturnType<typeof useStore.getState>) {
  const quiet = Array(LANES).fill(false)
  return {
    ...s,
    chordsMuted: false,
    chordsSolo: false,
    drumsMuted: false,
    drumsSolo: false,
    vocalMuted: quiet,
    vocalSolo: quiet,
    sections: s.sections.map((sec) => ({ ...sec, vocalMuted: quiet, vocalSolo: quiet })),
  }
}

/** One Export button with a small menu to pick MIDI, WAV or stems. */
function ExportButton() {
  const hasChords = useStore((s) => s.chords.length > 0 || playbackOf(s, 'song').chords.length > 0)
  const takes = useStore((s) => s.takes)
  const vocalNames = useStore((s) => s.vocalNames)
  const sectionName = useStore((s) => s.sections.find((sec) => sec.id === s.activeSection)?.name ?? 'the section')
  const hasTake = useStore((s) => sectionsNow(s).some((sec) => sec.takes.some(Boolean)))
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const [rendering, setRendering] = useState<'wav' | 'stems' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useDismiss(open, close, ref)
  const below = useDropBelow(open, ref)

  const exportMidi = () => {
    const s = useStore.getState()
    // Every chord and drum hit, muted or not: in a DAW each track can be muted there.
    const song = exported(unmuted(s))
    download(songToMidi({ ...song, chords: song.chords.map((c) => ({ ...c, silent: false })) }), `${exportName(s)}.mid`)
    setOpen(false)
  }
  const exportWav = async () => {
    const s = useStore.getState()
    setRendering('wav')
    try {
      // The mix is what you hear: muted and un-soloed tracks are left out.
      const song = exported()
      download(await songToWav(song, placedTakes(song, (id) => engine.takeAudio(id))), `${exportName(s)}.wav`)
      setOpen(false)
    } finally {
      setRendering(null)
    }
  }
  const exportStems = async () => {
    const s = useStore.getState()
    setRendering('stems')
    try {
      // Every track, muted or not, as with MIDI.
      const song = exported(unmuted(s))
      const takes = placedTakes(song, (id) => engine.takeAudio(id))
      const names = { chords: chordsTrackName(s), drums: drumsTrackName(s), vocal: (track: number) => vocalTrackName(s, track) }
      download(await songToStems(song, takes, names), `${exportName(s)}-stems.zip`)
      setOpen(false)
    } finally {
      setRendering(null)
    }
  }
  const exportVocal = (lane: number) => {
    const s = useStore.getState()
    const info = s.takes[lane]
    const take = info && engine.takeAudio(info.id)
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
        <div className="menu" id="export-menu" aria-label="Export as" style={below}>
          <button type="button" className="menu-item" onClick={exportMidi} disabled={rendering !== null}>
            <span className="menu-item-title">MIDI</span>
            <span className="menu-item-about">The whole song’s chords, bass and drums on separate tracks, for a DAW</span>
          </button>
          <button type="button" className="menu-item" onClick={exportWav} disabled={rendering !== null} aria-live="polite">
            <span className="menu-item-title">{rendering === 'wav' ? 'Rendering…' : 'WAV'}</span>
            <span className="menu-item-about">The whole song as 24-bit audio{hasTake ? ', with the vocals' : ''}</span>
          </button>
          <button type="button" className="menu-item" onClick={exportStems} disabled={rendering !== null} aria-live="polite">
            <span className="menu-item-title">{rendering === 'stems' ? 'Rendering stems…' : 'Stems'}</span>
            <span className="menu-item-about">Each track as its own WAV, all from bar 1, in a zip for Logic</span>
          </button>
          {takes.map(
            (t, lane) =>
              t && (
                <button type="button" key={lane} className="menu-item" onClick={() => exportVocal(lane)} disabled={rendering !== null}>
                  <span className="menu-item-title">{vocalTrackName({ vocalNames }, lane)}</span>
                  <span className="menu-item-about">This take alone, lined up to the start of {sectionName}</span>
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
  // Vocals belong to a section, so they're recorded with one open.
  const inSong = useStore((s) => s.view === 'song')
  const label = recording === 'off' ? 'Record a vocal (R)' : recording === 'count-in' ? 'Cancel recording (R)' : 'Stop recording (R)'
  return (
    <button
      type="button"
      className={`icon-btn record-btn is-${recording}`}
      aria-label={label}
      aria-pressed={recording !== 'off'}
      title={
        inSong
          ? 'Open a section to record a vocal over it'
          : recording === 'off'
            ? 'Record a vocal over the loop (R). Headphones help keep the chords out of the take.'
            : label
      }
      disabled={!hasChords || (inSong && recording === 'off')}
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

export const Icon = ({ d }: { d: string }) => (
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
