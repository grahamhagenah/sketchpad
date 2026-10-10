import { useEffect } from 'react'
import { useStore } from './store'
import { deleteTake, seek, togglePlay, toggleRecord } from './audio/engine'
import { Toolbar } from './components/Toolbar'
import { Timeline } from './components/Timeline'
import { SectionBar, SongView } from './components/Sections'
import { StatusBar } from './components/StatusBar'
import { redo, undo } from './history'
import { isDirty, reportStorageError, saveSketch } from './library'
import { colorHex, DEFAULT_CHORDS_COLOR, DEFAULT_DRUMS_COLOR } from './colors'
import { ChordPad } from './components/ChordPad'
import { VocalPad } from './components/VocalPad'
import { DrumPad } from './components/DrumPad'
import { ChordsTrackPad, Inspector } from './components/Inspector'
import { toggleInspector, useInspector } from './components/InspectorToggle'
import { RecordingSheet } from './components/RecordingSheet'
import { useNarrow } from './hooks/useNarrow'

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        // Even from inside a text field, as in any editor.
        e.preventDefault()
        if (isDirty()) void saveSketch().catch(reportStorageError('save the sketch'))
        return
      }
      if (target.closest('input, select, textarea')) return
      // Copy, cut and paste chords: the selected one, or with the chords track selected, all of them.
      if ((e.metaKey || e.ctrlKey) && ['c', 'x', 'v'].includes(e.key.toLowerCase()) && !e.shiftKey && !e.altKey) {
        const s = useStore.getState()
        if (s.view !== 'section' || s.recording !== 'off') return
        const sel = s.chords.find((c) => c.id === s.selectedId)
        const picked = sel ? [sel] : s.chordsTrackSelected ? s.chords : []
        const k = e.key.toLowerCase()
        if (k === 'v') {
          if (!s.clipboard.length) return
          e.preventDefault()
          s.pasteChords()
          return
        }
        if (!picked.length || window.getSelection()?.toString()) return
        e.preventDefault()
        s.copyChords(picked)
        if (k === 'x') {
          if (sel) s.removeChord(sel.id)
          else s.clearChords()
        }
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
        e.preventDefault()
        if (e.key === 'y' || e.shiftKey) redo()
        else undo()
        return
      }
      if (e.metaKey || e.ctrlKey) return
      const s = useStore.getState()
      const sel = s.chords.find((c) => c.id === s.selectedId)
      // In the song view the keys that edit a section's chords and tracks do nothing; its blocks take their own.
      const editing = s.view === 'section'

      if (e.code === 'Space') {
        e.preventDefault()
        void togglePlay()
      } else if (!editing && !['m', 'l', 'a', 'Enter', 'Home', '-', '_', '=', '+'].includes(e.key)) {
        return
      } else if (/^[1-7]$/.test(e.key)) {
        s.addChord(Number(e.key) - 1)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const dir = e.key === 'ArrowLeft' ? -1 : 1
        if (e.altKey && sel) s.moveChord(sel.id, dir)
        else s.selectRelative(dir)
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && s.selectedVocal !== null && s.recording === 'off') {
        e.preventDefault()
        // The focused row now belongs to the track that moved up; don't leave a focus ring on it.
        if (target.closest('.vocal-row, .track-header')) target.blur()
        void deleteTake(s.selectedVocal)
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && s.drumsTrackSelected && s.drumTrack) {
        e.preventDefault()
        if (target.closest('.track-header')) target.blur()
        s.removeDrumTrack()
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && s.chordsTrackSelected) {
        e.preventDefault()
        if (target.closest('.track-header')) target.blur()
        s.clearChords()
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && sel) {
        e.preventDefault()
        s.removeChord(sel.id)
      } else if (e.key === '[' && sel) {
        s.updateChord(sel.id, { beats: Math.max(1, sel.beats - 1) })
      } else if (e.key === ']' && sel) {
        s.updateChord(sel.id, { beats: sel.beats + 1 })
      } else if (e.key === 's' && sel) {
        s.updateChord(sel.id, { seventh: !sel.seventh })
      } else if (e.key === 'd' && sel) {
        s.duplicateChord(sel.id)
      } else if (e.key === 'm') {
        s.toggleMetronome()
      } else if (e.key === 'l') {
        s.toggleLoop()
      } else if (e.key === 'r') {
        void toggleRecord()
      } else if (e.key === 'a') {
        s.setArp({ on: !s.arp.on })
      } else if (e.key === 'i') {
        toggleInspector()
      } else if (e.key === 'Enter' || e.key === 'Home') {
        if (target.closest('button')) return
        void seek(0)
      } else if (e.key === '-' || e.key === '_') {
        // The song fills the width, and goes no narrower.
        if (s.view !== 'song' || s.zoom > 1) s.zoomBy(-1)
      } else if (e.key === '=' || e.key === '+') {
        s.zoomBy(1)
      } else if (e.key === 'Escape') {
        s.select(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * A button clicked with the mouse lets go of focus, as buttons do in a desktop
 * app, so the shortcuts that follow (space to play) don't light up a ring on it
 * or press it again. Not in menus or the section's settings, whose buttons ask
 * to be clicked twice to confirm, and keep their focus for that. Keyboard focus is left as it is.
 */
function useClickBlur() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // A click from the keyboard (Enter or Space on a focused button) has no detail.
      if (!e.detail) return
      const button = (e.target as HTMLElement).closest('button')
      if (button && button === document.activeElement && !button.closest('.menu, .section-panel')) button.blur()
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
}

export default function App() {
  useShortcuts()
  useClickBlur()
  const view = useStore((s) => s.view)
  // The chords' and drums' colours, as chosen, for everything drawn in them.
  const chordsColor = useStore((s) => s.chordsColor) ?? DEFAULT_CHORDS_COLOR
  const drumsColor = useStore((s) => s.drumsColor) ?? DEFAULT_DRUMS_COLOR
  // On a phone, a section gets a chord pad along the bottom, to build its chords by touch.
  const narrow = useNarrow()
  const recording = useStore((s) => s.recording !== 'off')
  const chordPad = narrow && view === 'section' && !recording
  // With a vocal or the drum track selected, the sheet shows its settings instead.
  const selectedVocal = useStore((s) => s.selectedVocal)
  const drumsSelected = useStore((s) => s.drumsTrackSelected && s.drumTrack)
  const chordsSelected = useStore((s) => s.chordsTrackSelected && s.chords.length > 0)
  // On a wider screen, what's selected has its settings in a column beside the tracks; an empty section has only its ways to start.
  const hasChords = useStore((s) => s.chords.length > 0)
  const inspectorShown = useInspector((s) => s.shown)
  const inspector = !narrow && view === 'section' && hasChords && inspectorShown

  return (
    <div className={`app ${chordPad ? 'has-chord-pad' : ''} ${narrow && recording ? 'has-record-sheet' : ''}`} style={{ ['--track-chords' as string]: colorHex(chordsColor), ['--track-drums' as string]: colorHex(drumsColor) }}>
      <main>
        <section className="panel editor" aria-label={view === 'song' ? 'Song' : 'Section'}>
          <Toolbar />
          <SectionBar />
          {view === 'song' ? (
            <SongView />
          ) : (
            <div className="editor-body">
              {inspector && <Inspector />}
              <Timeline />
            </div>
          )}
        </section>
      </main>
      <StatusBar />
      {chordPad && (selectedVocal !== null ? <VocalPad lane={selectedVocal} /> : drumsSelected ? <DrumPad /> : chordsSelected ? <ChordsTrackPad /> : <ChordPad />)}
      {/* On a phone, recording takes over the bottom of the screen. */}
      {narrow && recording && <RecordingSheet />}
    </div>
  )
}
