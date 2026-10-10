import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { keyOf, useStore, type Chord } from '../store'
import { BORROWED, chordOf, keyLabel, nextChords, type ChordBass, type ChordColor } from '../music/theory'
import { audition } from '../audio/engine'
import { Icon } from './Toolbar'

/** How the keys voice each chord, as the chord pad's options do. */
interface Voicing {
  seventh: boolean
  color: ChordColor | null
  bass: ChordBass | null
}

const COLORS: { id: ChordColor | null; label: string }[] = [
  { id: null, label: 'Triad' },
  { id: 'sus2', label: 'sus2' },
  { id: 'sus4', label: 'sus4' },
  { id: 'add9', label: 'add9' },
]
const BASSES: { id: ChordBass | null; label: string }[] = [
  { id: null, label: 'Root' },
  { id: 'third', label: '/3rd' },
  { id: 'fifth', label: '/5th' },
]

/**
 * Whether the keys are out, and where they float, are habits of the device's
 * owner, kept on it rather than with the song.
 */
const KEY = 'bounce-chord-keys'
type Place = { x: number; y: number } | null
const saved = (): { open: boolean; place: Place } => {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (kept && typeof kept.open === 'boolean') return { open: kept.open, place: kept.place ?? null }
  } catch {
    // Not kept: closed, in its usual place.
  }
  return { open: false, place: null }
}
const keep = (state: { open: boolean; place: Place }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Kept for this visit only.
  }
}

export const useChordKeys = create(saved)

export function toggleChordKeys() {
  const next = { ...useChordKeys.getState(), open: !useChordKeys.getState().open }
  useChordKeys.setState(next)
  keep(next)
}

/** A button in the top bar to bring the keys out or put them away; K does it too. */
export function ChordKeysButton() {
  const open = useChordKeys((s) => s.open)
  return (
    <button
      type="button"
      className="icon-btn toggle-btn"
      aria-pressed={open}
      aria-label="Chord keys (K)"
      title="Chord keys (K)"
      onClick={toggleChordKeys}
    >
      <Icon d="M3 5h18v14H3zM8 5v8M13 5v8M18 5v8M8 13v6M13 13v6M18 13v6" />
    </button>
  )
}

/**
 * On a wider screen, a keyboard floating over the editor with every chord in
 * the key, the usual ones and those borrowed from the parallel key, to play
 * and try out without touching the timeline. Press a key (or ⇧1–⇧7 for the
 * key's own chords) to hear it, even with the song playing; its + adds it
 * after the selected chord. The voicing above the keys applies to them all.
 * Drag it by its top to move it anywhere; it stays where it's left.
 */
