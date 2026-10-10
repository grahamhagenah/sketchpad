import { useRef, useState, type PointerEvent } from 'react'

/** How far a sheet is dragged down before it folds, or up before it opens. */
const FOLD_PX = 60
const OPEN_PX = 30

/**
 * Folding a sheet along the bottom of the screen by dragging it: down to fold,
 * up to open. Spread `handle` on its handle, where a tap toggles it too, and
 * `area` on anything else it can be dragged by (its title row), where a tap
 * does nothing; a press on a button or field inside either is left to it.
 * While open, `dragY` is how far it's pulled down, to move it with the finger.
 */
export function useSheetDrag(open: boolean, setOpen: (open: boolean) => void) {
  const [dragY, setDragY] = useState(0)
  const drag = useRef<{ y: number; moved: boolean; tap: boolean } | null>(null)
  const down = (tap: boolean) => (e: PointerEvent<HTMLElement>) => {
    const control = (e.target as HTMLElement).closest('button, input, select, label')
    if (control && control !== e.currentTarget && e.currentTarget.contains(control)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, moved: false, tap }
  }
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return
    const dy = e.clientY - drag.current.y
    if (Math.abs(dy) > 4) drag.current.moved = true
    // Open, it follows the finger down; folded, it waits for a pull up.
    if (open) setDragY(Math.max(0, dy))
  }
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    drag.current = null
    setDragY(0)
    if (!d) return
    const dy = e.clientY - d.y
    if (!d.moved) {
      if (d.tap) setOpen(!open)
    }
    else if (open && dy > FOLD_PX) setOpen(false)
    else if (!open && dy < -OPEN_PX) setOpen(true)
  }
  const onPointerCancel = () => {
    drag.current = null
    setDragY(0)
  }
  const rest = { onPointerMove, onPointerUp, onPointerCancel }
  return { dragY, handle: { onPointerDown: down(true), ...rest }, area: { onPointerDown: down(false), ...rest } }
}
