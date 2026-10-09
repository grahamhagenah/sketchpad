import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useDismiss } from '../hooks/useDismiss'

const SHORTCUTS: [ReactNode, string][] = [
  [<kbd>Space</kbd>, 'Play / pause'],
  [<kbd>↵</kbd>, 'Back to start'],
  [<><kbd>1</kbd>–<kbd>7</kbd></>, 'Add chord'],
  [<><kbd>←</kbd><kbd>→</kbd></>, 'Select'],
  [<><kbd>⌥</kbd><kbd>←</kbd><kbd>→</kbd></>, 'Move chord'],
  [<><kbd>[</kbd><kbd>]</kbd></>, 'Length'],
  [<kbd>S</kbd>, '7th'],
  [<kbd>D</kbd>, 'Duplicate'],
  [<kbd>⌫</kbd>, 'Delete'],
  [<><kbd>⌘</kbd><kbd>S</kbd></>, 'Save'],
  [<><kbd>⌘</kbd><kbd>Z</kbd></>, 'Undo'],
  [<><kbd>⇧</kbd><kbd>⌘</kbd><kbd>Z</kbd></>, 'Redo'],
  [<kbd>M</kbd>, 'Metronome'],
  [<kbd>L</kbd>, 'Loop'],
  [<kbd>A</kbd>, 'Arpeggiator'],
  [<kbd>R</kbd>, 'Record'],
  [<><kbd>−</kbd><kbd>+</kbd></>, 'Zoom'],
  [<kbd>?</kbd>, 'This list'],
]

/** A keyboard button that lists the shortcuts; ? opens it too. */
export function ShortcutsButton() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, close, ref)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || (e.target as HTMLElement).closest('input, select, textarea')) return
      setOpen((o) => !o)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="menu-anchor shortcuts-anchor" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        aria-expanded={open}
        aria-controls="shortcuts-menu"
        onClick={() => setOpen(!open)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="6" width="19" height="12" rx="2" />
          <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
        </svg>
      </button>
      {open && (
        <div className="menu shortcuts-menu" id="shortcuts-menu" role="dialog" aria-label="Keyboard shortcuts">
          <dl>
            {SHORTCUTS.map(([keys, what]) => (
              <div key={what}>
                <dt>{keys}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}
