import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { keyOf, useStore, type Chord } from '../store'
import { BORROWED, chordOf, keyLabel, nextChords, type ChordBass, type ChordColor } from '../music/theory'
import { audition } from '../audio/engine'

/** The chord to add: picked on a pad, with its options. */
interface Pick {
  degree: number
  borrowed: boolean
  seventh: boolean
  color: ChordColor | null
  bass: ChordBass | null
  beats: number
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

/** The pick as a chord, to name and play. */
const asChord = (p: Pick, id = 'pick'): Chord => ({
  id,
  degree: p.degree,
  beats: p.beats,
  seventh: p.seventh,
  ...(p.borrowed && { borrowed: true }),
  ...(p.color && { color: p.color }),
  ...(p.bass && { bass: p.bass }),
})

/** Tap-to-add is a habit of the device's owner, kept on it rather than with the song. */
const QUICK_KEY = 'bounce-quick-add'
const savedQuick = () => {
  try {
    return localStorage.getItem(QUICK_KEY) === '1'
  } catch {
    return false
  }
}

/** How far the panel is dragged down before it folds, or up before it opens. */
const FOLD_PX = 60
const OPEN_PX = 30

/**
 * On a phone, a sheet along the bottom of a section for building its chords
 * by touch: every chord in the key as a pad to tap and hear (the ones that
 * usually come next marked), and a button to add it after the last or swap
 * the selected chord for it. With a chord selected, the sheet edits it too
 * (its options, duplicating, deleting), which the top bar does on a wider
 * screen. With "Tap to add" a tap adds a chord straight away, with a moment to
 * undo. Drag the handle (or tap it) to fold the sheet down to a bar and back.
 */
export function ChordPad() {
  const state = useStore()
  const { key, mode } = keyOf(state)
  const { selectedId, chords, timeSig } = state
  const selected = chords.find((c) => c.id === selectedId)
  const [open, setOpen] = useState(true)
  const [showOptions, setShowOptions] = useState(false)
  const [quick, setQuick] = useState(savedQuick)
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null)
  const [pick, setPick] = useState<Pick>({ degree: 0, borrowed: false, seventh: false, color: null, bass: null, beats: timeSig[0] })
  const ref = useRef<HTMLDivElement>(null)

