import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { chordInfo, type Mode } from '../music/theory'
import { PROGRESSIONS, type Progression } from '../music/progressions'

/** Ready-made progressions; picking one replaces the timeline, after a second click if it has chords. */
export function Progressions({ keyNum, mode, labelledBy, onPicked }: { keyNum: number; mode: Mode; labelledBy: string; onPicked?: () => void }) {
  const load = useStore((s) => s.loadProgression)
  const hasChords = useStore((s) => s.chords.length > 0)
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(null), 3000)
    return () => clearTimeout(t)
  }, [confirming])

  const pick = (p: Progression) => {
    if (hasChords && confirming !== p.name) {
      setConfirming(p.name)
      return
    }
    setConfirming(null)
    load(p.degrees, !!p.seventh)
    onPicked?.()
  }

  return (
    <div className="palette-group" role="group" aria-labelledby={labelledBy}>
      <div className="progressions">
        {PROGRESSIONS[mode].map((p) => {
          const numerals = p.degrees.map((d) => chordInfo(keyNum, mode, d, !!p.seventh).roman).join(' – ')
          const asking = confirming === p.name
          return (
            <button
              type="button"
              key={p.name}
              className={`progression ${asking ? 'is-confirming' : ''}`}
              onClick={() => pick(p)}
              onBlur={() => asking && setConfirming(null)}
              title={`${numerals}${hasChords ? ', replacing the timeline' : ''}`}
            >
              {/* Both labels take up room, so asking doesn't change the button's width. */}
              <span className="progression-name">
                <span aria-hidden={asking}>{p.name}</span>
                <span aria-hidden={!asking}>Replace?</span>
              </span>
              <span className="progression-numerals">{numerals}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
