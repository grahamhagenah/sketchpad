import { SaveButton, ShareButton, SongsButton } from './Library'

/** The song's file: saving it, your songs, and export and backups. The song's name is on its tab, above the editor. */
export function SongTitle() {
  return (
    <div className="song-bar" role="group" aria-label="Song file">
      <SaveButton />
      <SongsButton />
      <ShareButton />
    </div>
  )
}
