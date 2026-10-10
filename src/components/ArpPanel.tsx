import { useStore } from '../store'
import { ARP_PATTERNS, ARP_RATES, swings, type ArpPattern } from '../audio/arrange'
import { SheetSlider } from './TrackSheet'

const OCTAVES = [1, 2, 3] as const

/** What each pattern does, and a few notes drawn small in its order (heights from the top, 0 high to 1 low). */
const PATTERNS: Record<ArpPattern, { about: string; notes: number[][] }> = {
  up: { about: 'Lowest note to highest, then round again', notes: [[1], [0.67], [0.33], [0]] },
  down: { about: 'Highest note to lowest, then round again', notes: [[0], [0.33], [0.67], [1]] },
  updown: { about: 'Up to the top, then back down', notes: [[1], [0.5], [0], [0.5], [1]] },
  random: { about: 'The chord’s notes in a shuffled order', notes: [[0.5], [1], [0], [0.67]] },
  pulse: { about: 'The whole chord, struck again on every step', notes: [[0, 0.5, 1], [0, 0.5, 1], [0, 0.5, 1]] },
}

/** Each speed by name, under its fraction. */
const RATE_NAMES: Record<string, string> = { '1/4': 'Quarters', '1/8': 'Eighths', '1/8T': 'Triplets', '1/16': 'Sixteenths' }

/** A pattern's notes as dots, left to right. */
function PatternIcon({ pattern }: { pattern: ArpPattern }) {
  const steps = PATTERNS[pattern].notes
  const x = (i: number) => 3 + (i * 22) / Math.max(1, steps.length - 1)
  return (
    <svg className="arp-pattern" viewBox="0 0 28 14" aria-hidden="true">
      {steps.flatMap((ys, i) => ys.map((y, j) => <circle key={`${i}-${j}`} cx={x(i)} cy={2.5 + y * 9} r="2" />))}
    </svg>
  )
}

/** The arpeggiator's switch and settings, in the panel of its own button, or the sheet on a phone, laid out as the sound panel is. */
export function ArpSettings({ titled = true }: { titled?: boolean }) {
  const arp = useStore((s) => s.arp)
  const setArp = useStore((s) => s.setArp)
  const rate = ARP_RATES.find((r) => r.id === arp.rate)
  const pulse = arp.pattern === 'pulse'

  return (
    <div className="sound-body">
      <label className="arp-switch">
        <span>
          {/* In the sheet, its name is already over it. */}
          {titled && <span className="arp-switch-title">Arpeggiator</span>}
          <span className="arp-switch-about">Plays each chord one note at a time, in place of the rhythm</span>
        </span>
        <input type="checkbox" role="switch" checked={arp.on} onChange={(e) => setArp({ on: e.target.checked })} />
      </label>

      <fieldset className="arp-options" disabled={!arp.on}>
        <div className="sound-section">
          <span className="sound-heading">Pattern</span>
          <div className="sound-grid is-five" role="radiogroup" aria-label="Pattern">
            {ARP_PATTERNS.map((p) => (
              <button key={p.id} type="button" role="radio" className="is-tall" aria-checked={arp.pattern === p.id} onClick={() => setArp({ pattern: p.id })}>
                <PatternIcon pattern={p.id} />
                {p.label}
              </button>
            ))}
          </div>
          <p className="rhythm-about">{PATTERNS[arp.pattern].about}</p>
        </div>

        <div className="sound-section">
          <span className="sound-heading">Speed</span>
          <div className="sound-grid" role="radiogroup" aria-label="Speed">
            {ARP_RATES.map((r) => (
              <button key={r.id} type="button" role="radio" className="is-tall" aria-checked={arp.rate === r.id} onClick={() => setArp({ rate: r.id })}>
                {r.label}
                <span>{RATE_NAMES[r.id]}</span>
              </button>
            ))}
          </div>
          <p className="rhythm-about">
            {rate && `${rate.quarters === 1 ? 'One note' : `${Math.round(1 / rate.quarters)} notes`} to every quarter note`}
          </p>
        </div>

        <div className="sound-section">
          <span className="sound-heading">Range</span>
          <div className="sound-grid is-three" role="radiogroup" aria-label="Range">
            {OCTAVES.map((o) => (
              <button key={o} type="button" role="radio" aria-checked={!pulse && arp.octaves === o} disabled={pulse} onClick={() => setArp({ octaves: o })}>
                {o === 1 ? '1 octave' : `${o} octaves`}
              </button>
            ))}
          </div>
          <p className="rhythm-about">
            {pulse ? 'Pulse plays the chord where it is' : arp.octaves === 1 ? 'Stays with the chord as it is voiced' : `Climbs through ${arp.octaves} octaves before starting again`}
          </p>
        </div>

        {/* How it feels: how long the notes ring, how they swing, and how much the beat stands out. */}
        <div className="sound-section">
          <span className="sound-heading">Feel</span>
          <SheetSlider
            label="Length"
            min={0.1}
            max={1}
            step={0.01}
            value={arp.gate}
            text={arp.gate >= 0.95 ? 'Legato' : `${Math.round(arp.gate * 100)}%`}
            onChange={(gate) => setArp({ gate })}
          />
          <SheetSlider
            label="Swing"
            min={0}
            max={1}
            step={0.01}
            value={swings(arp.rate) ? arp.swing : 0}
            text={!swings(arp.rate) ? '–' : arp.swing < 0.02 ? 'Straight' : `${Math.round(arp.swing * 100)}%`}
            disabled={!swings(arp.rate)}
            reset={0}
            onChange={(swing) => setArp({ swing })}
          />
          <SheetSlider
            label="Accent"
            min={0}
            max={1}
            step={0.01}
            value={arp.accent}
            text={arp.accent < 0.02 ? 'Even' : `${Math.round(arp.accent * 100)}%`}
            reset={0}
            onChange={(accent) => setArp({ accent })}
          />
          {!swings(arp.rate) && <p className="rhythm-about">Swing works with eighths and sixteenths</p>}
        </div>
      </fieldset>
    </div>
  )
}
