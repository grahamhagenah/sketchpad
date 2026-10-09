import { useStore } from '../store'
import { SketchesButton } from './Library'

/** The sketch's name, typed straight in (it also names exported files), with the sketch menu (save, new, open) beside it. */
export function SongTitle() {
  const title = useStore((s) => s.title)
  const setTitle = useStore((s) => s.setTitle)
  return (
    <div className="song-bar" role="group" aria-label="Sketch">
      <input
        className="song-title"
        value={title}
        placeholder="Untitled sketch"
        aria-label="Sketch title"
        title={title || 'Name this sketch'}
        maxLength={40}
        spellCheck={false}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={(e) => setTitle(e.target.value.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
        }}
      />
      <SketchesButton />
    </div>
  )
}
