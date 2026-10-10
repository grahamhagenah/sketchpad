import { useStore } from '../store'
import { ARP_PATTERNS, ARP_RATES } from '../audio/arrange'
import { Slider } from './SoundPanel'

const OCTAVES = [1, 2, 3] as const

/** The arpeggiator's switch and settings, in the panel of its own button. */
export function ArpSettings({ titled = true }: { titled?: boolean }) {
  const arp = useStore((s) => s.arp)
  const setArp = useStore((s) => s.setArp)

  return (
    <>
      <label className="arp-switch">
        <span>
          {/* In the sheet, its name is already over it. */}
          {titled && <span className="arp-switch-title">Arpeggiator</span>}
          <span className="arp-switch-about">Plays each chord one note at a time</span>
        </span>
        <input type="checkbox" role="switch" checked={arp.on} onChange={(e) => setArp({ on: e.target.checked })} />
      </label>

      <fieldset className="arp-options" disabled={!arp.on}>
        <div className="sound-section">
          <span className="sound-heading">Pattern</span>
          <div className="sound-chips">
            {ARP_PATTERNS.map((p) => (
              <button type="button" key={p.id} className="chip" aria-pressed={arp.pattern === p.id} onClick={() => setArp({ pattern: p.id })}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sound-section">
          <span className="sound-heading">Rate</span>
          <div className="sound-chips">
            {ARP_RATES.map((r) => (
              <button type="button" key={r.id} className="chip" aria-pressed={arp.rate === r.id} onClick={() => setArp({ rate: r.id })}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="arp-row">
          <div className="sound-section">
            <span className="sound-heading">Octaves</span>
            <div className="sound-chips">
              {OCTAVES.map((o) => (
                <button
                  type="button"
                  key={o}
                  className="chip"
                  aria-pressed={arp.octaves === o}
                  disabled={arp.pattern === 'pulse'}
                  onClick={() => setArp({ octaves: o })}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
          <Slider
            label="Gate"
            min={0.1}
            max={1}
            step={0.01}
            value={arp.gate}
            format={(v) => (v >= 0.95 ? 'Legato' : `${Math.round(v * 100)}%`)}
            onChange={(gate) => setArp({ gate })}
          />
        </div>
      </fieldset>
    </>
  )
}
