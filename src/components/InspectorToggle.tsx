import { create } from 'zustand'
import { Icon } from './Toolbar'

/** Whether the inspector shows is a habit of the device's owner, kept on it rather than with the song. */
const KEY = 'bounce-inspector'
const saved = () => {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
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
