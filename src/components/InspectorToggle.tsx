import { create } from 'zustand'
import { Icon } from './Toolbar'

/**
 * Whether the inspector shows is a habit of the device's owner, kept on it
 * rather than with the song. Until it's chosen, it shows where there's room:
 * not on a tablet's narrower screen, where it would leave the timeline a sliver.
 */
const KEY = 'bounce-inspector'
const ROOMY = 1000
const saved = () => {
  try {
    const kept = localStorage.getItem(KEY)
    if (kept !== null) return kept !== '0'
  } catch {
    // Not kept: decided by the screen.
  }
  return typeof window === 'undefined' || window.innerWidth >= ROOMY
}

/** Whether the inspector beside the tracks is showing, on a wider screen. */
export const useInspector = create(() => ({ shown: saved() }))

export function toggleInspector() {
  const shown = !useInspector.getState().shown
  useInspector.setState({ shown })
  try {
    localStorage.setItem(KEY, shown ? '1' : '0')
  } catch {
    // Kept for this visit only.
  }
}

/** A button to show or hide the inspector; I does it too. */
export function InspectorButton() {
  const shown = useInspector((s) => s.shown)
  return (
    <button
      type="button"
      className={`icon-btn inspector-btn ${shown ? 'is-on' : ''}`}
      aria-pressed={shown}
      aria-label={shown ? 'Hide the settings panel' : 'Show the settings panel'}
      title={`${shown ? 'Hide' : 'Show'} the settings panel (I)`}
      onClick={toggleInspector}
    >
      <Icon d="M4 5h16v14H4zM10 5v14" />
    </button>
  )
}
