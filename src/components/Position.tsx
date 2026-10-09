import { useEffect, useState } from 'react'
import { totalBeats, useStore } from '../store'
import { engine, seek } from '../audio/engine'
import { songSpans } from '../song'

/**
 * Where the playhead is, as bar.beat out of the song's bars; it follows
 * playback, and clicking it goes back to the start.
 */
export function Position() {
  const playing = useStore((s) => s.playing)
  const playhead = useStore((s) => s.playhead)
  const perBar = useStore((s) => s.timeSig[0])
  // The open section's length, or in the song view the whole song's.
  const total = useStore((s) => (s.view === 'song' ? songSpans(s).reduce((n, span) => n + span.beats, 0) : totalBeats(s.chords)))
  const [live, setLive] = useState<number | null>(null)

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const frame = () => {
      setLive(engine.position())
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      setLive(null)
    }
  }, [playing])

  const beat = (playing ? live : null) ?? playhead
  const bars = Math.max(1, Math.ceil(total / perBar))
  const bar = Math.floor(beat / perBar) + 1
  const inBar = Math.floor(beat % perBar) + 1
  return (
    <button
      type="button"
      className="lcd-cell lcd-position"
      onClick={() => void seek(0)}
      title="Back to the start (↵)"
      aria-label={`Bar ${bar}, beat ${inBar}, of ${bars} bars. Go back to the start`}
    >
      <span className="lcd-value">
        {bar}.{inBar}
        <small> / {total ? bars : '–'}</small>
      </span>
      <span className="lcd-label">Bar</span>
    </button>
  )
}
