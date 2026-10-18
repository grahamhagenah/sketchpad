import { useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { useStore } from '../store'
import { BASS_KINDS, CONTROLS, PRESETS, WAVES, bassVoiceOf, changedFrom, extrasOf, hasTone, instrumentOf, presetFor, type BassVoice, type Sound } from '../audio/sound'
import { CHORD_RHYTHMS } from '../audio/arrange'
import { audition } from '../audio/engine'
import { loadPiano } from '../audio/instruments'
import { ArpSettings } from './ArpPanel'
import { CloseButton, SheetSlider, TrackSheet } from './TrackSheet'
import { setLyricsOpen, useLyricsPanel } from '../lyricsPanel'

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

/**
 * Which tool's settings are open: the sound, the arpeggiator, the key finder
 * or the open section's. On a wider screen, in a panel beside the tracks,
 * where the lyrics go, so they stay in view; on a phone, in the sheet along
 * the bottom (the section's, in its own menu).
 */
export type Tool = 'sound' | 'arp' | 'key' | 'section'
export const useToolSheet = create<{ open: Tool | null }>(() => ({ open: null }))
export const closeSheet = () => useToolSheet.setState({ open: null })

/** Opens a tool's settings, in the lyrics' place, or closes them if they're open. */
export function toggleTool(which: Tool) {
  const open = useToolSheet.getState().open === which
  if (!open) setLyricsOpen(false)
  useToolSheet.setState({ open: open ? null : which })
}

// One at a time in the lyrics' place: showing the lyrics puts the settings away.
useLyricsPanel.subscribe((s) => {
  if (s.open) closeSheet()
})

/** A toolbar button's panel: whether it's open, and opening or closing it. */
function usePanel(which: 'sound' | 'arp') {
  const open = useToolSheet((s) => s.open === which)
  return { open, toggle: () => toggleTool(which) }
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

/** On a wider screen, a tool's settings in a column beside the tracks, as the lyrics are, with the same header. */
export function ToolPanel({ id, name, children }: { id: string; name: string; children: ReactNode }) {
  return (
    <aside className="tool-panel" id={id} aria-label={name}>
      <div className="side-panel-head">
        <span className="column-title">{name}</span>
        <CloseButton onClick={closeSheet} title={`Close ${name.toLowerCase()}`} />
      </div>
      {children}
    </aside>
  )
}

/** On a phone, the sound and arpeggiator settings as a sheet along the bottom, styled as the tracks' are. */
export function ToolSheet({ which }: { which: 'sound' | 'arp' }) {
  return which === 'sound' ? (
    <TrackSheet name="Sound" icon={SOUND_ICON} onDone={closeSheet} dismiss>
      <SoundSettings />
    </TrackSheet>
  ) : (
    <TrackSheet name="Arpeggiator" icon={ARP_ICON} onDone={closeSheet} dismiss>
      <ArpSettings titled={false} />
    </TrackSheet>
  )
}

/** The chords' sound and rhythm: in a panel beside the tracks, or the sheet on a phone. */
export function SoundButton() {
  const { open, toggle } = usePanel('sound')

return (
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
  )
}

/** The arpeggiator's own button: lit while it's on, and opening its switch and settings. */
export function ArpButton() {
  const { open, toggle } = usePanel('arp')
  const arpOn = useStore((s) => s.arp.on)
  const label = `Arpeggiator (A)${arpOn ? ', on' : ''}`

return (
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
  )
}

const [PIANO, ...SYNTHS] = PRESETS

/**
 * The chords' sound and how they're played, in one short list: which sound
 * (the recorded piano or one of the synth's), its rhythm, the bass, and how
 * bright and roomy it is; the finer settings fold away under More.
 */
export function SoundSettings() {
  const sound = useStore((s) => s.sound)
  const setSound = useStore((s) => s.setSound)
  const rhythm = useStore((s) => s.rhythm)
  const setRhythm = useStore((s) => s.setRhythm)
  const arpOn = useStore((s) => s.arp.on)
  const setArp = useStore((s) => s.setArp)
  const drumTrack = useStore((s) => s.drumTrack)
  const [loading, setLoading] = useState(false)

  const picked = presetFor(sound)
  const base = PRESETS.find((p) => p.name === picked)
  const changed = !!base && changedFrom(sound, base.sound)
  const shows = (k: keyof Sound) => CONTROLS[instrumentOf(sound)].includes(k)
  const extras = extrasOf(sound)

  // Picking a sound plays it; the piano's notes load the first time, and it plays once they're in.
  const choose = (p: (typeof PRESETS)[number]) => {
    // A preset is the whole sound, its effects too (none, unless it has its own).
    setSound({ ...p.sound, ...extrasOf(p.sound), preset: p.name, bass: sound.bass })
    if (p.sound.instrument !== 'piano') return preview()
    setLoading(true)
    loadPiano().then(preview, () => undefined).finally(() => setLoading(false))
  }
  const soundButton = (p: (typeof PRESETS)[number], className: string, children: ReactNode) => (
    <button key={p.name} type="button" role="radio" className={className} aria-checked={picked === p.name} title={p.about} onClick={() => choose(p)}>
      {children}
    </button>
  )

  const bass = sound.bass ? rhythm.bass : 'off'
  const voice = bassVoiceOf(sound)
  // A change to the bass's sound plays a chord to hear it, a slider's once it's let go.
  const setVoice = (patch: Partial<BassVoice>, hear = true) => {
    setSound({ bassVoice: { ...voice, ...patch } })
    if (hear) preview()
  }
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
      {/* Beside each other on a wider screen: the chords' sound and its shape, then how the chords and the bass are played; on a phone, one list. */}
      <div className="sound-col">
        <div className="sound-section is-sounds" role="radiogroup" aria-label="Sound">
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

      {/*
        The shape of the sound, always to hand: its wave, how it starts, fades
        and stops, then how bright and roomy it is, with a way back to where
        the sound started. Every setting shows whichever the sound, so the
        panel keeps its size; those it doesn't use are greyed out.
      */}
        <div className="sound-section is-shape">
          <div className="sound-shape-head">
            <span className="sound-heading">Shape</span>
            {/* Always there, hidden until the sound's been changed, so showing it doesn't move anything. */}
            <button
              type="button"
              className="track-sheet-link"
              style={changed && base ? undefined : { visibility: 'hidden' }}
              aria-hidden={!(changed && base)}
              tabIndex={changed && base ? undefined : -1}
              onClick={() => {
                if (!base) return
                setSound({ ...base.sound, ...extrasOf(base.sound), preset: base.name, bass: sound.bass })
                preview()
              }}
            >
              Reset {base?.name ?? 'sound'}
            </button>
          </div>
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
          <SoundSlider
            label="Width"
            min={0}
            max={1}
            step={0.01}
            value={extras.width}
            format={percent}
            disabled={!shows('width') || (instrumentOf(sound) === 'synth' && sound.wave === 'sine')}
            onChange={(width) => setSound({ width })}
          />
          <SoundSlider label="Brightness" min={0} max={1} step={0.001} value={toSlider(sound.brightness)} format={(v) => `${(fromSlider(v) / 1000).toFixed(1)} kHz`} onChange={(v) => setSound({ brightness: fromSlider(v) })} />
          <SoundSlider label="Resonance" min={0} max={1} step={0.01} value={extras.resonance} format={percent} onChange={(resonance) => setSound({ resonance })} />
          <SoundSlider label="Reverb" min={0} max={0.8} step={0.01} value={sound.reverb} format={percent} onChange={(reverb) => setSound({ reverb })} />
          <p className="rhythm-about">Piano recordings: Salamander Grand Piano by Alexander Holm, CC BY 3.0.</p>
        </div>
      </div>
      <div className="sound-col">
        <div className="sound-section is-rhythm">
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

        <div className="sound-section is-bass">
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
          {/* How the bass sounds, while there is one: which bass, its octave, and how bright, slurred and loud it is. */}
          {bass !== 'off' && (
            <>
              <div className="sound-grid is-five" role="radiogroup" aria-label="Bass sound">
                {BASS_KINDS.map((k) => (
                  <button key={k.id} type="button" role="radio" aria-checked={voice.kind === k.id} title={k.about} onClick={() => setVoice({ kind: k.id })}>
                    {k.label}
                  </button>
                ))}
              </div>
              <p className="rhythm-about">{BASS_KINDS.find((k) => k.id === voice.kind)?.about}</p>
              <div className="sound-grid is-three" role="radiogroup" aria-label="Bass octave">
                {(
                  [
                    [-1, 'Low'],
                    [0, 'Mid'],
                    [1, 'High'],
                  ] as const
                ).map(([octave, label]) => (
                  <button key={octave} type="button" role="radio" aria-checked={voice.octave === octave} onClick={() => setVoice({ octave })}>
                    {label}
                  </button>
                ))}
              </div>
              <SoundSlider label="Tone" min={0} max={1} step={0.01} value={voice.tone} format={percent} disabled={!hasTone(voice.kind)} onChange={(tone) => setVoice({ tone }, false)} />
              <SoundSlider label="Glide" min={0} max={1} step={0.01} value={voice.glide} format={(v) => (v < 0.02 ? 'Off' : percent(v))} onChange={(glide) => setVoice({ glide }, false)} />
              <SoundSlider label="Level" min={-12} max={6} step={1} value={voice.level} format={(v) => (v === 0 ? '0 dB' : `${v > 0 ? '+' : '−'}${Math.abs(v)} dB`)} onChange={(level) => setVoice({ level }, false)} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * One of the sound's settings, drawn like the tracks' sliders, playing a chord
 * when let go; `curve` spreads short times out, moving on a squared scale.
 */
function SoundSlider({ label, min, max, step, value, format, curve, onChange, disabled }: SliderProps) {
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
  disabled?: boolean
}
