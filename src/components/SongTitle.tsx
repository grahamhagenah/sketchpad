import { AccountButton } from './Account'
import { SketchesButton } from './Library'

/** The sketch menu (save, new, open) and the account, leading the toolbar; the song's name is on its tab, above the editor. */
export function SongTitle() {
  return (
    <div className="song-bar" role="group" aria-label="Sketch">
      <SketchesButton />
      <AccountButton />
    </div>
  )
}
