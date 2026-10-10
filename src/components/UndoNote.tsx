import { undo } from '../history'
import { hideUndoNote, useUndoNote } from '../undoNote'

/** "Deleted Am · Undo": a moment after anything's deleted, a way to bring it straight back. */
export function UndoNote() {
  const message = useUndoNote((s) => s.message)
  const own = useUndoNote((s) => s.undo)
  if (!message) return null
  return (
    <div className="undo-note" role="status">
      {message}
      <button
        type="button"
        onClick={() => {
          if (own) own()
          else undo()
          hideUndoNote()
        }}
      >
        Undo
      </button>
    </div>
  )
}
