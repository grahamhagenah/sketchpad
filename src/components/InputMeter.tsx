import { useEffect, useRef } from 'react'
import { engine } from '../audio/engine'

/** The quietest level the meter shows, in dB; anything under it reads as silence. */
const FLOOR_DB = -48
/** Loud enough to be close to distorting. */
const HOT = 0.7
/** As loud as it goes: the take will be distorted. */
const CLIP = 0.98

/**
 * How loud the microphone is while recording: a bar that follows the voice
 * (on a dB scale, so quiet singing still moves it), with a tick for the
 * latest peak. It turns amber when it's loud and red when it clips, with a
 * note to back off; and after a couple of seconds of near silence, a note
 * that the microphone isn't hearing anything.
 */
export function InputMeter({ className = '' }: { className?: string }) {
  const fill = useRef<HTMLSpanElement>(null)
  const peak = useRef<HTMLSpanElement>(null)
  const note = useRef<HTMLSpanElement>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    let shown = 0
    let held = 0
    let heldAt = 0
    let clippedAt = -Infinity
    let quietSince = performance.now()
    const frame = (now: number) => {
      const level = engine.inputLevel() ?? 0
      const db = level > 0 ? 20 * Math.log10(level) : -Infinity
      const pos = Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB))
      // Rises at once, falls back smoothly; the peak tick holds a moment, then falls.
      shown = pos > shown ? pos : shown * 0.9 + pos * 0.1
      if (pos >= held || now - heldAt > 900) {
        held = pos
        heldAt = now
      }
      if (level >= CLIP) clippedAt = now
      if (db > -40) quietSince = now

      const clipping = now - clippedAt < 1500
      const silent = now - quietSince > 2000
      if (fill.current) fill.current.style.transform = `scaleX(${shown})`
      if (peak.current) peak.current.style.left = `${held * 100}%`
      root.current?.classList.toggle('is-hot', !clipping && level >= HOT)
      root.current?.classList.toggle('is-clipping', clipping)
      if (note.current) note.current.textContent = clipping ? 'Too loud: back off a little' : silent ? 'Can’t hear you: check the mic' : ''
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className={`input-meter ${className}`} ref={root} role="img" aria-label="Microphone level">
      <span className="input-meter-label" aria-hidden="true">
        Mic
      </span>
      <span className="input-meter-track" aria-hidden="true">
        <span className="input-meter-fill" ref={fill} />
        <span className="input-meter-peak" ref={peak} />
      </span>
      <span className="input-meter-note" ref={note} aria-live="polite" />
    </div>
  )
}
