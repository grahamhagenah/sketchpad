import { useCallback, useEffect, useRef, useState } from 'react'
import { useDismiss } from '../hooks/useDismiss'
import { useStore } from '../store'
import { chordInfo, keyLabel, FUNCTIONS, type Mode } from '../music/theory'
import { PROGRESSIONS, type Progression } from '../music/progressions'

/** Ready-made progressions to start from (chords are added from the timeline's + slot). */
export function Palette() {
  const { key, mode } = useStore()

  return (
    <section className="panel palette" aria-labelledby="palette-title">
      <div className="palette-head">
        <h2 id="palette-title">
          Progressions in {keyLabel(key, mode)} {mode} <span className="muted">· picking one replaces the timeline</span>
        </h2>
        <FunctionsInfo keyNum={key} mode={mode} />
      </div>
      <Progressions keyNum={key} mode={mode} />
    </section>
  )
}

/** Ready-made progressions; picking one replaces the timeline, after a second click if it has chords. */
function Progressions({ keyNum, mode }: { keyNum: number; mode: Mode }) {
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
  }

  return (
    <div className="palette-group" role="group" aria-labelledby="palette-title">
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

/** An info button explaining the three chord functions, with this key's numerals. */
function FunctionsInfo({ keyNum, mode }: { keyNum: number; mode: Mode }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useRef<HTMLDivElement>(null)

  useDismiss(open, close, ref)

  return (
    <div className="info" ref={ref}>
      <button
        type="button"
        className="info-btn"
        aria-label="About chord functions"
        aria-expanded={open}
        aria-controls="functions-info"
        title="About chord functions"
        onClick={() => setOpen(!open)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8v.01" />
        </svg>
      </button>
      {open && (
        <div className="info-pop" id="functions-info" role="note">
          <p className="info-title">Chord functions</p>
          {FUNCTIONS.map((fn) => (
            <div key={fn.id} className="info-row">
              <span className="info-label">
                {fn.label}
                <span className="info-numerals">{fn.degrees.map((d) => chordInfo(keyNum, mode, d, false).roman).join(' ')}</span>
              </span>
              <span className="info-about">{fn.about}</span>
            </div>
          ))}
          <p className="info-foot">A common shape is tonic → predominant → dominant → tonic, e.g. I – IV – V – I.</p>
        </div>
      )}
    </div>
  )
}
