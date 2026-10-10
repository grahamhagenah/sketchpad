import { useCallback, useId, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { useDismiss } from '../hooks/useDismiss'
import { useNarrow } from '../hooks/useNarrow'
import { useStore } from '../store'
import { CONTROLS, PRESETS, WAVES, changedFrom, instrumentOf, presetFor, type Sound } from '../audio/sound'
import { CHORD_RHYTHMS } from '../audio/arrange'
import { audition } from '../audio/engine'
import { loadPiano } from '../audio/instruments'
import { ArpSettings } from './ArpPanel'
import { SheetSlider, TrackSheet } from './TrackSheet'

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

/** On a phone, the sound and arpeggiator settings as a sheet along the bottom, styled as the tracks' are. */
export function ToolSheet({ which }: { which: 'sound' | 'arp' }) {
  return which === 'sound' ? (
    <TrackSheet name="Sound" title="Chord settings" icon={SOUND_ICON} onDone={closeSheet} dismiss>
      <SoundSettings />
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
          <SoundSettings />
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

const [PIANO, ...SYNTHS] = PRESETS

/**
 * The chords' sound and how they're played, in one short list: which sound
 * (the recorded piano or one of the synth's), its rhythm, the bass, and how
 * bright and roomy it is; the finer settings fold away under More.
 */
function SoundSettings() {
  const sound = useStore((s) => s.sound)
  const setSound = useStore((s) => s.setSound)
  const rhythm = useStore((s) => s.rhythm)
  const setRhythm = useStore((s) => s.setRhythm)
  const arpOn = useStore((s) => s.arp.on)
  const setArp = useStore((s) => s.setArp)
  const drumTrack = useStore((s) => s.drumTrack)
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)

  const picked = presetFor(sound)
  const base = PRESETS.find((p) => p.name === picked)
  const changed = !!base && changedFrom(sound, base.sound)
  const shows = (k: keyof Sound) => CONTROLS[instrumentOf(sound)].includes(k)

  // Picking a sound plays it; the piano's notes load the first time, and it plays once they're in.
  const choose = (p: (typeof PRESETS)[number]) => {
    setSound({ ...p.sound, preset: p.name, bass: sound.bass })
    if (p.sound.instrument !== 'piano') return preview()
    setLoading(true)
    loadPiano().then(preview, () => undefined).finally(() => setLoading(false))
  }
  const soundButton = (p: (typeof PRESETS)[number], className: string, children: ReactNode) => (
    <button type="button" role="radio" className={className} aria-checked={picked === p.name} title={p.about} onClick={() => choose(p)}>
      {children}
    </button>
  )

  const bass = sound.bass ? rhythm.bass : 'off'
  const setBass = (next: 'off' | 'held' | 'kick') => {
    if (next === 'off') setSound({ bass: false })
    else {
      setSound({ bass: true })
      setRhythm({ bass: next })
    }
    preview()
  }

  return (
    <div className="sound-body">
      <div className="sound-section" role="radiogroup" aria-label="Sound">
        <span className="sound-heading">Recorded</span>
        {soundButton(
          PIANO,
          'sound-piano',
          <>
            {PIANO.name}
            <span>{loading ? 'Loading…' : PIANO.about}</span>
          </>,
        )}
        <span className="sound-heading">Synth</span>
        <div className="sound-grid">{SYNTHS.map((p) => soundButton(p, '', p.name))}</div>
      </div>

      <div className="sound-section">
        <span className="sound-heading">Rhythm</span>
        <div className="sound-grid is-three" role="radiogroup" aria-label="Rhythm">
          {CHORD_RHYTHMS.map((r) => (
            <button key={r.id} type="button" role="radio" aria-checked={rhythm.chords === r.id} disabled={arpOn} onClick={() => setRhythm({ chords: r.id })}>
              {r.label}
            </button>
          ))}
        </div>
        {arpOn ? (
          <p className="rhythm-about">
            The arpeggiator is playing the chords.{' '}
            <button type="button" className="track-sheet-link" onClick={() => setArp({ on: false })}>
              Turn it off
            </button>
          </p>
        ) : (
          <p className="rhythm-about">{CHORD_RHYTHMS.find((r) => r.id === rhythm.chords)?.about}</p>
        )}
      </div>

      <div className="sound-section">
        <span className="sound-heading">Bass</span>
        <div className="sound-grid is-three" role="radiogroup" aria-label="Bass">
          {(
            [
              ['off', 'Off'],
              ['held', 'Held'],
              ['kick', 'With the kick'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={bass === id} onClick={() => setBass(id)}>
              {label}
            </button>
          ))}
        </div>
        <p className="rhythm-about">
          {bass === 'off'
            ? 'Just the chords'
            : bass === 'held'
              ? 'One long low note for each chord'
              : drumTrack
                ? 'Plays with the kick drum, and walks up into each new chord'
                : 'Plays with the kick drum once there’s a drum track; held until then'}
        </p>
      </div>

      <div className="sound-section">
        <SoundSlider label="Brightness" min={0} max={1} step={0.001} value={toSlider(sound.brightness)} format={(v) => `${(fromSlider(v) / 1000).toFixed(1)} kHz`} onChange={(v) => setSound({ brightness: fromSlider(v) })} />
        <SoundSlider label="Reverb" min={0} max={0.8} step={0.01} value={sound.reverb} format={percent} onChange={(reverb) => setSound({ reverb })} />
      </div>

      {/* The rest of the sound's shape, for whoever wants it, with a way back to where it started. */}
      <div className="sound-more-row">
        <button type="button" className="sound-more" aria-expanded={more} onClick={() => setMore(!more)}>
          More settings
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {changed && base && (
          <button
            type="button"
            className="track-sheet-link"
            onClick={() => {
              setSound({ ...base.sound, preset: base.name, bass: sound.bass })
              preview()
            }}
          >
            Reset {base.name}
          </button>
        )}
      </div>
      {/* Every setting shows whichever the sound, so the panel keeps its size; those it doesn't use are greyed out. */}
      {more && (
        <div className="sound-section">
          <div className="sound-grid" role="radiogroup" aria-label="Wave">
            {WAVES.map((w) => (
              <button
                key={w.id}
                type="button"
                role="radio"
                aria-checked={shows('wave') && sound.wave === w.id}
                disabled={!shows('wave')}
                title={shows('wave') ? undefined : 'This sound has its own wave'}
                onClick={() => {
                  setSound({ wave: w.id })
                  preview()
                }}
              >
                {w.label}
              </button>
            ))}
          </div>
          <SoundSlider label="Attack" min={0.001} max={2} step={0.001} curve value={sound.attack} format={seconds} disabled={!shows('attack')} onChange={(attack) => setSound({ attack })} />
          <SoundSlider label="Decay" min={0.05} max={3} step={0.01} curve value={sound.decay} format={seconds} disabled={!shows('decay')} onChange={(decay) => setSound({ decay })} />
          <SoundSlider label="Sustain" min={0} max={1} step={0.01} value={sound.sustain} format={percent} disabled={!shows('sustain')} onChange={(sustain) => setSound({ sustain })} />
          <SoundSlider label="Release" min={0.02} max={5} step={0.01} curve value={sound.release} format={seconds} disabled={!shows('release')} onChange={(release) => setSound({ release })} />
          <p className="rhythm-about">
            Piano recordings: Salamander Grand Piano by Alexander Holm, CC BY 3.0.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * One of the sound's settings, drawn like the tracks' sliders, playing a chord
 * when let go; `curve` spreads short times out, moving on a squared scale.
 */
function SoundSlider({ label, min, max, step, value, format, curve, onChange, disabled }: Omit<SliderProps, 'onRelease'> & { disabled?: boolean }) {
  const toPos = (v: number) => (curve ? Math.sqrt((v - min) / (max - min)) : (v - min) / (max - min))
  const fromPos = (p: number) => Math.round((min + (curve ? p * p : p) * (max - min)) / step) * step
  return <SheetSlider label={label} min={0} max={1} step={0.001} value={toPos(value)} text={disabled ? '–' : format(value)} disabled={disabled} onChange={(p) => onChange(fromPos(p))} onRelease={preview} />
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
