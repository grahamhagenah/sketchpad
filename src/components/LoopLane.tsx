import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useStore, loopRange, type LoopRegion } from '../store'
import { useHoverHint } from './StatusBar'

type DragKind = 'new' | 'move' | 'start' | 'end'

interface Props {
  beatPx: number
  total: number
  /** Beats in a bar, for the readout. */
  perBar: number
}

function beatLabel(beat: number, perBar: number) {
  const bar = Math.floor(beat / perBar) + 1
  const rest = beat % perBar
  return rest ? `${bar}.${rest + 1}` : `${bar}`
}

/**
 * The strip above the ruler that sets which part of the progression loops.
 * Drag its ends to resize it, its middle to move it, or the empty lane to draw
 * a new one. Double-click loops the whole progression again. Pointed at, it
 * thickens and shows a tab at each end, and the status bar says what dragging
 * does; on a touch screen the tabs are always there.
 */
export function LoopLane({ beatPx, total, perBar }: Props) {
  const loop = useStore((s) => s.loop)
  const setLoop = useStore((s) => s.setLoop)
  const region = loopRange(loop, total)
  const isWhole = region.start === 0 && region.end === total

  const laneRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: DragKind; anchor: number; region: LoopRegion } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [hovering, setHovering] = useState(false)

  // While pointed at or dragged, the status bar says what the strip does.
  useEffect(() => {
    if (!hovering && !dragging) return
    useHoverHint.setState({
      hint: isWhole
        ? 'Drag an end of the loop to loop part of the section, or drag across the strip to draw a loop.'
        : 'Drag the loop to move it · drag an end to change its length · drag across the strip to draw a new one · double-click to loop everything.',
    })
    return () => useHoverHint.setState({ hint: null })
  }, [hovering, dragging, isWhole])

  const clamp = (b: number) => Math.max(0, Math.min(total, b))
  const rawBeatAt = (clientX: number) => (clientX - laneRef.current!.getBoundingClientRect().left) / beatPx
  const beatAt = (clientX: number) => clamp(Math.round(rawBeatAt(clientX)))
  const commit = (start: number, end: number) => {
    if (end - start < 1) return
    if (start === 0 && end === total) setLoop(null)
    else if (start !== region.start || end !== region.end) setLoop({ start, end })
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const picked = ((e.target as HTMLElement).dataset.kind as DragKind | undefined) ?? 'new'
    // Looping everything, there's nowhere to move the loop to: dragging across it draws a new one.
    const kind = picked === 'move' && isWhole ? 'new' : picked
    laneRef.current!.setPointerCapture(e.pointerId)
    drag.current = { kind, anchor: kind === 'move' ? rawBeatAt(e.clientX) : beatAt(e.clientX), region }
    setDragging(true)
    e.preventDefault()
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const b = beatAt(e.clientX)
    if (d.kind === 'new') {
      commit(Math.min(d.anchor, b), Math.max(d.anchor, b))
    } else if (d.kind === 'move') {
      const len = d.region.end - d.region.start
      const shift = Math.round(rawBeatAt(e.clientX) - d.anchor)
      const start = Math.max(0, Math.min(total - len, d.region.start + shift))
      commit(start, start + len)
    } else if (d.kind === 'start') {
      commit(Math.min(b, d.region.end - 1), d.region.end)
    } else {
      commit(d.region.start, Math.max(b, d.region.start + 1))
    }
  }

  const endDrag = () => {
    drag.current = null
    setDragging(false)
  }

  const onHandleKey = (edge: 'start' | 'end') => (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const step = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? perBar : 1)
    if (edge === 'start') commit(clamp(Math.min(region.start + step, region.end - 1)), region.end)
    else commit(region.start, clamp(Math.max(region.end + step, region.start + 1)))
  }

  return (
    <>
      <div
        ref={laneRef}
        className={`loop-lane ${dragging ? 'is-dragging' : ''}`}
        style={{ width: total * beatPx }}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHovering(true)}
        onPointerLeave={() => setHovering(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setLoop(null)}
        title="Drag to set the loop · double-click to loop everything"
      >
        <div
          className={`loop-region ${region.start === 0 ? 'from-start' : ''}`}
          data-kind="move"
          style={{ left: region.start * beatPx, width: (region.end - region.start) * beatPx }}
        >
          <div
            className="loop-handle is-start"
            data-kind="start"
            role="slider"
            tabIndex={0}
            aria-label="Loop start"
            aria-valuemin={0}
            aria-valuemax={region.end - 1}
            aria-valuenow={region.start}
            aria-valuetext={`Bar ${beatLabel(region.start, perBar)}`}
            onKeyDown={onHandleKey('start')}
          />
          <div
            className="loop-handle is-end"
            data-kind="end"
            role="slider"
            tabIndex={0}
            aria-label="Loop end"
            aria-valuemin={region.start + 1}
            aria-valuemax={total}
            aria-valuenow={region.end}
            aria-valuetext={`Bar ${beatLabel(region.end, perBar)}`}
            onKeyDown={onHandleKey('end')}
          />
        </div>
      </div>

      {!isWhole && (
        <>
          <div className="loop-dim" style={{ left: 0, width: region.start * beatPx }} aria-hidden="true" />
          <div
            className="loop-dim"
            style={{ left: region.end * beatPx, width: (total - region.end) * beatPx }}
            aria-hidden="true"
          />
        </>
      )}
    </>
  )
}
