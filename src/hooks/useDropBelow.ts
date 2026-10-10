import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'
import { useNarrow } from './useNarrow'

/**
 * On a phone, where menus otherwise open as a sheet along the bottom, places
 * one just under the button it opens from instead, the screen's width, with
 * room to scroll if it's taller than what's left below.
 */
export function useDropBelow(open: boolean, anchor: RefObject<HTMLElement | null>): CSSProperties | undefined {
  const narrow = useNarrow()
  const [style, setStyle] = useState<CSSProperties>()
  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect()
    if (!open || !narrow || !r) return setStyle(undefined)
    setStyle({
      top: r.bottom + 6,
      bottom: 'auto',
      left: 12,
      right: 12,
      maxHeight: `calc(100dvh - ${Math.round(r.bottom) + 18}px)`,
      // Its shadow falls below it, as it hangs from the button.
      boxShadow: '0 12px 40px rgb(0 0 0 / 0.6)',
    })
  }, [open, narrow, anchor])
  return style
}
