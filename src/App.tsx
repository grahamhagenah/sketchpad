import { useEffect } from 'react'
import { useStore } from './store'
import { deleteTake, seek, togglePlay, toggleRecord } from './audio/engine'
import { Toolbar } from './components/Toolbar'
import { Timeline } from './components/Timeline'
import { Palette } from './components/Palette'
import { redo, undo } from './history'
import { isDirty, reportStorageError, saveSketch } from './library'

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
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
        e.preventDefault()
        if (e.key === 'y' || e.shiftKey) redo()
        else undo()
        return
      }
      if (e.metaKey || e.ctrlKey) return
      const s = useStore.getState()
      const sel = s.chords.find((c) => c.id === s.selectedId)

      if (e.code === 'Space') {
        e.preventDefault()
        void togglePlay()
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
      } else if (e.key === 'Enter' || e.key === 'Home') {
        if (target.closest('button')) return
        void seek(0)
      } else if (e.key === '-' || e.key === '_') {
        s.zoomBy(-1)
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

export default function App() {
  useShortcuts()

  return (
    <div className="app">
      <main>
        <section className="panel editor" aria-label="Progression">
          <Toolbar />
          <Timeline />
        </section>
        <Palette />
      </main>
    </div>
  )
}
