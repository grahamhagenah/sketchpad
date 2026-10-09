import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { useStore, type Chord } from '../store'
import { chordInfo } from '../music/theory'
import { audition, engine } from '../audio/engine'
import { LoopLane } from './LoopLane'

interface Drag {
  id: string
  /** How far the pointer has moved, in px. */
  dx: number
}

/**
 * Where a dragged chord would land: the other chords close up around it, and
 * it goes in front of the first one whose middle its own middle hasn't passed.
 */
function dragLayout(chords: Chord[], drag: Drag | null, beatPx: number) {
  const from = drag ? chords.findIndex((c) => c.id === drag.id) : -1
  if (!drag || from === -1) return { order: chords, to: -1, originLeft: 0 }
  const dragged = chords[from]
  const originBeat = chords.slice(0, from).reduce((sum, c) => sum + c.beats, 0)
  const middle = originBeat + drag.dx / beatPx + dragged.beats / 2
  const others = chords.filter((c) => c.id !== drag.id)
  let beat = 0
  let to = 0
  for (const c of others) {
    if (beat + c.beats / 2 < middle) to++
    beat += c.beats
  }
  const order = [...others]
  order.splice(to, 0, dragged)
  return { order, to, originLeft: originBeat * beatPx }
}

export function Timeline() {
  const { chords, key, mode, timeSig, selectedId, playing, loopOn } = useStore()
  const { select, updateChord, addChord, reorderChord } = useStore()
  const [num, den] = timeSig
  const beatPx = den === 8 ? 30 : 44
  const barPx = num * beatPx

  const totalBeats = chords.reduce((sum, c) => sum + c.beats, 0)
  const bars = Math.max(1, Math.ceil(totalBeats / num))
  const width = Math.max(bars * barPx, totalBeats * beatPx) + barPx

  const playheadRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const [drag, setDrag] = useState<Drag | null>(null)
  const suppressClick = useRef(false)
  // Chords stay in their stored order on the page while one is dragged (moving
  // DOM nodes mid-drag would drop the pointer); only their positions change.
  const layout = dragLayout(chords, drag, beatPx)
  const lefts = new Map<string, number>()
  {
    let beat = 0
    for (const c of layout.order) {
      lefts.set(c.id, c.id === drag?.id ? layout.originLeft + drag.dx : beat * beatPx)
      beat += c.beats
    }
  }

  // A press is followed on the window rather than the chord, so a fast drag
  // that outruns the chord, or a re-render under the pointer, can't lose it.
  const startPress = (c: Chord, e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    suppressClick.current = false
    const x = e.clientX
    let dx = 0
    let moved = false

    const onMove = (ev: globalThis.PointerEvent) => {
      dx = ev.clientX - x
      if (!moved && Math.abs(dx) < 5) return
      if (!moved) {
        moved = true
        select(c.id)
      }
      setDrag({ id: c.id, dx })
    }
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (!moved) return
      suppressClick.current = true
      if (commit) {
        const { to } = dragLayout(useStore.getState().chords, { id: c.id, dx }, beatPx)
        if (to !== -1) reorderChord(c.id, to)
      }
      setDrag(null)
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  useEffect(() => {
    if (!playing) {
      setActiveId(null)
      return
    }
    let raf = 0
    // Where a smooth scroll is heading, so it isn't restarted every frame.
    let target: number | null = null
    const frame = () => {
      const pos = engine.position()
      if (pos !== null && playheadRef.current) {
        const x = pos * beatPx
        playheadRef.current.style.transform = `translateX(${x}px)`
        // Turn the page when the playhead runs off either edge, as it does at
        // the end of the view or when the loop jumps back.
        const view = scrollRef.current
        if (view) {
          if (target !== null && Math.abs(view.scrollLeft - target) < 2) target = null
          const left = target ?? view.scrollLeft
          if (x < left || x > left + view.clientWidth - 24) {
            target = Math.min(Math.max(0, x - 24), view.scrollWidth - view.clientWidth)
            view.scrollTo({ left: target, behavior: 'smooth' })
          }
        }
        let start = 0
        const chs = useStore.getState().chords
        let id: string | null = null
        for (const c of chs) {
          if (pos >= start && pos < start + c.beats) id = c.id
          start += c.beats
        }
        setActiveId(id)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing, beatPx])

  return (
    <div className="timeline-scroll" ref={scrollRef}>
      <div
        className={`timeline ${chords.length ? '' : 'is-empty'}`}
        style={{
          width,
          ['--beat' as string]: `${beatPx}px`,
          ['--bar' as string]: `${barPx}px`,
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) select(null)
        }}
      >
        {chords.length > 0 && (
          <div className="ruler" aria-hidden="true">
            {Array.from({ length: bars + 1 }, (_, i) => (
              <span key={i} style={{ left: i * barPx }}>
                {i + 1}
              </span>
            ))}
          </div>
        )}

        {loopOn && totalBeats > 0 && <LoopLane beatPx={beatPx} total={totalBeats} perBar={num} />}

        {chords.length === 0 && (
          <p className="timeline-empty" style={{ left: barPx + 16 }}>
            <span>Pick a chord below, or press 1–7, to start a progression.</span>
          </p>
        )}

        {chords.map((c) => {
          const isDragged = c.id === drag?.id
          return (
            <ChordBlock
              key={c.id}
              chord={c}
              left={lefts.get(c.id) ?? 0}
              beatPx={beatPx}
              name={chordInfo(key, mode, c.degree, c.seventh).name}
              roman={chordInfo(key, mode, c.degree, c.seventh).roman}
              selected={c.id === selectedId}
              active={c.id === activeId}
              dragging={isDragged}
              onPress={(e) => startPress(c, e)}
              onSelect={() => {
                if (suppressClick.current) {
                  suppressClick.current = false
                  return
                }
                select(c.id)
                audition(c)
              }}
              onResize={(beats) => updateChord(c.id, { beats })}
            />
          )
        })}

        <button
          type="button"
          className="add-slot"
          style={{ left: totalBeats * beatPx, width: barPx - 6 }}
          onClick={() => {
            select(chords[chords.length - 1]?.id ?? null)
            addChord(0)
          }}
          aria-label="Add a bar"
        >
          +
        </button>

        {playing && <div className="playhead" ref={playheadRef} aria-hidden="true" />}
      </div>
    </div>
  )
}

interface BlockProps {
  chord: Chord
  left: number
  beatPx: number
  name: string
  roman: string
  selected: boolean
  active: boolean
  dragging: boolean
  onPress: (e: PointerEvent<HTMLButtonElement>) => void
  onSelect: () => void
  onResize: (beats: number) => void
}

function ChordBlock({ chord, left, beatPx, name, roman, selected, active, dragging, onPress, onSelect, onResize }: BlockProps) {
  const drag = useRef<{ x: number; beats: number } | null>(null)

  return (
    <div
      className={`chord ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''} ${dragging ? 'is-dragging' : ''}`}
      style={{ left, width: chord.beats * beatPx - 6 }}
    >
      <button type="button" className="chord-body" onClick={onSelect} aria-pressed={selected} title="Click to select · drag to move" onPointerDown={onPress}>
        <span className="chord-name">{name}</span>
        <span className="chord-roman">{roman}</span>
      </button>
      <div
        className="resize"
        role="slider"
        tabIndex={-1}
        aria-label={`Length of ${name}`}
        aria-valuemin={1}
        aria-valuenow={chord.beats}
        title="Drag to change length"
        onPointerDown={(e) => {
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, beats: chord.beats }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const beats = Math.max(1, Math.round(drag.current.beats + (e.clientX - drag.current.x) / beatPx))
          if (beats !== chord.beats) onResize(beats)
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
    </div>
  )
}
