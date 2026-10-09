import { useEffect } from 'react'
import { useStore } from './store'
import { togglePlay } from './audio/engine'
import { Toolbar } from './components/Toolbar'
import { Timeline } from './components/Timeline'
import { Palette } from './components/Palette'

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, select, textarea') || e.metaKey || e.ctrlKey) return
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
      } else if (e.key === 'a') {
        s.setArp({ on: !s.arp.on })
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
      <footer className="shortcuts">
        <span><kbd>Space</kbd> play</span>
        <span><kbd>1</kbd>–<kbd>7</kbd> add chord</span>
        <span><kbd>←</kbd><kbd>→</kbd> select</span>
        <span><kbd>⌥</kbd>+<kbd>←</kbd><kbd>→</kbd> move</span>
        <span><kbd>[</kbd><kbd>]</kbd> length</span>
        <span><kbd>S</kbd> 7th</span>
        <span><kbd>D</kbd> duplicate</span>
        <span><kbd>⌫</kbd> delete</span>
        <span><kbd>M</kbd> click</span>
        <span><kbd>L</kbd> loop</span>
        <span><kbd>A</kbd> arp</span>
      </footer>
    </div>
  )
}
