import { useStore, vocalTrackName } from '../store'
import { checkLatency, deleteTake, toggleRecord } from '../audio/engine'
import { vocalColorId } from '../colors'
import { LevelSlider, MuteSoloRow, SheetSlider, TrackSheet } from './TrackSheet'
import { MicIcon } from './Timeline'

/**
 * The settings of a selected vocal track (a sheet on a phone, docked in the inspector otherwise): what's on it, mute,
 * solo, level and reverb, the recording timing check, and buttons to record
 * into it or delete it.
 */
export function VocalPad({ lane, docked }: { lane: number; docked?: boolean }) {
  const s = useStore()
  const name = vocalTrackName(s, lane)
  const take = s.takes[lane]
  const reverb = s.vocalReverb[lane] ?? 0
  const perBar = s.timeSig[0]
  const about = take ? `${Math.round(take.seconds)} s take, from bar ${Math.floor(take.startBeat / perBar) + 1}` : 'Nothing recorded yet'

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
      {/* How late this device's recordings arrive, measured so takes line up with the beat. */}
      <button
        type="button"
        className="track-sheet-link"
        onClick={() => void checkLatency()}
        title="Play a few clicks and listen for them, so takes line up with the beat on this device"
      >
        {s.latency === null ? 'Check recording timing' : `Recording timing ${Math.round(s.latency * 1000)} ms · check again`}
      </button>

      <div className="chord-pad-actions">
        <button type="button" className="chord-pad-replace" onClick={() => void deleteTake(lane)} title="Delete this track and its take; undo brings it back">
          Delete track
        </button>
        <button type="button" className="chord-pad-add vocal-pad-record" disabled={!s.chords.length} onClick={() => void toggleRecord()}>
          <span className="vocal-pad-record-dot" aria-hidden="true" />
          {take ? 'Record again' : 'Record'}
        </button>
      </div>
    </TrackSheet>
  )
}
