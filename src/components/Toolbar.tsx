import { useEffect, useState, type ReactNode } from 'react'
import { useStore, TIME_SIGS, MIN_BPM, MAX_BPM, type Chord } from '../store'
import { chordInfo, keyLabel, type Mode } from '../music/theory'
import { audition, togglePlay } from '../audio/engine'

/** The one bar for playback, song settings and editing the selected chord. */
export function Toolbar() {
  const { key, mode, timeSig, playing, metronome, loopOn, chords, selectedId } = useStore()
  const { setKey, setMode, setTimeSig, toggleMetronome, toggleLoop } = useStore()
  const { updateChord, removeChord, duplicateChord } = useStore()
  const chord = chords.find((c) => c.id === selectedId)

  const editChord = (c: Chord, patch: Partial<Omit<Chord, 'id'>>) => {
    updateChord(c.id, patch)
    audition({ ...c, ...patch })
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Song">
      <div className="toolbar-group">
        <button
          type="button"
          className={`play ${playing ? 'is-playing' : ''}`}
          onClick={togglePlay}
          aria-label={playing ? 'Stop' : 'Play'}
          title="Play / stop (Space)"
        >
          {playing ? <StopIcon /> : <PlayIcon />}
        </button>
        <IconToggle label="Metronome (M)" pressed={metronome} onClick={toggleMetronome}>
          <Icon d="M9 3h6l4 18H5zM12 15l5-8" />
        </IconToggle>
        <IconToggle label="Loop (L)" pressed={loopOn} onClick={toggleLoop}>
          <Icon d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />
        </IconToggle>
      </div>

      <div className="toolbar-group">
        <select aria-label="Key" title="Key" value={key} onChange={(e) => setKey(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, pc) => (
            <option key={pc} value={pc}>
              {keyLabel(pc, mode)}
            </option>
          ))}
        </select>
        <select aria-label="Mode" title="Mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="major">Major</option>
          <option value="minor">Minor</option>
        </select>
        <select
          aria-label="Time signature"
          title="Time signature"
          value={timeSig.join('/')}
          onChange={(e) => {
            const sig = TIME_SIGS.find((s) => s.join('/') === e.target.value)
            if (sig) setTimeSig(sig)
          }}
        >
          {TIME_SIGS.map((s) => (
            <option key={s.join('/')} value={s.join('/')}>
              {s.join('/')}
            </option>
          ))}
        </select>
        <TempoField />
      </div>

      <div className="toolbar-group toolbar-chord" aria-label="Selected chord" role="group">
        <select
          aria-label="Selected chord"
          title={chord ? 'Change the selected chord' : 'Select a chord to edit it'}
          className="chord-select"
          value={chord?.degree ?? ''}
          disabled={!chord}
          onChange={(e) => chord && editChord(chord, { degree: Number(e.target.value) })}
        >
          {!chord && <option value="">No chord selected</option>}
          {Array.from({ length: 7 }, (_, d) => {
            const o = chordInfo(key, mode, d, chord?.seventh ?? false)
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
          aria-pressed={chord?.seventh ?? false}
          disabled={!chord}
          onClick={() => chord && editChord(chord, { seventh: !chord.seventh })}
          title="Add 7th (S)"
        >
          7th
        </button>
        <button type="button" className="icon-btn" aria-label="Duplicate" title="Duplicate (D)" disabled={!chord} onClick={() => chord && duplicateChord(chord.id)}>
          <Icon d="M9 9h10v10H9zM5 15V5h10" />
        </button>
        <button type="button" className="icon-btn danger" aria-label="Delete" title="Delete (⌫)" disabled={!chord} onClick={() => chord && removeChord(chord.id)}>
          <Icon d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
        </button>
      </div>
    </div>
  )
}

function TempoField() {
  const bpm = useStore((s) => s.bpm)
  const setBpm = useStore((s) => s.setBpm)
  const [text, setText] = useState(String(bpm))
  useEffect(() => setText(String(bpm)), [bpm])

  return (
    <label className="tempo-field" title="Tempo">
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
      <span aria-hidden="true">bpm</span>
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
const StopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
  </svg>
)
