import { useCallback, useId, useRef, useState } from 'react'
import { useDismiss } from '../hooks/useDismiss'
import { useStore } from '../store'
import { PRESETS, WAVES, presetFor, type Sound } from '../audio/sound'
import { audition } from '../audio/engine'
import { ArpSettings, RhythmSettings } from './ArpPanel'

// Brightness runs on a log scale, so the slider's travel matches what you hear.
const MIN_HZ = 300
const MAX_HZ = 9000
const toSlider = (hz: number) => Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)
const fromSlider = (v: number) => Math.round(MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, v))

const seconds = (s: number) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`)
const percent = (v: number) => `${Math.round(v * 100)}%`

/** Plays the selected chord, or the key's I chord, so a change can be heard. */
function preview() {
  const s = useStore.getState()
  const chord = s.chords.find((c) => c.id === s.selectedId) ?? { id: 'preview', degree: 0, beats: s.timeSig[0], seventh: false }
  audition(chord)
}

/** The chords' sound, rhythm and arpeggiator, as three tabs of one panel. A dot shows the arpeggiator is on. */
export function SoundButton() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'sound' | 'rhythm' | 'arp'>('sound')
  const close = useCallback(() => setOpen(false), [])
  const ref = useRef<HTMLDivElement>(null)
  const arpOn = useStore((s) => s.arp.on)
  useDismiss(open, close, ref)

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className={`icon-btn toggle-btn sound-btn ${arpOn ? 'has-arp' : ''}`}
        aria-label={`Sound, rhythm and arpeggiator${arpOn ? ', arpeggiator on' : ''}`}
        aria-expanded={open}
        aria-controls="sound-panel"
        onClick={() => setOpen(!open)}
        title={`Sound, rhythm and arpeggiator${arpOn ? ' (arpeggiator on)' : ''}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
      </button>
      {open && (
        <div className="menu sound-panel" id="sound-panel" role="group" aria-label="Sound, rhythm and arpeggiator">
          <div className="panel-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'sound'} onClick={() => setTab('sound')}>
              Sound
            </button>
            <button type="button" role="tab" aria-selected={tab === 'rhythm'} onClick={() => setTab('rhythm')}>
              Rhythm
            </button>
            <button type="button" role="tab" aria-selected={tab === 'arp'} onClick={() => setTab('arp')}>
              Arpeggiator{arpOn && <span className="tab-on" aria-label="on" />}
            </button>
          </div>
          {tab === 'sound' ? <SoundSettings /> : tab === 'rhythm' ? <RhythmSettings /> : <ArpSettings />}
        </div>
      )}
    </div>
  )
}

function SoundSettings() {
  const sound = useStore((s) => s.sound)
  const setSound = useStore((s) => s.setSound)
  const current = presetFor(sound)

  const choose = (next: Sound) => {
    setSound(next)
    preview()
  }

  return (
    <>
      <div className="sound-section">
        <span className="sound-heading">Preset</span>
        <div className="sound-chips">
          {PRESETS.map((p) => (
            <button type="button" key={p.name} className="chip" aria-pressed={current === p.name} onClick={() => choose(p.sound)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="sound-section">
        <span className="sound-heading">Wave</span>
        <div className="sound-chips">
          {WAVES.map((w) => (
            <button type="button" key={w.id} className="chip" aria-pressed={sound.wave === w.id} onClick={() => choose({ ...sound, wave: w.id })}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sound-sliders">
        <Slider label="Attack" min={0.001} max={2} step={0.001} value={sound.attack} format={seconds} curve onChange={(attack) => setSound({ attack })} onRelease={preview} />
        <Slider label="Decay" min={0.05} max={3} step={0.01} value={sound.decay} format={seconds} curve onChange={(decay) => setSound({ decay })} onRelease={preview} />
        <Slider label="Sustain" min={0} max={1} step={0.01} value={sound.sustain} format={percent} onChange={(sustain) => setSound({ sustain })} onRelease={preview} />
        <Slider label="Release" min={0.02} max={5} step={0.01} value={sound.release} format={seconds} curve onChange={(release) => setSound({ release })} onRelease={preview} />
        <Slider
          label="Brightness"
          min={0}
          max={1}
          step={0.001}
          value={toSlider(sound.brightness)}
          format={(v) => `${(fromSlider(v) / 1000).toFixed(1)} kHz`}
          onChange={(v) => setSound({ brightness: fromSlider(v) })}
          onRelease={preview}
        />
        <Slider label="Reverb" min={0} max={0.8} step={0.01} value={sound.reverb} format={percent} onChange={(reverb) => setSound({ reverb })} onRelease={preview} />
      </div>

      <div className="sound-foot">
        <label className="sound-toggle">
          <input type="checkbox" checked={sound.bass} onChange={(e) => setSound({ bass: e.target.checked })} />
          Bass note
        </label>
        <button type="button" className="chip" onClick={preview}>
          Preview
        </button>
      </div>
    </>
  )
}

interface SliderProps {
  label: string
  min: number
  max: number
  step: number
  value: number
  format: (v: number) => string
  /** Spread short times out: the slider moves on a squared scale. */
  curve?: boolean
  onChange: (v: number) => void
  /** Called when a drag or key press ends, e.g. to play a preview. */
  onRelease?: () => void
}

export function Slider({ label, min, max, step, value, format, curve, onChange, onRelease }: SliderProps) {
  const id = useId()
  const toPos = (v: number) => (curve ? Math.sqrt((v - min) / (max - min)) : (v - min) / (max - min))
  const fromPos = (p: number) => {
    const v = min + (curve ? p * p : p) * (max - min)
    return Math.round(v / step) * step
  }

  return (
    <div className="sound-slider">
      <div className="sound-slider-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={toPos(value)}
        style={{ ['--fill' as string]: `${toPos(value) * 100}%` }}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(fromPos(Number(e.target.value)))}
        onPointerUp={onRelease}
        onKeyUp={(e) => e.key.startsWith('Arrow') && onRelease?.()}
      />
    </div>
  )
}
