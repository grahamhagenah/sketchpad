import { useStore, vocalTrackName } from '../store'
import { checkLatency, deleteOneTake, deleteTake, toggleRecord, trimTake } from '../audio/engine'
import { trimOf, type TakeInfo, type Trim } from '../audio/take'
import { vocalColorId } from '../colors'
import { LevelSlider, MuteSoloRow, SheetSlider, TrackSheet } from './TrackSheet'
import { MicIcon } from './Timeline'

/**
 * The settings of a selected vocal track (a sheet on a phone, docked in the inspector otherwise): what's on it, mute,
 * solo, level and reverb, its takes to pick from, the recording timing check,
 * and buttons to record another take or delete it.
 */
export function VocalPad({ lane, docked }: { lane: number; docked?: boolean }) {
  const s = useStore()
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
      {/* How late this device's recordings arrive, measured so takes line up with the beat. */}
      <button
        type="button"
        className="track-sheet-link"
        onClick={() => void checkLatency()}
        title="Play a few clicks and listen for them, so takes line up with the beat on this device"
      >
        {s.latency === null ? 'Check recording timing' : `Recording timing ${Math.round(s.latency * 1000)} ms · check again`}
      </button>

      {/* Recording first, the width of the panel, then deleting the track under it. */}
      <div className="chord-pad-actions vocal-pad-actions">
        <button type="button" className="chord-pad-add vocal-pad-record" disabled={!s.chords.length} onClick={() => void toggleRecord()}>
          <span className="vocal-pad-record-dot" aria-hidden="true" />
          {take ? 'Record another take' : 'Record'}
        </button>
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
  const trimmed = !!trims[take.id]
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