  // Leave room under the page for the sheet, however tall it is, so the timeline can scroll clear of it.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const observer = new ResizeObserver(() => root.style.setProperty('--chord-pad-h', `${el.offsetHeight}px`))
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--chord-pad-h')
    }
  }, [open])

  // The "Added" note fades after a few seconds.
  useEffect(() => {
    if (!added) return
    const t = setTimeout(() => setAdded(null), 3000)
    return () => clearTimeout(t)
  }, [added])

  const setQuickAdd = (on: boolean) => {
    setQuick(on)
    try {
      localStorage.setItem(QUICK_KEY, on ? '1' : '0')
    } catch {
      // Kept for this visit only.
    }
  }

  const add = (p: Pick) => {
    const s = useStore.getState()
    // After the selected chord, or at the end; the new one is then selected, so the next goes after it.
    s.addChord(p.degree, p.borrowed)
    const id = useStore.getState().selectedId
    if (!id) return
    s.updateChord(id, { seventh: p.seventh, color: p.color ?? undefined, bass: p.bass ?? undefined, beats: p.beats })
    setAdded({ id, name: chordOf(key, mode, asChord(p)).name })
    // Bring the new chord into view.
    requestAnimationFrame(() => document.querySelector('.chord.is-selected')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }))
  }

  const choose = (patch: Partial<Pick>, addIt = false) => {
    const next = { ...pick, ...patch }
    setPick(next)
    if (!('beats' in patch)) audition(asChord(next))
    if (addIt) add(next)
  }

  // The options shown are the selected chord's, if there is one, or else those of the chord to add.
  const target = selected ? { seventh: selected.seventh, color: selected.color ?? null, bass: selected.bass ?? null, beats: selected.beats } : pick
  const setOption = (patch: Partial<Pick>) => {
    // Set on the chord to add as well, so the next one added goes on in the same way.
    setPick({ ...pick, ...patch })
    if (!selected) return choose(patch)
    const update = {
      ...('seventh' in patch && { seventh: patch.seventh }),
      ...('color' in patch && { color: patch.color ?? undefined }),
      ...('bass' in patch && { bass: patch.bass ?? undefined }),
      ...('beats' in patch && { beats: patch.beats }),
    }
    useStore.getState().updateChord(selected.id, update)
    if (!('beats' in patch)) audition({ ...selected, ...update })
  }

  // Swaps the selected chord for the picked one, keeping its options and length.
  const replace = () => {
    if (!selected) return
    const swapped = { ...selected, degree: pick.degree, borrowed: pick.borrowed || undefined }
    useStore.getState().updateChord(selected.id, { degree: pick.degree, borrowed: pick.borrowed || undefined })
    audition(swapped)
  }

  // Dragging the handle folds or opens the sheet; a tap on it does too.
  const [dragY, setDragY] = useState(0)
  const drag = useRef<{ y: number; moved: boolean } | null>(null)
  const handleDown = (e: PointerEvent<HTMLElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, moved: false }
  }
  const handleMove = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return
    const dy = e.clientY - drag.current.y
    if (Math.abs(dy) > 4) drag.current.moved = true
    // Open, it follows the finger down; folded, it waits for a pull up.
    if (open) setDragY(Math.max(0, dy))
  }
  const handleUp = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    drag.current = null
    setDragY(0)
    if (!d) return
    const dy = e.clientY - d.y
    if (!d.moved) setOpen(!open)
    else if (open && dy > FOLD_PX) setOpen(false)
    else if (!open && dy < -OPEN_PX) setOpen(true)
  }
  const handleCancel = () => {
    drag.current = null
    setDragY(0)
  }
  const handle = { onPointerDown: handleDown, onPointerMove: handleMove, onPointerUp: handleUp, onPointerCancel: handleCancel }

  const pads = [
    ...Array.from({ length: 7 }, (_, degree) => ({ degree, borrowed: false })),
    ...BORROWED[mode].map((degree) => ({ degree, borrowed: true })),
  ]
  // What usually comes after the selected chord (or the last), since that's where a new one goes.
  const last = selected ?? chords[chords.length - 1] ?? null
  const hints = nextChords(mode, last && { degree: last.degree, borrowed: last.borrowed })
  const hinted = (p: { degree: number; borrowed: boolean }) => hints.some((h) => h.degree === p.degree && !!h.borrowed === p.borrowed)
  const picked = chordOf(key, mode, asChord(pick))
  const bars = target.beats / timeSig[0]
  const length = Number.isInteger(bars) ? `${bars} ${bars === 1 ? 'bar' : 'bars'}` : `${target.beats} beats`
  // The options chip says which are set, when any are.
  const summary = [
    target.seventh && '7th',
    target.color,
    target.bass && BASSES.find((b) => b.id === target.bass)?.label,
    target.beats !== timeSig[0] && length,
  ].filter(Boolean)
  const selectedInfo = selected && chordOf(key, mode, selected)

  const note = added && (
    <div className="chord-pad-note" role="status">
      Added {added.name}
      <button
        type="button"
        onClick={() => {
          useStore.getState().removeChord(added.id)
          setAdded(null)
        }}
      >
        Undo
      </button>
    </div>
  )

  if (!open) {
    return (
      <div className="chord-pad is-folded" ref={ref}>
        {note}
        <button type="button" className="chord-pad-unfold" aria-label="Open the chord pad" {...handle}>
          <span className="chord-pad-grip" aria-hidden="true" />
          <span className="chord-pad-unfold-row">
            Chords
            <span className="chord-pad-key">
              {keyLabel(key, mode)} {mode}
            </span>
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className="chord-pad" ref={ref} role="region" aria-label="Chord pad" style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}>
      {note}
      <button type="button" className="chord-pad-handle" aria-label="Fold the chord pad" {...handle}>
        <span className="chord-pad-grip" aria-hidden="true" />
      </button>
      <div className="chord-pad-head">
        <span className="chord-pad-title">
          Chords <span className="chord-pad-key">{keyLabel(key, mode)} {mode}</span>
        </span>
        <button
          type="button"
          className="chord-pad-chip"
          aria-expanded={showOptions}
          onClick={() => setShowOptions(!showOptions)}
          title={selected ? 'The selected chord: 7th, sus or add9, bass note and length' : '7th, sus or add9, bass note and length'}
        >
          {summary.length ? summary.join(' · ') : 'Options'}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d={showOptions ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
          </svg>
        </button>
        <button type="button" className="chord-pad-chip" aria-pressed={quick} onClick={() => setQuickAdd(!quick)} title="Add a chord as soon as its pad is tapped">
          Tap to add
        </button>
      </div>

      {/* The selected chord, to duplicate, delete or let go of; Options edits it. */}
      {selected && selectedInfo && (
        <div className="chord-pad-selected">
          <span className="chord-pad-selected-name">
            {selectedInfo.name}
            <span className="chord-pad-roman">{selectedInfo.roman}</span>
          </span>
          <span className="chord-pad-selected-label">selected</span>
          <button type="button" className="icon-btn" aria-label={`Duplicate ${selectedInfo.name}`} title="Duplicate" onClick={() => useStore.getState().duplicateChord(selected.id)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 9h10v10H9zM5 15V5h10" />
            </svg>
          </button>
          <button type="button" className="icon-btn danger" aria-label={`Delete ${selectedInfo.name}`} title="Delete" onClick={() => useStore.getState().removeChord(selected.id)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
            </svg>
          </button>
          <button type="button" className="icon-btn" aria-label="Deselect" title="Done" onClick={() => useStore.getState().select(null)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}

      {/* Tap a pad to hear it; a dot marks the chords that usually come next. */}
      <div className="chord-pad-grid">
        {pads.map((p) => {
          const info = chordOf(key, mode, { degree: p.degree, seventh: target.seventh, borrowed: p.borrowed, color: target.color ?? undefined })
          const on = !quick && p.degree === pick.degree && p.borrowed === pick.borrowed
          return (
            <button
              type="button"
              key={`${p.borrowed ? 'b' : ''}${p.degree}`}
              className={`chord-pad-pad ${on ? 'is-picked' : ''} ${p.borrowed ? 'is-borrowed' : ''} ${hinted(p) ? 'is-hinted' : ''}`}
              aria-pressed={quick ? undefined : on}
              aria-label={`${info.name}, ${info.roman}${hinted(p) ? ', a usual next chord' : ''}${quick ? '. Add it' : ''}`}
              onClick={() => choose({ degree: p.degree, borrowed: p.borrowed }, quick)}
            >
              <span className="chord-pad-name">{info.name}</span>
              <span className="chord-pad-roman">{info.roman}</span>
            </button>
          )
        })}
      </div>

      {/* The options of the selected chord (or of the one to add), when asked for. */}
      {showOptions && (
        <div className="chord-pad-options">
          <button type="button" className="chip" aria-pressed={target.seventh} onClick={() => setOption({ seventh: !target.seventh })}>
            7th
          </button>
          <div className="chord-pad-seg" role="group" aria-label="Sus or added note">
            {COLORS.map((c) => (
              <button type="button" key={c.label} aria-pressed={target.color === c.id} onClick={() => setOption({ color: c.id })}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="chord-pad-seg" role="group" aria-label="Bass note">
            {BASSES.map((b) => (
              <button type="button" key={b.label} aria-pressed={target.bass === b.id} onClick={() => setOption({ bass: b.id })}>
                {b.label}
              </button>
            ))}
          </div>
          <div className="chord-pad-length" role="group" aria-label="Length">
            <button type="button" aria-label="Shorter" disabled={target.beats <= 1} onClick={() => setOption({ beats: target.beats - 1 })}>
              −
            </button>
            <span>{length}</span>
            <button type="button" aria-label="Longer" onClick={() => setOption({ beats: target.beats + 1 })}>
              +
            </button>
          </div>
        </div>
      )}

      {/* With tap-to-add on, the pads add; otherwise these do. */}
      {!quick && (
        <div className="chord-pad-actions">
          {selected && (
            <button
              type="button"
              className="chord-pad-replace"
              disabled={selected.degree === pick.degree && !!selected.borrowed === pick.borrowed}
              onClick={replace}
              title="Change the selected chord to the picked one"
            >
              Change to {chordOf(key, mode, { ...selected, degree: pick.degree, borrowed: pick.borrowed || undefined }).name}
            </button>
          )}
          <button type="button" className="chord-pad-add" onClick={() => add(pick)}>
            Add {picked.name}
          </button>
        </div>
      )}
    </div>
  )
}