export function ChordKeys() {
  const state = useStore()
  const { key, mode } = keyOf(state)
  const place = useChordKeys((s) => s.place)
  const [voicing, setVoicing] = useState<Voicing>({ seventh: false, color: null, bass: null })
  const [lit, setLit] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const editing = state.view === 'section' && state.recording === 'off'

  const keys = [
    ...Array.from({ length: 7 }, (_, degree) => ({ degree, borrowed: false })),
    ...BORROWED[mode].map((degree) => ({ degree, borrowed: true })),
  ]
  const id = (k: { degree: number; borrowed: boolean }) => `${k.borrowed ? 'b' : ''}${k.degree}`
  const asChord = (k: { degree: number; borrowed: boolean }): Chord => ({
    id: 'key',
    degree: k.degree,
    beats: state.timeSig[0],
    seventh: voicing.seventh,
    ...(k.borrowed && { borrowed: true }),
    ...(voicing.color && { color: voicing.color }),
    ...(voicing.bass && { bass: voicing.bass }),
  })

  const play = (k: { degree: number; borrowed: boolean }) => {
    audition(asChord(k), true)
    setLit(id(k))
  }
  // A key stays lit for a moment after it's played.
  useEffect(() => {
    if (!lit) return
    const t = setTimeout(() => setLit(null), 220)
    return () => clearTimeout(t)
  }, [lit])

  const add = (k: { degree: number; borrowed: boolean }) => {
    const s = useStore.getState()
    s.addChord(k.degree, k.borrowed)
    const added = useStore.getState().selectedId
    if (!added) return
    s.updateChord(added, { seventh: voicing.seventh, color: voicing.color ?? undefined, bass: voicing.bass ?? undefined })
    play(k)
    requestAnimationFrame(() => document.querySelector('.chord.is-selected')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }))
  }

  // ⇧1–⇧7 play the key's own chords, as 1–7 add them.
  const playRef = useRef(play)
  playRef.current = play
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if ((e.target as HTMLElement).closest('input, select, textarea')) return
      const n = /^Digit([1-7])$/.exec(e.code)
      if (!n) return
      e.preventDefault()
      playRef.current({ degree: Number(n[1]) - 1, borrowed: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Kept on the screen: where it was left, pulled back in if the window has since narrowed.
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current
      if (!el) return
      const w = el.offsetWidth
      const h = el.offsetHeight
      const want = place ?? { x: (window.innerWidth - w) / 2, y: window.innerHeight - h - 48 }
      setAt({ x: Math.min(Math.max(8, want.x), window.innerWidth - w - 8), y: Math.min(Math.max(8, want.y), window.innerHeight - h - 8) })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [place])

  // Dragged by its top bar; dropped, it stays there.
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button') || !at) return
    drag.current = { dx: e.clientX - at.x, dy: e.clientY - at.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const el = ref.current
    if (!drag.current || !el) return
    setAt({
      x: Math.min(Math.max(8, e.clientX - drag.current.dx), window.innerWidth - el.offsetWidth - 8),
      y: Math.min(Math.max(8, e.clientY - drag.current.dy), window.innerHeight - el.offsetHeight - 8),
    })
  }
  const onPointerUp = () => {
    if (!drag.current) return
    drag.current = null
    if (!at) return
    const next = { open: true, place: at }
    useChordKeys.setState(next)
    keep(next)
  }

  // What usually comes after the selected chord (or the last), where a new one would go.
  const last = state.chords.find((c) => c.id === state.selectedId) ?? state.chords[state.chords.length - 1] ?? null
  const hints = editing ? nextChords(mode, last && { degree: last.degree, borrowed: last.borrowed }) : []
  const hinted = (k: { degree: number; borrowed: boolean }) => hints.some((h) => h.degree === k.degree && !!h.borrowed === k.borrowed)

  return (
    <div
      className="chord-keys"
      ref={ref}
      role="region"
      aria-label="Chord keys"
      style={at ? { left: at.x, top: at.y } : { visibility: 'hidden' }}
    >
      <div className="chord-keys-head" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <span className="chord-keys-grip" aria-hidden="true" />
        <span className="chord-keys-title">
          Chord keys <span className="chord-keys-key">{keyLabel(key, mode)} {mode}</span>
        </span>
        <div className="chord-pad-seg chord-keys-seg" role="group" aria-label="Sus or added note">
          {COLORS.map((c) => (
            <button type="button" key={c.label} aria-pressed={voicing.color === c.id} onClick={() => setVoicing({ ...voicing, color: c.id })}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="chord-pad-seg chord-keys-seg" role="group" aria-label="7th">
          <button type="button" aria-pressed={voicing.seventh} onClick={() => setVoicing({ ...voicing, seventh: !voicing.seventh })} title="Play them with a 7th">
            7th
          </button>
        </div>
        <div className="chord-pad-seg chord-keys-seg" role="group" aria-label="Bass note">
          {BASSES.map((b) => (
            <button type="button" key={b.label} aria-pressed={voicing.bass === b.id} onClick={() => setVoicing({ ...voicing, bass: b.id })}>
              {b.label}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn chord-keys-close" aria-label="Put the chord keys away" title="Close (K)" onClick={toggleChordKeys}>
          <Icon d="M6 6l12 12M18 6L6 18" />
        </button>
      </div>

      <div className="chord-keys-row">
        {keys.map((k, i) => {
          const info = chordOf(key, mode, asChord(k))
          const kid = id(k)
          return (
            <div key={kid} className={`chord-key ${k.borrowed ? 'is-borrowed' : ''} ${i === 7 ? 'is-first-borrowed' : ''} ${lit === kid ? 'is-lit' : ''} ${hinted(k) ? 'is-hinted' : ''}`}>
              <button
                type="button"
                className="chord-key-play"
                aria-label={`Play ${info.name}, ${info.roman}${k.borrowed ? ', borrowed' : ''}${hinted(k) ? ', a usual next chord' : ''}`}
                title={k.borrowed ? `${info.name}, borrowed from ${mode === 'major' ? 'minor' : 'major'}` : `${info.name} (⇧${k.degree + 1})`}
                // Sounds as the key goes down, as a key does; Enter or Space from the keyboard play it too.
                onPointerDown={(e) => e.button === 0 && play(k)}
                onClick={(e) => e.detail === 0 && play(k)}
              >
                <span className="chord-key-name">{info.name}</span>
                <span className="chord-key-roman">{info.roman}</span>
                {/* A borrowed chord has no shortcut, but keeps the line, so its name sits level with the rest. */}
                <span className="chord-key-hint" aria-hidden="true">
                  {k.borrowed ? '\u00a0' : `⇧${k.degree + 1}`}
                </span>
              </button>
              {editing && (
                <button type="button" className="chord-key-add" aria-label={`Add ${info.name}`} title={`Add ${info.name} after the ${state.selectedId ? 'selected chord' : 'last chord'}`} onClick={() => add(k)}>
                  <Icon d="M12 6v12M6 12h12" />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
