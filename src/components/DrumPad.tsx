import { drumsTrackName, useFields, useStore, type TimeSig } from '../store'
import { DEFAULT_DRUMS_COLOR } from '../colors'
import { FILLS, GROOVES, grooveFits, grooveHits, INTENSITIES, type DrumPiece, type GrooveId } from '../audio/drums'
import { LevelSlider, MuteSoloRow, TrackSheet } from './TrackSheet'
import { DrumIcon } from './Timeline'

/**
 * The settings of the selected drum track (a sheet on a phone, docked in the
 * inspector otherwise): the groove this section plays, each shown with its
 * pattern and what it does, or none; how busy it is; its fills; mute, solo
 * and level; and removing the drum track.
 */
export function DrumPad({ docked }: { docked?: boolean }) {
  const s = useFields('drumFill', 'drumIntensity', 'setDrumIntensity', 'drums', 'drumsColor', 'drumsMuted', 'drumsName', 'drumsSolo', 'drumsVolume', 'recording', 'removeDrumTrack', 'renameDrums', 'select', 'setDrumFill', 'setDrums', 'setDrumsColor', 'setDrumsVolume', 'timeSig', 'toggleDrumsMute', 'toggleDrumsSolo')
  const sectionName = useStore((st) => st.sections.find((sec) => sec.id === st.activeSection)?.name)
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
        about={`The groove in ${sectionName ?? 'this section'}; each section has its own`}
        muted={s.drumsMuted}
        solo={s.drumsSolo}
        onMute={s.toggleDrumsMute}
        onSolo={s.toggleDrumsSolo}
      />
      <div className={`drum-pad-grooves ${docked ? 'is-grid' : ''}`} role="radiogroup" aria-label="Groove">
        {GROOVES.map((g) => (
          <button
            key={g.id}
            type="button"
            role="radio"
            aria-checked={s.drums === g.id}
            // One written for another time signature plays as a backbeat; it waits for a meter it fits.
            disabled={locked || !grooveFits(g.id, s.timeSig)}
            title={grooveFits(g.id, s.timeSig) ? g.about : `${g.label} is written for 4/4`}
            onClick={() => s.setDrums(g.id)}
          >
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
      {/* Beside the tracks the grooves are a compact grid; what the picked one does is said under it. */}
      {docked && <p className="rhythm-about drum-pad-picked">{s.drums ? GROOVES.find((g) => g.id === s.drums)?.about : 'This section plays without drums'}</p>}
      <div className="sound-section">
        <span className="sound-heading">Intensity</span>
        <div className="sound-grid is-three" role="radiogroup" aria-label="Intensity">
          {INTENSITIES.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={s.drumIntensity === x.id} disabled={locked || !s.drums} title={x.about} onClick={() => s.setDrumIntensity(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <p className="rhythm-about">{s.drums ? INTENSITIES.find((x) => x.id === s.drumIntensity)?.about : 'Pick a groove to set how busy it is'}</p>
      </div>
      {/* A fill where the section ends, rolling into the next one, and every four bars if it's long. */}
      <div className="sound-section">
        <span className="sound-heading">Fill</span>
        <div className="sound-grid is-three" role="radiogroup" aria-label="Fill">
          {FILLS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={s.drumFill === f.id} disabled={locked || !s.drums} title={f.about} onClick={() => s.setDrumFill(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <p className="rhythm-about">{s.drums ? FILLS.find((f) => f.id === s.drumFill)?.about : 'Pick a groove to add fills to it'}</p>
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
 * One bar of a groove, drawn small and simply: snares (and claps and rim
 * clicks) along the top, kicks along the bottom, faint dots where the beats
 * fall; hats and cymbals are left out, as they'd crowd it.
 */
function GroovePattern({ groove, timeSig }: { groove: GrooveId | null; timeSig: TimeSig }) {
  const perBar = timeSig[0]
  const x = (beat: number) => 4 + (beat / perBar) * 56
  const rows: Partial<Record<DrumPiece, number>> = { snare: 7, clap: 7, rim: 7, kick: 16 }
  return (
    <svg className="drum-pad-pattern" viewBox="0 0 64 22" aria-hidden="true">
      {Array.from({ length: perBar }, (_, b) => (
        <circle key={b} cx={x(b)} cy={rows.kick} r="1" className="drum-pad-pattern-beat" />
      ))}
      {grooveHits(groove, timeSig, 0, perBar)
        .filter((h) => rows[h.piece] !== undefined)
        .map((h, i) => (
          <circle key={i} cx={x(h.beat)} cy={rows[h.piece]} r={h.velocity < 0.5 ? 1.6 : 2.6} className={`is-${h.piece}`} />
        ))}
    </svg>
  )
}
