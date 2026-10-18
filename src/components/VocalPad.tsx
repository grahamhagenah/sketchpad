import { useFields, useStore, vocalTrackName } from '../store'
import { RecordOptions } from './RecordOptions'
import { deleteOneTake, deleteTake, learnFromNudge, nudgeTake, toggleRecord, trimTake } from '../audio/engine'
import { cuts, trimOf, type TakeInfo, type Trim } from '../audio/take'
import { vocalColorId } from '../colors'
import { LevelSlider, MuteSoloRow, SheetSlider, TrackSheet } from './TrackSheet'
import { MicIcon } from './Timeline'

/**
 * The settings of a selected vocal track (a sheet on a phone, docked in the inspector otherwise): what's on it, mute,
 * solo, level and reverb, its takes to pick from, the recording timing check,
 * and buttons to record another take or delete it.
 */
export function VocalPad({ lane, docked }: { lane: number; docked?: boolean }) {
  const s = useFields('allTakes', 'bpm', 'chords', 'latency', 'recording', 'renameVocal', 'selectVocal', 'setVocalColor', 'setVocalReverb', 'setVocalVolume', 'takes', 'timeSig', 'toggleVocalMute', 'toggleVocalSolo', 'trims', 'vocalColors', 'vocalMuted', 'vocalNames', 'vocalReverb', 'vocalSolo', 'vocalVolume')
  const name = vocalTrackName(s, lane)
  const take = s.takes[lane]
  const all = s.allTakes[lane] ?? []
  const reverb = s.vocalReverb[lane] ?? 0
  const perBar = s.timeSig[0]
  // Where the take starts playing and for how long, trimmed.
  const kept = take ? trimOf(take, s.trims[take.id]) : null
  const beatSeconds = (60 / s.bpm) * (4 / s.timeSig[1])
  const about =
    take && kept
      ? `${lengthOf(kept)} take, from bar ${Math.floor((take.startBeat + kept.start / beatSeconds) / perBar) + 1}`
      : 'Nothing recorded yet'

  return (
    <TrackSheet
      icon={<MicIcon />}
      name={name}
      onRename={(n) => s.renameVocal(lane, n)}
      color={vocalColorId(s.vocalColors, lane)}
      onColor={(c) => s.setVocalColor(lane, c)}
      docked={docked}
      onDone={() => s.selectVocal(null)}
    >
      <MuteSoloRow
        about={about}
        muted={!!s.vocalMuted[lane]}
        solo={!!s.vocalSolo[lane]}
        onMute={() => s.toggleVocalMute(lane)}
        onSolo={() => s.toggleVocalSolo(lane)}
      />
      <LevelSlider value={s.vocalVolume[lane] ?? 0} onChange={(db) => s.setVocalVolume(lane, db)} />
      <SheetSlider label="Reverb" min={0} max={1} step={0.01} value={reverb} text={`${Math.round(reverb * 100)}%`} onChange={(v) => s.setVocalReverb(lane, v)} />
      {take && <Takes lane={lane} take={take} all={all.length ? all : [take]} trims={s.trims} locked={s.recording !== 'off'} />}
      {take && <Timing id={take.id} nudge={s.trims[take.id]?.nudge ?? 0} locked={s.recording !== 'off'} />}
      {/* How this device records (the microphone, the count-in, hearing yourself, the timing), folded away until wanted. */}
      <details className="record-options-fold">
        <summary>Recording options</summary>
        <RecordOptions />
      </details>

      {/* Recording first, the width of the panel, then deleting the track under it. */}
      <div className="chord-pad-actions vocal-pad-actions">
        <button type="button" className="chord-pad-add vocal-pad-record" disabled={!s.chords.length} onClick={() => void toggleRecord()}>
          <span className="vocal-pad-record-dot" aria-hidden="true" />
          {take ? 'Record another take' : 'Record'}
        </button>
        {take && (
          <button type="button" className="chord-pad-replace" disabled={s.recording !== 'off'} onClick={() => deleteOneTake(lane, take.id)} title="Delete the take that plays, keeping the track (Delete); undo brings it back">
            Delete take
          </button>
        )}
        <button type="button" className="chord-pad-replace" onClick={() => void deleteTake(lane)} title="Delete this track and its takes; undo brings it back">
          Delete track
        </button>
      </div>
    </TrackSheet>
  )
}

