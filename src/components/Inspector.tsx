import { chordsTrackName, keyOf, totalBeats, useStore, type Chord } from '../store'
import { chordOf, type ChordBass, type ChordColor } from '../music/theory'
import { audition } from '../audio/engine'
import { DEFAULT_CHORDS_COLOR } from '../colors'
import { CloseButton, LevelSlider, MuteSoloRow, TrackSheet } from './TrackSheet'
import { VocalPad } from './VocalPad'
import { DrumPad } from './DrumPad'
import { SectionPanel } from './Sections'
import { KeysIcon } from './Timeline'
import { InspectorButton } from './InspectorToggle'

const COLORS: { id: ChordColor | undefined; label: string }[] = [
  { id: undefined, label: 'Triad' },
  { id: 'sus2', label: 'sus2' },
  { id: 'sus4', label: 'sus4' },
  { id: 'add9', label: 'add9' },
]
const BASSES: { id: ChordBass | undefined; label: string }[] = [
  { id: undefined, label: 'Root' },
  { id: 'third', label: '/3rd' },
  { id: 'fifth', label: '/5th' },
]

/**
 * On a wider screen, a column beside the track names with the settings of
 * whatever's selected, the same ones a phone shows in the sheet along the
 * bottom: a chord, the chords track, a vocal track or the drum track; with
 * nothing selected, the section's own.
 */
export function Inspector() {
  const s = useStore()
  const chord = s.chords.find((c) => c.id === s.selectedId)
  let body
  let title
  if (chord) [body, title] = [<ChordPanel chord={chord} />, 'Chord settings']
  else if (s.selectedVocal !== null) [body, title] = [<VocalPad lane={s.selectedVocal} docked />, 'Track settings']
  else if (s.drumsTrackSelected && s.drumTrack) [body, title] = [<DrumPad docked />, 'Track settings']
  else if (s.chordsTrackSelected && s.chords.length) [body, title] = [<ChordsTrackPad docked />, 'Track settings']
  else [body, title] = [<SectionPanel />, 'Section settings']
  return (
    <aside className="inspector" aria-label={title}>
      {/* Says whose settings these are, level with the Tracks title beside it. */}
      <div className="inspector-title">
        <h2 className="column-title">{title}</h2>
        {/* Hides the panel; with it hidden, the same button sits by the Tracks title to bring it back. */}
        <InspectorButton />
      </div>
      {body}
    </aside>
  )
}

/** The chords track's settings: mute, solo and level, and clearing it. */
export function ChordsTrackPad({ docked }: { docked?: boolean }) {
  const s = useStore()
  const bars = Math.ceil(totalBeats(s.chords) / s.timeSig[0])
  return (
    <TrackSheet
      icon={<KeysIcon />}
      name={chordsTrackName(s)}
      onRename={s.renameChords}
      color={s.chordsColor ?? DEFAULT_CHORDS_COLOR}
      onColor={s.setChordsColor}
      docked={docked}
      onDone={() => s.select(null)}
    >
      <MuteSoloRow
        about={`${s.chords.length} ${s.chords.length === 1 ? 'chord' : 'chords'}, ${bars} ${bars === 1 ? 'bar' : 'bars'}`}
        muted={s.chordsMuted}
        solo={s.chordsSolo}
        onMute={s.toggleChordsMute}
        onSolo={s.toggleChordsSolo}
      />
      <LevelSlider value={s.chordsVolume} onChange={s.setChordsVolume} />
      <div className="chord-pad-actions">
        <button type="button" className="chord-pad-replace" onClick={s.clearChords} title="Clear every chord in this section; undo brings them back">
          Clear chords
        </button>
      </div>
    </TrackSheet>
  )
}

/** The selected chord: which chord it is, its 7th, sus or add9, bass note and length, and duplicating or deleting it. */
function ChordPanel({ chord }: { chord: Chord }) {
  const s = useStore()
  const { key, mode } = keyOf(s)
  const info = chordOf(key, mode, chord)
  const perBar = s.timeSig[0]
  const bars = chord.beats / perBar
  const length = Number.isInteger(bars) ? `${bars} ${bars === 1 ? 'bar' : 'bars'}` : `${chord.beats} ${chord.beats === 1 ? 'beat' : 'beats'}`
  const edit = (patch: Partial<Omit<Chord, 'id'>>) => {
    s.updateChord(chord.id, patch)
    if (!('beats' in patch)) audition({ ...chord, ...patch })
  }

  return (
    <div className="track-sheet is-docked" role="region" aria-label={`${info.name} settings`}>
      <div className="track-sheet-head">
        <span className="inspector-chord">
          {info.name}
          <span className="chord-pad-roman">{info.roman}</span>
        </span>
        <CloseButton onClick={() => s.select(null)} title="Back to the section (Esc)" />
      </div>

      <label className="inspector-field">
        <span>Chord</span>
        <select value={chord.degree} onChange={(e) => edit({ degree: Number(e.target.value) })}>
          {Array.from({ length: 7 }, (_, d) => {
            const o = chordOf(key, mode, { ...chord, degree: d })
            return (
              <option key={d} value={d}>
                {o.name} — {o.roman}
              </option>
            )
          })}
        </select>
      </label>
      <div className="inspector-field">
        <span>Colour</span>
        <div className="chord-pad-seg" role="group" aria-label="Sus or added note">
          {COLORS.map((c) => (
            <button type="button" key={c.label} aria-pressed={chord.color === c.id} onClick={() => edit({ color: c.id })}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="inspector-field">
        <span>Bass</span>
        <div className="chord-pad-seg" role="group" aria-label="Bass note">
          {BASSES.map((b) => (
            <button type="button" key={b.label} aria-pressed={chord.bass === b.id} onClick={() => edit({ bass: b.id })}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
      <div className="inspector-field">
        <span>7th</span>
        <div className="chord-pad-seg" role="group" aria-label="7th">
          <button type="button" aria-pressed={!chord.seventh} onClick={() => edit({ seventh: false })}>
            Off
          </button>
          <button type="button" aria-pressed={chord.seventh} onClick={() => edit({ seventh: true })} title="Add 7th (S)">
            7th
          </button>
        </div>
      </div>
      <div className="inspector-field">
        <span>Length</span>
        <div className="chord-pad-length" role="group" aria-label="Length">
          <button type="button" aria-label="Shorter" title="Shorter ([)" disabled={chord.beats <= 1} onClick={() => edit({ beats: chord.beats - 1 })}>
            −
          </button>
          <span>{length}</span>
          <button type="button" aria-label="Longer" title="Longer (])" onClick={() => edit({ beats: chord.beats + 1 })}>
            +
          </button>
        </div>
      </div>

      <div className="chord-pad-actions">
        <button type="button" className="chord-pad-replace" onClick={() => s.duplicateChord(chord.id)} title="Duplicate (D)">
          Duplicate
        </button>
        <button type="button" className="chord-pad-replace" onClick={() => s.removeChord(chord.id)} title="Delete (⌫)">
          Delete
        </button>
      </div>
    </div>
  )
}
