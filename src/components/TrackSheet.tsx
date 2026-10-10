import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { colorHex, PALETTE, type ColorId } from '../colors'
import { dbLabel, MAX_DB, MIN_DB } from './Timeline'
import { useSheetDrag } from '../hooks/useSheetDrag'

/**
 * A selected track's settings: its icon in its colour (the palette behind it), its
 * name to edit, and a × to close it, then whatever settings the track has. On a phone
 * it's a sheet along the bottom in place of the chord pad, folding down to a
 * bar by its handle or title row; `docked`, on a wider screen, it sits in the
 * inspector beside the tracks.
 */
export function TrackSheet({
  name,
  onRename,
  color,
  onColor,
  onDone,
  icon,
  title = 'Track settings',
  docked = false,
  dismiss = false,
  children,
}: {
  name: string
  /** What kind of track it is, as its header shows it; a section has none. */
  icon?: ReactNode
  /** Whose settings these are, over them in the sheet (the inspector has its own title). */
  title?: string
  /** An empty name puts the usual one back; without, the name is fixed (the sound and arpeggiator sheets). */
  onRename?: (name: string) => void
  /** Its colour, and changing it from the palette behind its icon; a section has none. */
  color?: ColorId
  onColor?: (color: ColorId) => void
  /** Closing it; without, there's no × (as for the section's settings in the inspector, which nothing replaces). */
  onDone?: () => void
  docked?: boolean
  /** Put away, rather than folded, when dragged down, and on a tap outside it (the sheets a button opens: sound, arpeggiator and the section's). */
  dismiss?: boolean
  children: ReactNode
}) {
  const [picking, setPicking] = useState(false)
  const [folded, setFolded] = useState(false)
  const open = !folded
  const setOpen = (next: boolean) => (!next && dismiss ? onDone?.() : setFolded(!next))
  const { dragY, handle, area } = useSheetDrag(open, setOpen)
  const [text, setText] = useState(name)
  useEffect(() => setText(name), [name])
  const ref = useRef<HTMLDivElement>(null)
  // A tap outside puts it away (keeping a name being typed); the button that opened it closes it itself.
  const close = useCallback(() => {
    if (ref.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
    onDone?.()
  }, [onDone])
  const outside = useCallback(
    (target: Node) => !ref.current?.contains(target) && !(target instanceof Element && target.closest('[data-sheet-toggle]')),
    [],
  )
  useOutsideTap(dismiss && !docked, close, outside)

  // Leave room under the page for the sheet, as the chord pad does.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || docked) return
    const root = document.documentElement
    const observer = new ResizeObserver(() => root.style.setProperty('--chord-pad-h', `${el.offsetHeight}px`))
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--chord-pad-h')
    }
  }, [open, docked])

  const track = color ? { ['--track' as string]: colorHex(color) } : {}
  if (!open && !docked) {
    return (
      <div className="chord-pad track-sheet is-folded" ref={ref} style={track}>
        <button type="button" className="chord-pad-unfold" aria-label={`Open ${name}'s settings`} {...handle}>
          <span className="chord-pad-grip" aria-hidden="true" />
          <span className="chord-pad-unfold-row">
            <span className="track-sheet-dot" aria-hidden="true">
              {icon}
            </span>
            {name}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div
      className={docked ? 'track-sheet is-docked' : 'chord-pad track-sheet'}
      ref={ref}
      role="region"
      aria-label={`${name} settings`}
      style={{ ...track, ...(dragY && { transform: `translateY(${dragY}px)`, transition: 'none' }) }}
    >
      {!docked && (
        <button type="button" className="chord-pad-handle" aria-label={`Fold ${name}'s settings`} {...handle}>
          <span className="chord-pad-grip" aria-hidden="true" />
        </button>
      )}
      {!docked && <h2 className="column-title track-sheet-title">{title}</h2>}
      <div className="track-sheet-head" {...(docked ? {} : area)}>
        {onColor ? (
          <button
            type="button"
            className="track-sheet-dot"
            aria-label="Colour"
            aria-expanded={picking}
            title="Change the track's colour"
            onClick={() => setPicking(!picking)}
          >
            {icon}
          </button>
        ) : (
          icon && (
            <span className="track-sheet-dot" aria-hidden="true">
              {icon}
            </span>
          )
        )}
        {onRename ? (
          <input
            className="track-sheet-name"
            aria-label="Track name"
            // As wide as the name, leaving the rest of the row to drag the sheet by.
            size={Math.max(4, text.length + 1)}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text.trim() !== name && onRename(text.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setText(name)
                e.currentTarget.blur()
              }
            }}
          />
        ) : (
          <span className="track-sheet-name is-fixed">{name}</span>
        )}
        {onDone && <CloseButton onClick={onDone} title={docked ? 'Back to the section' : 'Close'} />}
      </div>
      {picking && onColor && (
        <div className="track-sheet-colors" role="group" aria-label="Colour">
          {PALETTE.map((c) => (
            <button
              key={c.id}
              type="button"
              className="swatch"
              style={{ ['--swatch' as string]: c.hex }}
              aria-label={c.label}
              aria-pressed={c.id === color}
              onClick={() => {
                onColor?.(c.id)
                setPicking(false)
              }}
            />
          ))}
        </div>
      )}
      {children}
    </div>
  )
}

