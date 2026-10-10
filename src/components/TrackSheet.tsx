import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { colorHex, PALETTE, type ColorId } from '../colors'
import { dbLabel, MAX_DB, MIN_DB } from './Timeline'
import { useSheetDrag } from '../hooks/useSheetDrag'

/**
 * A selected track's settings: its icon in its colour (the palette behind it), its
 * name to edit, and Done, then whatever settings the track has. On a phone
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
  children,
}: {
  name: string
  /** What kind of track it is, as its header shows it; a section has none. */
  icon?: ReactNode
  /** Whose settings these are, over them in the sheet (the inspector has its own title). */
  title?: string
  /** An empty name puts the usual one back. */
  onRename: (name: string) => void
  /** Its colour, and changing it from the palette behind its icon; a section has none. */
  color?: ColorId
  onColor?: (color: ColorId) => void
  /** Closing it; without, there's no Done (as for the section's settings in the inspector, which nothing replaces). */
  onDone?: () => void
  docked?: boolean
  children: ReactNode
}) {
  const [picking, setPicking] = useState(false)
  const [open, setOpen] = useState(true)
  const { dragY, handle, area } = useSheetDrag(open, setOpen)
  const [text, setText] = useState(name)
  useEffect(() => setText(name), [name])
  const ref = useRef<HTMLDivElement>(null)

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
        {onDone && (
          <button type="button" className="chord-pad-chip" onClick={onDone} title={docked ? 'Back to the section' : 'Back to the chord pad'}>
            Done
          </button>
        )}
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
export function SheetSlider({ label, ...props }: { label: string; value: number; min: number; max: number; step: number; text: string; onChange: (value: number) => void; reset?: number }) {
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
        onChange={(e) => props.onChange(Number(e.target.value))}
        onDoubleClick={props.reset === undefined ? undefined : () => props.onChange(props.reset!)}
      />
      <output>{props.text}</output>
    </label>
  )
}

/** A track's level, in dB; double-tap puts it back to 0 dB. */
export const LevelSlider = ({ value, onChange }: { value: number; onChange: (db: number) => void }) => (
  <SheetSlider label="Level" min={MIN_DB} max={MAX_DB} step={0.5} value={value} text={dbLabel(value)} onChange={onChange} reset={0} />
)
