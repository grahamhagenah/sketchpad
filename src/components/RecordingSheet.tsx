import { useStore, vocalTrackName } from '../store'
import { toggleRecord } from '../audio/engine'
import { Position } from './Position'

/**
 * On a phone, recording takes over the bottom of the screen, big enough to
 * read and hit from where you stand to sing: the count-in in large numbers
 * (with a reminder that headphones keep the chords out of the take), then
 * which track it's going into and where in the section it's got to, and a
 * large button to stop (or, during the count-in, to call it off).
 */
export function RecordingSheet() {
  const recording = useStore((s) => s.recording)
  const countIn = useStore((s) => s.countIn)
  const name = useStore((s) => vocalTrackName(s, s.armedLane))
  const counting = recording === 'count-in'

  return (
    <div className={`record-sheet ${counting ? 'is-counting' : 'is-recording'}`} role="status" aria-live="polite">
      {counting ? (
        <>
          <span className="record-sheet-count" aria-label={countIn ? `${countIn} beats to go` : 'Starting'}>
            {countIn ?? ''}
          </span>
          <p className="record-sheet-title">Get ready to sing into {name}</p>
          <p className="record-sheet-tip">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1z" />
            </svg>
            Headphones keep the chords out of your take
          </p>
        </>
      ) : (
        <>
          <p className="record-sheet-title">
            <span className="record-sheet-dot" aria-hidden="true" />
            Recording into {name}
          </p>
          <div className="lcd" role="group" aria-label="Position">
            <Position />
          </div>
        </>
      )}
      <button type="button" className="record-sheet-stop" onClick={() => void toggleRecord()}>
        {counting ? (
          'Cancel'
        ) : (
          <>
            <span className="record-sheet-square" aria-hidden="true" />
            Stop
          </>
        )}
      </button>
    </div>
  )
}