/** Putting a sheet or the inspector's panel away: a small round ×. */
export const CloseButton = ({ onClick, title = 'Close' }: { onClick: () => void; title?: string }) => (
  <button type="button" className="track-sheet-close" onClick={onClick} aria-label="Close" title={title}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  </button>
)

/** A line saying what's on the track, beside its mute and solo. */
export function MuteSoloRow({ about, muted, solo, onMute, onSolo }: { about: ReactNode; muted: boolean; solo: boolean; onMute: () => void; onSolo: () => void }) {
  return (
    <div className="track-sheet-status">
      <p className="track-sheet-about">{about}</p>
      <div className="chord-pad-seg" role="group" aria-label="Mute and solo">
        <button type="button" className="is-mute" aria-pressed={muted} onClick={onMute}>
          Mute
        </button>
        <button type="button" className="is-solo" aria-pressed={solo} onClick={onSolo}>
          Solo
        </button>
      </div>
    </div>
  )
}

/** A slider with its name before it and its value after. */
export function SheetSlider({
  label,
  ...props
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  text: string
  onChange: (value: number) => void
  reset?: number
  /** Called when a drag or key press ends, e.g. to play a preview. */
  onRelease?: () => void
  disabled?: boolean
}) {
  return (
    <label className="track-sheet-slider">
      <span>{label}</span>
      {/* Drawn like the level in the track headers: a thin line with a small knob. */}
      <input
        type="range"
        className="track-volume"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-valuetext={props.text}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
        onDoubleClick={props.reset === undefined ? undefined : () => props.onChange(props.reset!)}
        onPointerUp={props.onRelease}
        onKeyUp={(e) => e.key.startsWith('Arrow') && props.onRelease?.()}
      />
      <output>{props.text}</output>
    </label>
  )
}

/** A track's level, in dB; double-tap puts it back to 0 dB. */
export const LevelSlider = ({ value, onChange }: { value: number; onChange: (db: number) => void }) => (
  <SheetSlider label="Level" min={MIN_DB} max={MAX_DB} step={0.5} value={value} text={dbLabel(value)} onChange={onChange} reset={0} />
)

/** Calls `close` on a press that `outside` says is outside the sheet, and on Escape. */
function useOutsideTap(on: boolean, close: () => void, outside: (target: Node) => boolean) {
  useEffect(() => {
    if (!on) return
    const onPointer = (e: PointerEvent) => outside(e.target as Node) && close()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [on, close, outside])
}
