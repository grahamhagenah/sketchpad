import { useCallback, useRef, useState } from 'react'
import { useDismiss } from '../hooks/useDismiss'
import { useStore } from '../store'
import { ARP_PATTERNS, ARP_RATES } from '../audio/arrange'
import { Slider } from './SoundPanel'

const OCTAVES = [1, 2, 3] as const

export function ArpButton() {
  const on = useStore((s) => s.arp.on)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, close, ref)

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className={`icon-btn toggle-btn ${on ? 'is-on' : ''}`}
        aria-label={`Arpeggiator, ${on ? 'on' : 'off'}`}
        aria-expanded={open}
        aria-controls="arp-panel"
        onClick={() => setOpen(!open)}
        title={`Arpeggiator: ${on ? 'on' : 'off'} (A to toggle)`}
      >
        {/* Rising notes on a piano roll. */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="2.5" y="16.5" width="5" height="3" rx="1.5" />
          <rect x="7.5" y="12" width="5" height="3" rx="1.5" />
          <rect x="12.5" y="7.5" width="5" height="3" rx="1.5" />
          <rect x="17.5" y="3" width="4" height="3" rx="1.5" />
        </svg>
      </button>
      {open && <ArpPanel />}
    </div>
  )
}

function ArpPanel() {
  const arp = useStore((s) => s.arp)
  const setArp = useStore((s) => s.setArp)

  return (
    <div className="menu sound-panel" id="arp-panel" role="group" aria-label="Arpeggiator">
      <label className="arp-switch">
        <span>
          <span className="arp-switch-title">Arpeggiator</span>
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
    </div>
  )
}
