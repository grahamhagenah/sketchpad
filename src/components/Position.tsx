import { useEffect, useState } from 'react'
import { totalBeats, useStore } from '../store'
import { engine, seek } from '../audio/engine'

/**
 * Where the playhead is, as bar.beat out of the song's bars; it follows
 * playback, and clicking it goes back to the start.
 */
export function Position() {
  const playing = useStore((s) => s.playing)
  const playhead = useStore((s) => s.playhead)
  const perBar = useStore((s) => s.timeSig[0])
  const total = useStore((s) => totalBeats(s.chords))
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

  // Nothing to count until there are chords, as with the ruler.
  if (!total) return null
  const beat = (playing ? live : null) ?? playhead
  const bars = Math.max(1, Math.ceil(total / perBar))
  return (
    <button type="button" className="position" onClick={() => void seek(0)} title="Back to the start (↵)" aria-label={`Bar ${Math.floor(beat / perBar) + 1}, beat ${Math.floor(beat % perBar) + 1}, of ${bars} bars. Go back to the start`}>
      {Math.floor(beat / perBar) + 1}.{Math.floor(beat % perBar) + 1}
      <span>/ {bars}</span>
    </button>
  )
}