/**
 * A track's takes, in the order they were recorded: tap one to play it in
 * the song instead, or delete one of several. Recording again adds another.
 */
function Takes({ lane, take, all, trims, locked }: { lane: number; take: TakeInfo; all: TakeInfo[]; trims: Record<string, Trim>; locked: boolean }) {
  const chooseTake = useStore((s) => s.chooseTake)
  const trimmed = cuts(take, trims[take.id])
  return (
    <div className="sound-section vocal-takes">
      <span className="sound-heading">Takes</span>
      <div className="vocal-take-list" role="radiogroup" aria-label="Takes">
        {all.map((t, i) => (
          <div key={t.id} className="vocal-take-item">
            <button type="button" role="radio" aria-checked={t.id === take.id} disabled={locked} onClick={() => chooseTake(lane, t.id)}>
              <span className="vocal-take-name">Take {i + 1}</span>
              <TakeShape peaks={t.peaks} />
              <span className="vocal-take-length">{lengthOf(trimOf(t, trims[t.id]))}</span>
            </button>
            {all.length > 1 && (
              <button type="button" className="vocal-take-delete" aria-label={`Delete take ${i + 1}`} title="Delete this take; undo brings it back" disabled={locked} onClick={() => deleteOneTake(lane, t.id)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="rhythm-about">
        {all.length > 1 ? 'Tap a take to play it in the song. ' : 'Record another take to try again; this one is kept. '}
        Drag the ends of a take on the timeline to trim it.
        {trimmed && (
          <>
            {' '}
            <button type="button" className="track-sheet-link" disabled={locked} onClick={() => trimTake(take.id, null)}>
              Restore the whole take
            </button>
          </>
        )}
      </p>
    </div>
  )
}

/** How far a nudge moves a take with each press, in seconds. */
const NUDGE_STEP = 0.01

/**
 * Moves the playing take earlier or later, to line it up by ear when it
 * came in late (or early); and, moved, a way to line new takes up on this
 * device the same way.
 */
function Timing({ id, nudge, locked }: { id: string; nudge: number; locked: boolean }) {
  const ms = Math.round(nudge * 1000)
  const set = (n: number) => nudgeTake(id, Math.round(n * 1000) / 1000)
  return (
    <div className="sound-section vocal-timing">
      <span className="sound-heading">Timing</span>
      <div className="chord-pad-length" role="group" aria-label="Move the take earlier or later">
        <button type="button" disabled={locked} onClick={() => set(nudge - NUDGE_STEP)} title="Move it 10 ms earlier, if it comes in late">
          Earlier
        </button>
        <span aria-live="polite">{ms === 0 ? 'As recorded' : `${Math.abs(ms)} ms ${ms < 0 ? 'earlier' : 'later'}`}</span>
        <button type="button" disabled={locked} onClick={() => set(nudge + NUDGE_STEP)} title="Move it 10 ms later, if it comes in early">
          Later
        </button>
      </div>
      {ms !== 0 && (
        <p className="rhythm-about">
          <button type="button" className="track-sheet-link" disabled={locked} onClick={() => set(0)}>
            Put it back
          </button>
          {' · '}
          <button type="button" className="track-sheet-link" disabled={locked} onClick={() => learnFromNudge(nudge)} title="Record new takes on this device moved the same way">
            Line up new takes the same way
          </button>
        </p>
      )}
    </div>
  )
}

/** A take's loudness over its length, drawn small: a bar for each slice. */
function TakeShape({ peaks }: { peaks: number[] }) {
  const count = 28
  const per = peaks.length / count
  const bars = Array.from({ length: count }, (_, i) => Math.max(0, ...peaks.slice(Math.floor(i * per), Math.ceil((i + 1) * per))))
  return (
    <svg className="vocal-take-shape" viewBox={`0 0 ${count * 3} 16`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b, i) => {
        const h = Math.max(1.5, b * 16)
        return <rect key={i} x={i * 3} y={(16 - h) / 2} width="2" height={h} rx="1" />
      })}
    </svg>
  )
}

/** How long a trimmed take plays, to a tenth of a second under ten seconds. */
const lengthOf = ({ start, end }: Trim) => {
  const seconds = end - start
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`
}
