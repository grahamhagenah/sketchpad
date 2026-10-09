import { useStore } from '../store'
import { chordInfo, keyLabel } from '../music/theory'
import { audition } from '../audio/engine'

export function Palette() {
  const { key, mode, addChord } = useStore()

  return (
    <section className="panel palette" aria-labelledby="palette-title">
      <h2 id="palette-title">
        Chords in {keyLabel(key, mode)} {mode}
      </h2>
      <div className="palette-grid">
        {Array.from({ length: 7 }, (_, degree) => {
          const info = chordInfo(key, mode, degree, false)
          return (
            <button
              type="button"
              key={degree}
              className="palette-chord"
              onClick={() => {
                addChord(degree)
                const s = useStore.getState()
                const added = s.chords.find((c) => c.id === s.selectedId)
                if (added) audition(added)
              }}
              title={`Add ${info.name} (${degree + 1})`}
            >
              <span className="palette-name">{info.name}</span>
              <span className="palette-roman">{info.roman}</span>
              <kbd>{degree + 1}</kbd>
            </button>
          )
        })}
      </div>
      <p className="hint">Click to add after the selected chord.</p>
    </section>
  )
}
