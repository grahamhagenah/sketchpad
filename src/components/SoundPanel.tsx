import { useCallback, useId, useRef, useState } from 'react'
import { create } from 'zustand'
import { useDismiss } from '../hooks/useDismiss'
import { useNarrow } from '../hooks/useNarrow'
import { useStore } from '../store'
import { PRESETS, WAVES, presetFor, type Sound } from '../audio/sound'
import { audition } from '../audio/engine'
import { ArpSettings, RhythmSettings } from './ArpPanel'
import { TrackSheet } from './TrackSheet'

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

/** On a phone, which of the sound and arpeggiator settings is up in the sheet along the bottom, in place of a floating panel. */
export const useToolSheet = create<{ open: 'sound' | 'arp' | null }>(() => ({ open: null }))
const closeSheet = () => useToolSheet.setState({ open: null })

/** A toolbar panel's open state: its own on a wider screen, the sheet's on a phone. */
function usePanel(which: 'sound' | 'arp') {
  const narrow = useNarrow()
  const [floating, setFloating] = useState(false)
  const sheet = useToolSheet((s) => s.open === which)
  const close = useCallback(() => setFloating(false), [])
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(floating && !narrow, close, ref)
  const open = narrow ? sheet : floating
  const toggle = () => (narrow ? useToolSheet.setState({ open: sheet ? null : which }) : setFloating(!floating))
  return { ref, open, toggle, floating: open && !narrow }
}

const SOUND_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </svg>
)

const ARP_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    {/* Three notes climbing, beamed together: a chord played one note at a time. */}
    <circle cx="5.5" cy="19" r="2" fill="currentColor" stroke="none" />
    <circle cx="11.5" cy="15" r="2" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="11" r="2" fill="currentColor" stroke="none" />
    <path d="M7.5 19V5M13.5 15V5M19.5 11V5M7.5 5h12" />
  </svg>
)

/** The chords' sound and rhythm, as two tabs. */
function SoundTabs() {
  const [tab, setTab] = useState<'sound' | 'rhythm'>('sound')
  return (
    <>
      <div className="panel-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'sound'} onClick={() => setTab('sound')}>
          Sound
        </button>
        <button type="button" role="tab" aria-selected={tab === 'rhythm'} onClick={() => setTab('rhythm')}>
          Rhythm
        </button>
      </div>
      {tab === 'sound' ? <SoundSettings /> : <RhythmSettings />}
    </>
  )
}

/** On a phone, the sound and arpeggiator settings as a sheet along the bottom, styled as the tracks' are. */
export function ToolSheet({ which }: { which: 'sound' | 'arp' }) {
  return which === 'sound' ? (
    <TrackSheet name="Sound" title="Chord settings" icon={SOUND_ICON} onDone={closeSheet} dismiss>
      <SoundTabs />
    </TrackSheet>
  ) : (
    <TrackSheet name="Arpeggiator" title="Chord settings" icon={ARP_ICON} onDone={closeSheet} dismiss>
      <ArpSettings titled={false} />
    </TrackSheet>
  )
}

/** The chords' sound and rhythm: a panel from the button, or the sheet on a phone. */
export function SoundButton() {
  const { ref, open, toggle, floating } = usePanel('sound')

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className="icon-btn toggle-btn sound-btn"
        data-sheet-toggle
        aria-label="Sound and rhythm"
        aria-expanded={open}
        aria-controls="sound-panel"
        onClick={toggle}
        title="Sound and rhythm"
      >
        {SOUND_ICON}
      </button>
      {floating && (
        <div className="menu sound-panel" id="sound-panel" role="group" aria-label="Sound and rhythm">
          <SoundTabs />
        </div>
      )}
    </div>
  )
}

/** The arpeggiator's own button: lit while it's on, and opening its switch and settings. */
export function ArpButton() {
  const { ref, open, toggle, floating } = usePanel('arp')
  const arpOn = useStore((s) => s.arp.on)
  const label = `Arpeggiator (A)${arpOn ? ', on' : ''}`

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className={`icon-btn toggle-btn arp-btn ${arpOn ? 'is-lit' : ''}`}
        data-sheet-toggle
        aria-label={label}
        aria-expanded={open}
        aria-controls="arp-panel"
        onClick={toggle}
        title={label}
      >
        {ARP_ICON}
      </button>
      {floating && (
        <div className="menu sound-panel" id="arp-panel" role="group" aria-label="Arpeggiator">
          <ArpSettings />
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
