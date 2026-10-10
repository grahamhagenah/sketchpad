import { drumsTrackName, sectionsNow, useStore, type TimeSig } from '../store'
import { DEFAULT_DRUMS_COLOR } from '../colors'
import { FILLS, GROOVES, grooveHits, type GrooveId } from '../audio/drums'
import { LevelSlider, MuteSoloRow, TrackSheet } from './TrackSheet'
import { DrumIcon } from './Timeline'

/**
 * The settings of the selected drum track (a sheet on a phone, docked in the
 * inspector otherwise): the groove this section plays, each shown with its
 * pattern and what it does, or none; its fills; mute, solo and level; and removing the
 * drum track.
 */
export function DrumPad({ docked }: { docked?: boolean }) {
  const s = useStore()
  const section = sectionsNow(s).find((sec) => sec.id === s.activeSection)
  const locked = s.recording !== 'off'

  return (
    <TrackSheet
      icon={<DrumIcon />}
      name={drumsTrackName(s)}
      onRename={s.renameDrums}
      color={s.drumsColor ?? DEFAULT_DRUMS_COLOR}
      onColor={s.setDrumsColor}
      docked={docked}
      onDone={() => s.select(null)}
    >
      <MuteSoloRow
        about={`The groove in ${section?.name ?? 'this section'}; each section has its own`}
        muted={s.drumsMuted}
        solo={s.drumsSolo}
        onMute={s.toggleDrumsMute}
        onSolo={s.toggleDrumsSolo}
      />
      <div className="drum-pad-grooves" role="radiogroup" aria-label="Groove">
        {GROOVES.map((g) => (
          <button key={g.id} type="button" role="radio" aria-checked={s.drums === g.id} disabled={locked} onClick={() => s.setDrums(g.id)}>
            <GroovePattern groove={g.id} timeSig={s.timeSig} />
            <span className="drum-pad-groove-text">
              <span className="drum-pad-groove-name">{g.label}</span>
              <span className="drum-pad-groove-about">{g.about}</span>
            </span>
          </button>
        ))}
        <button type="button" role="radio" aria-checked={!s.drums} disabled={locked} onClick={() => s.setDrums(null)}>
          <GroovePattern groove={null} timeSig={s.timeSig} />
          <span className="drum-pad-groove-text">
            <span className="drum-pad-groove-name">None</span>
            <span className="drum-pad-groove-about">This section plays without drums</span>
          </span>
        </button>
      </div>
      {/* A fill where the section ends, rolling into the next one, and every four bars if it's long. */}
      <div className="inspector-field">
        <span>Fill</span>
        <div className="chord-pad-seg section-sheet-copies" role="group" aria-label="Fill">
          {FILLS.map((f) => (
            <button key={f.id} type="button" aria-pressed={s.drumFill === f.id} disabled={locked || !s.drums} title={f.about} onClick={() => s.setDrumFill(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <LevelSlider value={s.drumsVolume} onChange={s.setDrumsVolume} />

      <div className="chord-pad-actions">
        <button type="button" className="chord-pad-replace" disabled={locked} onClick={s.removeDrumTrack} title="Remove the drum track from the whole song; each section keeps its groove if you add it back">
          Remove drum track
        </button>
      </div>
    </TrackSheet>
  )
}

/**
 * One bar of a groove, drawn small and simply: snares along the top, kicks
 * along the bottom, faint dots where the beats fall; hats are left out, as
 * they'd crowd it.
 */
function GroovePattern({ groove, timeSig }: { groove: GrooveId | null; timeSig: TimeSig }) {
  const perBar = timeSig[0]
  const x = (beat: number) => 4 + (beat / perBar) * 56
  const rows = { snare: 7, kick: 16 }
  return (
    <svg className="drum-pad-pattern" viewBox="0 0 64 22" aria-hidden="true">
      {Array.from({ length: perBar }, (_, b) => (
        <circle key={b} cx={x(b)} cy={rows.kick} r="1" className="drum-pad-pattern-beat" />
      ))}
      {grooveHits(groove, timeSig, 0, perBar)
        .filter((h) => h.piece !== 'hat')
        .map((h, i) => (
          <circle key={i} cx={x(h.beat)} cy={rows[h.piece as 'snare' | 'kick']} r="2.6" className={`is-${h.piece}`} />
        ))}
    </svg>
  )
}
