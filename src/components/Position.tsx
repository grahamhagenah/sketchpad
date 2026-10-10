import { useEffect, useState } from 'react'
import { sectionsNow, totalBeats, useStore } from '../store'
import { engine } from '../audio/engine'
import { songSpans } from '../song'

/**
 * Where the playhead is, as bar.beat out of the song's bars, following
 * playback. Just a readout: the button beside it goes back to the start.
 */
export function Position() {
  const playing = useStore((s) => s.playing)
  const playhead = useStore((s) => s.playhead)
  const perBar = useStore((s) => s.timeSig[0])
  // The length of what's playing (or, stopped, of what's open): the whole song's, or the open section's.
  const total = useStore((s) =>
    (s.playing ? s.playingView : s.view) === 'song' ? songSpans(s).reduce((n, span) => n + span.beats, 0) : totalBeats(s.chords),
  )
  // The most bars anything in the song runs to (the whole song, or any one section), so the readout keeps one width from section to section.
  const most = useStore((s) =>
    Math.max(
      songSpans(s).reduce((n, span) => n + span.beats, 0),
      ...sectionsNow(s).map((sec) => totalBeats(sec.chords)),
    ),
  )
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
  const mostBars = Math.max(bars, Math.ceil(most / perBar))
  const bar = Math.floor(beat / perBar) + 1
  const inBar = Math.floor(beat % perBar) + 1
  return (
    <div className="lcd-cell lcd-position" role="group" aria-label={`Bar ${bar}, beat ${inBar}, of ${bars} bars`}>
      {/*
        The widest reading this song can show, in any section or the whole
        song, sits invisibly under the real one, so the cell has room for
        every bar number and keeps its width while playing and from section
        to section. Digits are all one width.
      */}
      <span className="lcd-value lcd-position-value">
        <span className="lcd-position-widest" aria-hidden="true">
          {'0'.repeat(String(mostBars + 1).length)}.{'0'.repeat(String(perBar).length)}
          <small> / {'0'.repeat(String(mostBars).length)}</small>
        </span>
        <span>
          {bar}.{inBar}
          <small> / {total ? bars : '–'}</small>
        </span>
      </span>
      <span className="lcd-label">Bar</span>
    </div>
  )
}
