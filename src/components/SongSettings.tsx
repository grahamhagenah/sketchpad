import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { songOf, songSummary, useStore } from '../store'
import { deleteSketch, discardSketch, isDirty, reportStorageError, saveCopy } from '../library'
import { useAccount } from '../cloud'
import { useSync } from '../sync'
import { closeSheet } from './SoundPanel'
import { TrackSheet } from './TrackSheet'
import { Icon } from './Toolbar'
import { GEAR, KeyOptions } from './Sections'
import type { Mode } from '../music/theory'


/**
 * The whole song's settings, as the section's are a section's: its name,
 * what's in it and whether it's saved, a copy to try another version in, and
 * deleting it. Its key, tempo and meter are in the bar at the top; export and
 * backups, in the share menu.
 */
export function SongSettings() {
  const title = useStore((s) => s.title)
  const setTitle = useStore((s) => s.setTitle)
  const key = useStore((s) => s.key)
  const mode = useStore((s) => s.mode)
  const setKey = useStore((s) => s.setKey)
  const setMode = useStore((s) => s.setMode)
  const summary = useStore(useShallow((s) => songSummary(songOf(s))))
  const sketchId = useStore((s) => s.sketchId)
  const dirty = useStore(isDirty)
  const recording = useStore((s) => s.recording !== 'off')
  const signedIn = useAccount((s) => !!s.email)
  const sync = useSync()
  const [confirming, setConfirming] = useState(false)

  const facts = [
    `${summary.sections} ${summary.sections === 1 ? 'section' : 'sections'}`,
    summary.vocals ? `${summary.vocals} ${summary.vocals === 1 ? 'vocal track' : 'vocal tracks'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const saved = !sketchId ? 'Not in your songs yet' : dirty ? 'Edited since saved' : signedIn && sync.at && sync.state === 'idle' ? 'Saved and synced' : 'Saved'

  return (
    <div className="song-settings">
      <label className="inspector-field">
        <span>Name</span>
        <input
          className="account-input song-settings-name"
          value={title}
          placeholder="Untitled sketch"
          maxLength={40}
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => setTitle(e.target.value.trim())}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
      {/* The song's key: its chords keep their numerals and move with it. Sections in a key of their own keep theirs. */}
      <label className="inspector-field">
        <span>Key</span>
        <select
          value={`${key}-${mode}`}
          disabled={recording}
          onChange={(e) => {
            const [pc, m] = e.target.value.split('-')
            setKey(Number(pc))
            setMode(m as Mode)
          }}
        >
          <KeyOptions />
        </select>
      </label>
      <p className="song-settings-facts">
        {facts}
        <br />
        <span className={dirty || !sketchId ? 'is-unsaved' : ''}>{saved}</span>
      </p>
      <div className="menu-divider" role="separator" />
      {/* Save as: the copy carries on, with any unsaved changes; this one stays as it was last saved. */}
      <button
        type="button"
        className="menu-item"
        disabled={recording}
        onClick={() => {
          void saveCopy().catch(reportStorageError('save a copy'))
          closeSheet()
        }}
      >
        <span className="menu-item-title">Save a copy</span>
        <span className="menu-item-about">Carry on in a copy to try another version; this one stays as it was last saved</span>
      </button>
      {/* Never saved, it isn't in your songs to delete: it can be thrown away instead, for a fresh start. */}
      {!sketchId && (
        <button
          type="button"
          className={`menu-item ${confirming ? 'is-danger' : ''}`}
          disabled={recording}
          onBlur={() => setConfirming(false)}
          onClick={() => {
            if (!confirming) return setConfirming(true)
            discardSketch()
            closeSheet()
          }}
        >
          <span className="menu-item-title">{confirming ? `Discard ${title || 'this song'}` : 'Discard song'}</span>
          <span className="menu-item-about">
            {confirming ? 'Click again to discard it. It was never saved, so this can’t be undone' : 'It was never saved: clear it and start a new one'}
          </span>
        </button>
      )}
      {sketchId && (
        <button
          type="button"
          className={`menu-item ${confirming ? 'is-danger' : ''}`}
          disabled={recording}
          onBlur={() => setConfirming(false)}
          onClick={() => {
            if (!confirming) return setConfirming(true)
            void deleteSketch(sketchId).catch(reportStorageError('delete the song'))
            closeSheet()
          }}
        >
          <span className="menu-item-title">{confirming ? `Delete ${title || 'this song'}` : 'Delete song'}</span>
          <span className="menu-item-about">
            {confirming ? 'Click again to delete. It stays open here, unsaved, and waits in Recently deleted' : 'From your songs; it waits in Recently deleted, to put back'}
          </span>
        </button>
      )}
    </div>
  )
}

/** On a phone, the song's settings in the sheet along the bottom. */
export function SongSettingsSheet() {
  return (
    <TrackSheet name="Song settings" icon={<Icon d={GEAR} />} onDone={closeSheet} dismiss>
      <SongSettings />
    </TrackSheet>
  )
}
