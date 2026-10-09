import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { keyOf, useStore } from '../store'
import { BORROWED, chordInfo, FUNCTIONS } from '../music/theory'
import { audition } from '../audio/engine'
import { Progressions } from './Palette'

const WIDTH = 300

/** The tab last shown, so the menu opens where it was left. */
let lastTab: 'chords' | 'progressions' = 'chords'

/**
 * The key's chords, grouped by function, in a popover beside the + slot.
 * Each click adds one to the end; it stays open to build a run of chords.
 * It floats over the page (the timeline scrolls and would clip it) and
 * follows the slot as chords are added.
 */
export function AddChordMenu({ anchor, onClose }: { anchor: RefObject<HTMLElement | null>; onClose: () => void }) {
  const { key, mode } = keyOf(useStore())
  const chords = useStore((s) => s.chords)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [tab, setTabState] = useState(lastTab)
  const setTab = (next: typeof tab) => {
    lastTab = next
    setTabState(next)
  }

  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.min(Math.max(12, r.left), window.innerWidth - WIDTH - 12)
    setPos({ left, top: r.bottom + 6 })
  }, [anchor, chords])

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // The page moving would leave it floating in the wrong place.
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const add = (degree: number, borrowed = false) => {
    const s = useStore.getState()
    s.select(s.chords[s.chords.length - 1]?.id ?? null)
    s.addChord(degree, borrowed)
    const now = useStore.getState().chords
    audition(now[now.length - 1])
  }

  if (!pos) return null
  return createPortal(
    <div className="menu add-chord-menu" ref={ref} role="dialog" aria-label="Add a chord" style={{ left: pos.left, top: pos.top, width: WIDTH }}>
      <div className="panel-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'chords'} onClick={() => setTab('chords')}>
          Chords
        </button>
        <button type="button" role="tab" aria-selected={tab === 'progressions'} onClick={() => setTab('progressions')}>
          Progressions
        </button>
      </div>
      {tab === 'chords' ? (
        <>
          {FUNCTIONS.map((fn) => (
            <div key={fn.id} className="add-chord-group" role="group" aria-label={fn.label}>
              <span className="palette-group-label" title={fn.about}>
                {fn.label}
              </span>
              <div className="add-chord-chords">
                {fn.degrees.map((degree) => {
                  const info = chordInfo(key, mode, degree, false)
                  return (
                    <button type="button" key={degree} className="add-chord" onClick={() => add(degree)} title={`Add ${info.name} (${degree + 1})`}>
                      <span className="add-chord-name">{info.name}</span>
                      <span className="add-chord-roman">{info.roman}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div className="add-chord-group" role="group" aria-label="Borrowed">
            <span className="palette-group-label" title={`From the parallel ${mode === 'major' ? 'minor' : 'major'} key`}>
              Borrowed
            </span>
            <div className="add-chord-chords">
              {BORROWED[mode].map((degree) => {
                const info = chordInfo(key, mode, degree, false, { borrowed: true })
                return (
                  <button type="button" key={degree} className="add-chord" onClick={() => add(degree, true)} title={`Add ${info.name}, borrowed`}>
                    <span className="add-chord-name">{info.name}</span>
                    <span className="add-chord-roman">{info.roman}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      ) : (
        // Or start over from a ready-made one.
        <div className="add-chord-group" role="tabpanel" aria-label="Progressions">
          <span className="add-chord-note" id="add-chord-progressions">
            Replaces this section’s chords
          </span>
          <Progressions keyNum={key} mode={mode} labelledBy="add-chord-progressions" onPicked={onClose} />
        </div>
      )}
    </div>,
    document.body,
  )
}
