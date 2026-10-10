import { keyOf, totalBeats, useStore } from '../store'
import { chordInfo } from '../music/theory'
import { audition } from '../audio/engine'
import { Progressions } from './Palette'

/**
 * All an empty section shows: a first chord from the key's seven, a
 * ready-made progression, or the chords of another section to start from.
 * Once it has a chord, the timeline takes over.
 */
export function SectionStarter() {
  const { key, mode } = keyOf(useStore())
  const perBar = useStore((s) => s.timeSig[0])
  const active = useStore((s) => s.activeSection)
  const sections = useStore((s) => s.sections)
  const others = sections.filter((sec) => sec.id !== active && sec.chords.length)
  const { addChord, copyChordsFrom } = useStore()

  const add = (degree: number) => {
    addChord(degree)
    const now = useStore.getState().chords
    audition(now[now.length - 1])
  }

  return (
    <div className="starter">
      <div className="starter-group is-chords" role="group" aria-labelledby="starter-chords">
        <span className="palette-group-label" id="starter-chords" title="Or press 1–7">
          Start with a chord
        </span>
        <div className="starter-chords">
          {Array.from({ length: 7 }, (_, degree) => {
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
      <div className="starter-group" role="group">
        <span className="palette-group-label" id="starter-progressions">
          Or a progression
        </span>
        <Progressions keyNum={key} mode={mode} labelledBy="starter-progressions" />
      </div>
      {others.length > 0 && (
        <div className="starter-group" role="group" aria-labelledby="starter-copy">
          <span className="palette-group-label" id="starter-copy">
            Or the chords from
          </span>
          <div className="starter-copies">
            {others.map((sec) => {
              const bars = Math.ceil(totalBeats(sec.chords) / perBar)
              return (
                <button type="button" key={sec.id} className="chip starter-copy" onClick={() => copyChordsFrom(sec.id)} title={`Start with a copy of ${sec.name}’s chords`}>
                  {sec.name}
                  <span className="starter-copy-bars">
                    {bars} {bars === 1 ? 'bar' : 'bars'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
