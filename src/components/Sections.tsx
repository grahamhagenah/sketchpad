import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { SECTION_KINDS, sectionsNow, totalBeats, useStore, type Section } from '../store'
import { chordOf, keyLabel, type Mode } from '../music/theory'
import { engine, seek } from '../audio/engine'
import { songBeatOf, songSpans } from '../song'
import { grooveHits } from '../audio/drums'
import { Icon, ZoomButtons } from './Toolbar'
import { useNarrow } from '../hooks/useNarrow'


/** A gear, for a section's settings. */
export const GEAR =
  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'

/** The menu of section kinds to start a new section from. */
function NewSectionItems({ onPick }: { onPick: (name: string) => void }) {
  return (
    <>
      {SECTION_KINDS.map((kind) => (
        <button key={kind} type="button" className="menu-item menu-item-row" onClick={() => onPick(kind)}>
          <span className="menu-item-title">{kind}</span>
        </button>
      ))}
    </>
  )
}

/**
 * A button with a small menu under it, closed by a click outside, Escape, or
 * scrolling. The menu floats over the page, since the tabs and the song both
 * scroll sideways and would clip it; on a phone it's a sheet along the bottom.
 */
export function MenuButton({
  label,
  title,
  className,
  style,
  children,
  menu,
  onOpen,
  align = 'left',
}: {
  label: string
  title?: string
  className: string
  style?: CSSProperties
  children: ReactNode
  menu: (close: () => void) => ReactNode
  /** Called as the menu opens. */
  onOpen?: () => void
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties | null>(null)

  useLayoutEffect(() => {
    if (!open) return setPos(null)
    const r = buttonRef.current?.getBoundingClientRect()
    const width = menuRef.current?.offsetWidth ?? 280
    if (!r || window.matchMedia('(max-width: 640px)').matches) return setPos({})
    const left = align === 'left' ? r.left : r.right - width
    setPos({ position: 'fixed', top: r.bottom + 6, left: Math.min(Math.max(12, left), window.innerWidth - width - 12), right: 'auto' })
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const inside = (target: EventTarget | null) => menuRef.current?.contains(target as Node) || buttonRef.current?.contains(target as Node)
    const onPointer = (e: globalThis.PointerEvent) => !inside(e.target) && close()
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
      buttonRef.current?.focus()
    }
    const onScroll = (e: Event) => !menuRef.current?.contains(e.target as Node) && close()
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className={className}
        style={style}
        aria-label={label}
        title={title ?? label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          if (!open) onOpen?.()
          setOpen(!open)
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} className="menu section-menu" role="menu" aria-label={label} style={{ ...pos, visibility: pos ? undefined : 'hidden' }}>
            {menu(close)}
          </div>,
          document.body,
        )}
    </>
  )
}

/**
 * The song's sections as tabs above the editor, with the whole song first:
 * pick one to edit its chords and vocals, or + to add a section.
 */
export function SectionBar() {
  const view = useStore((s) => s.view)
  const sections = useStore((s) => s.sections)
  const activeSection = useStore((s) => s.activeSection)
  const arrangement = useStore((s) => s.arrangement)
  const recording = useStore((s) => s.recording !== 'off')
  const { openSection, setView, addSection, addToSong } = useStore()
  const inSong = new Set(arrangement.map((entry) => entry.section))
  // In the order they first play in the song; those not in it yet come last, as they were made.
  const firstPlays = new Map<string, number>()
  arrangement.forEach((entry, i) => firstPlays.has(entry.section) || firstPlays.set(entry.section, i))
  const ordered = [...sections].sort((x, y) => (firstPlays.get(x.id) ?? Infinity) - (firstPlays.get(y.id) ?? Infinity))
  const [renaming, setRenaming] = useState<string | null>(null)
  const open = view === 'section' ? sections.find((sec) => sec.id === activeSection) : undefined
  // On a wider screen the section's settings are in the column beside the tracks instead, once there are tracks.
  const narrow = useNarrow()
  const empty = useStore((s) => s.chords.length === 0)

  return (
    <nav className="section-bar" aria-label="Song sections">
      <div className="section-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className="section-tab is-song"
          aria-selected={view === 'song'}
          disabled={recording}
          onClick={() => setView('song')}
          title="The whole song, section by section"
        >
          {/* The song as the Song view shows it: its sections in rows, each as long as it is. */}
          <Icon d="M4 6h10M4 12h16M4 18h7" />
          Song
        </button>
        {ordered.map((sec) => {
          const isOpen = view === 'section' && sec.id === activeSection
          return (
            <div key={sec.id} className={`section-tab-wrap ${isOpen ? 'is-open' : ''}`}>
              {renaming === sec.id ? (
                <RenameField section={sec} onDone={() => setRenaming(null)} />
              ) : (
                <button
                  type="button"
                  role="tab"
                  className={`section-tab ${inSong.has(sec.id) ? '' : 'is-unused'}`}
                  aria-selected={isOpen}
                  disabled={recording && !isOpen}
                  onClick={() => openSection(sec.id)}
                  onDoubleClick={() => setRenaming(sec.id)}
                  title={inSong.has(sec.id) ? `Edit ${sec.name} (double-click to rename)` : `${sec.name} isn’t in the song yet, so it doesn’t play when the song does`}
                >
                  {sec.name}
                </button>
              )}
              {/* A section that isn't in the song says so, and adding it is a click away. */}
              {!inSong.has(sec.id) && renaming !== sec.id && (
                <button
                  type="button"
                  className="section-unused"
                  disabled={recording}
                  onClick={() => addToSong(sec.id)}
                  title={`Not in the song yet: click to add ${sec.name} to the end`}
                  aria-label={`${sec.name} isn’t in the song. Add it to the end`}
                >
                  <Icon d="M12 7v10M7 12h10" />
                </button>
              )}
            </div>
          )
        })}
        <MenuButton label="Add a section" title="Add a section to the end of the song" className="section-add" menu={(close) => (
          <NewSectionItems
            onPick={(name) => {
              addSection(name)
              close()
            }}
          />
        )}>
          <Icon d="M12 5v14M5 12h14" />
          Section
        </MenuButton>
      </div>
      <div className="section-bar-end">
        {/* The open section's settings: its key, copies, renaming and deleting. */}
        {open && (narrow || empty) && <SectionMenu section={open} onRename={() => setRenaming(open.id)} />}
        {/* Zoom works on whichever view is showing, so it sits with the views. */}
        <ZoomButtons />
      </div>
    </nav>
  )
}

function RenameField({ section, onDone }: { section: Section; onDone: () => void }) {
  const renameSection = useStore((s) => s.renameSection)
  const [name, setName] = useState(section.name)
  const done = useRef(false)
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    if (save) renameSection(section.id, name)
    onDone()
  }
  return (
    <input
      className="section-rename"
      aria-label={`Rename ${section.name}`}
      value={name}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true)
        if (e.key === 'Escape') {
          e.stopPropagation()
          finish(false)
        }
      }}
      size={Math.max(4, name.length)}
    />
  )
}

/**
 * The open section's settings and actions: its key, adding it to the song,
 * copies, renaming and deleting. In the menu from the gear on a phone, and
 * in the column beside the tracks on a wider screen.
 */
function SectionItems({ section, close, onRename }: { section: Pick<Section, 'id' | 'name'>; close: () => void; onRename?: () => void }) {
  const { duplicateSection, deleteSection, openSection, addToSong, setSectionKey, liftSection } = useStore()
  const songKey = useStore((s) => s.key)
  const songMode = useStore((s) => s.mode)
  // The open section's own key lives with its chords, in the editor.
  const sectionKey = useStore((s) => s.sectionKey)
  const count = useStore((s) => s.sections.length)
  const places = useStore((s) => s.arrangement.filter((entry) => entry.section === section.id).length)
  const recording = useStore((s) => s.recording !== 'off')
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      {onRename && (
        <button type="button" className="menu-item" onClick={() => { onRename(); close() }}>
          <span className="menu-item-title">Rename</span>
        </button>
      )}
      <button
        type="button"
        className="menu-item"
        onClick={() => {
          addToSong(section.id)
          close()
        }}
      >
        <span className="menu-item-title">Add to the end of the song</span>
        <span className="menu-item-about">{places ? `It plays ${places === 1 ? 'once' : `${places} times`} so far` : 'It isn’t in the song yet'}</span>
      </button>
      <button
        type="button"
        className="menu-item"
        disabled={recording}
        onClick={() => {
          const copy = duplicateSection(section.id)
          if (copy) openSection(copy)
          close()
        }}
      >
        <span className="menu-item-title">Duplicate</span>
        <span className="menu-item-about">A copy of the chords to change on their own, with no vocals yet</span>
      </button>
      <div className="menu-divider" role="separator" />
      {/* A key change: the section's chords keep their numerals and play in its own key. */}
      <label className="menu-item menu-item-row menu-key">
        <span className="menu-item-title">Key</span>
        <select
          value={sectionKey ? `${sectionKey.key}-${sectionKey.mode}` : 'song'}
          disabled={recording}
          onChange={(e) => {
            if (e.target.value === 'song') return setSectionKey(section.id, null)
            const [pc, m] = e.target.value.split('-')
            setSectionKey(section.id, { key: Number(pc), mode: m as Mode })
          }}
        >
          <option value="song">
            Song’s ({keyLabel(songKey, songMode)} {songMode === 'major' ? 'maj' : 'min'})
          </option>
          {(['major', 'minor'] as const).map((m) => (
            <optgroup key={m} label={m === 'major' ? 'Major' : 'Minor'}>
              {Array.from({ length: 12 }, (_, pc) => (
                <option key={pc} value={`${pc}-${m}`}>
                  {keyLabel(pc, m)} {m === 'major' ? 'maj' : 'min'}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {[1, 2].map((step) => (
        <button
          key={step}
          type="button"
          className="menu-item"
          disabled={recording}
          onClick={() => {
            const copy = liftSection(section.id, step)
            if (copy) openSection(copy)
            close()
          }}
        >
          <span className="menu-item-title">Copy, up a {step === 1 ? 'half' : 'whole'} step</span>
          <span className="menu-item-about">
            The same chords in {keyLabel(((sectionKey?.key ?? songKey) + step) % 12, sectionKey?.mode ?? songMode)} {sectionKey?.mode ?? songMode}, for a lift
          </span>
        </button>
      ))}
      <div className="menu-divider" role="separator" />
      <button
        type="button"
        className={`menu-item ${confirming ? 'is-danger' : ''}`}
        disabled={count < 2 || recording}
        onBlur={() => setConfirming(false)}
        onClick={() => {
          if (!confirming) return setConfirming(true)
          deleteSection(section.id)
          close()
        }}
      >
        <span className="menu-item-title">{confirming ? `Delete ${section.name} and its vocals` : 'Delete section'}</span>
        <span className="menu-item-about">
          {count < 2 ? 'A song keeps at least one section' : confirming ? 'Click again to delete; undo brings the chords back, not the vocals' : 'Also takes it out of the song'}
        </span>
      </button>
    </>
  )
}

/** The open section's settings, from a gear at the end of the tab strip (on a phone, where the column beside the tracks isn't). */
function SectionMenu({ section, onRename }: { section: Section; onRename: () => void }) {
  return (
    <MenuButton label={`${section.name} settings`} title={`${section.name} settings: key, copies, rename, delete`} className="section-settings" align="right" menu={(close) => (
      <SectionItems section={section} close={close} onRename={onRename} />
    )}>
      <Icon d={GEAR} />
      <span className="section-settings-label">Section</span>
    </MenuButton>
  )
}

/**
 * The open section's settings laid out in the column beside the tracks, in
 * place of the track names: its name to edit, then the same settings and
 * actions as the gear's menu.
 */
export function SectionPanel() {
  const id = useStore((s) => s.activeSection)
  const saved = useStore((s) => s.sections.find((sec) => sec.id === s.activeSection)?.name)
  const renameSection = useStore((s) => s.renameSection)
  const [name, setName] = useState(saved ?? '')
  useEffect(() => setName(saved ?? ''), [id, saved])
  if (saved === undefined) return null
  const section = { id, name: saved }
  const save = () => (name.trim() && name.trim() !== section.name ? renameSection(section.id, name) : setName(section.name))
  return (
    <div className="section-panel" role="group" aria-label={`${section.name} settings`}>
      <label className="section-panel-name">
        <span className="menu-label">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setName(section.name)
              e.currentTarget.blur()
            }
          }}
        />
      </label>
      <SectionItems section={section} close={() => {}} />
    </div>
  )
}

/** Each place in the song is a row this tall, with this gap under it: room for its chords, and a strip each for its drums and vocals. */
const ROW_H = 82
/** On a phone a row is stacked: its name on a line of its own, its chords the full width under it. */
const NARROW_ROW_H = 112
const NARROW_HEAD_H = 44
const ROW_GAP = 6
/** Room at the end of each row for its buttons. */
const END_PX = 150
const rowTop = (i: number, rowH = ROW_H) => i * (rowH + ROW_GAP)

/** An element's width, kept up to date as it changes. */
function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/** Which row a beat of the song falls in, and how far along it, in beats; past the end, the end of the last row. */
function rowAt(spans: ReturnType<typeof songSpans>, beat: number) {
  const i = spans.findIndex((span) => span.beats && beat < span.start + span.beats)
  if (i !== -1) return { i, along: Math.max(0, beat - spans[i].start) }
  const last = spans.length - 1
  return { i: Math.max(0, last), along: spans[last]?.beats ?? 0 }
}

/**
 * The whole song from above: each place a section plays is a row, in order
 * from the top, with its name and a miniature of its tracks, to scale: its
 * chords, its drums' kicks and snares, and where its vocals are. Click a row
 * to open the section.
 * Drag a row (or ⌥↑ ⌥↓) to reorder; play to hear the song through, the
 * playhead running along each row in turn.
 */
export function SongView() {
  const state = useStore()
  const { key, mode, timeSig, zoom, playing, playhead, arrangement, openSection, addToSong, addSection, moveInSong, removeFromSong, drumTrack, bpm } = state
  // Worked out here rather than in a selector, since they're new arrays each time.
  const sections = sectionsNow(state)
  const spans = songSpans(state)
  const [num, den] = timeSig
  // A take's length in beats at the song's tempo.
  const takeBeats = (seconds: number) => seconds * (bpm / 60) * (den / 4)
  const total = spans.reduce((n, span) => n + span.beats, 0)
  // The longest section's bar fills the width beside the names, and the others are to scale.
  // Zooming the timeline out doesn't shrink the song below that; zooming in widens it.
  const longest = Math.max(4 * num, ...spans.map((span) => span.beats))
  const scrollRef = useRef<HTMLDivElement>(null)
  const sheetWidth = useWidth(scrollRef)
  // Just room for the names, so the chords start close to them.
  // On a phone the name sits above the chords, so they get the full width.
  const narrow = sheetWidth > 0 && sheetWidth < 640
  const rowH = narrow ? NARROW_ROW_H : ROW_H
  const headPx = narrow ? 8 : 136
  // Room is left at the end of each row for its buttons: up, down, remove and the menu.
  // A phone has no zoom buttons, so there the song always fits the screen.
  const beatPx = (sheetWidth ? (sheetWidth - headPx - (narrow ? 16 : END_PX)) / longest : 8) * (narrow ? 1 : Math.max(1, zoom))
  const byId = new Map(sections.map((sec) => [sec.id, sec]))
  const uses = new Map<string, number>()
  for (const entry of arrangement) uses.set(entry.section, (uses.get(entry.section) ?? 0) + 1)

  // While playing, the playhead follows the song, the row being played lights up, and it's kept in view.
  const playheadRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const [current, setCurrent] = useState<string | null>(null)
  const spansRef = useRef(spans)
  spansRef.current = spans
  const placePlayhead = (el: HTMLElement | null, beat: number) => {
    if (!el) return
    const { i, along } = rowAt(spansRef.current, beat)
    el.style.transform = `translate(${along * beatPx}px, ${rowTop(i, rowH)}px)`
  }
  useEffect(() => {
    if (!playing) {
      setCurrent(null)
      return
    }
    let raf = 0
    const frame = () => {
      const raw = engine.position()
      const st = useStore.getState()
      // A section playing on its own shows in the first place it plays in the song.
      const beat = raw === null ? null : st.playingView === 'section' ? songBeatOf(st, raw) : raw
      if (playheadRef.current) playheadRef.current.style.visibility = raw !== null && beat === null ? 'hidden' : ''
      if (beat !== null) {
        placePlayhead(playheadRef.current, beat)
        const { i } = rowAt(spansRef.current, beat)
        setCurrent(spansRef.current[i]?.entry.id ?? null)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, beatPx])
  useEffect(() => {
    if (current) rowRefs.current.get(current)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [current])

  // Dragging a row: the others close up around it, as chords do in the editor.
  const [drag, setDrag] = useState<{ id: string; dy: number } | null>(null)
  const suppressClick = useRef(false)
  const dropIndex = (id: string, dy: number) => {
    const from = spans.findIndex((span) => span.entry.id === id)
    return Math.min(spans.length - 1, Math.max(0, from + Math.round(dy / (rowH + ROW_GAP))))
  }
  const order = (() => {
    if (!drag) return spans
    const dragged = spans.find((span) => span.entry.id === drag.id)!
    const rest = spans.filter((span) => span.entry.id !== drag.id)
    rest.splice(dropIndex(drag.id, drag.dy), 0, dragged)
    return rest
  })()
  const tops = new Map(
    order.map((span, i) => {
      const id = span.entry.id
      return [id, id === drag?.id ? rowTop(spans.findIndex((s) => s.entry.id === id), rowH) + drag.dy : rowTop(i, rowH)]
    }),
  )

  const startPress = (id: string, e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.song-row-actions')) return
    suppressClick.current = false
    const x0 = e.clientX
    const y0 = e.clientY
    let dy = 0
    let moved = false
    // On a touch screen a swipe scrolls the song; a row picks up after being held still.
    let held = e.pointerType !== 'touch'
    const hold = held ? undefined : setTimeout(() => ((held = true), navigator.vibrate?.(10)), 350)
    const stopScroll = (ev: TouchEvent) => held && ev.preventDefault()
    const onMove = (ev: globalThis.PointerEvent) => {
      dy = ev.clientY - y0
      if (!held) {
        if (Math.abs(ev.clientX - x0) > 8 || Math.abs(dy) > 8) finish(false)
        return
      }
      if (!moved && Math.abs(dy) < 5) return
      moved = true
      setDrag({ id, dy })
    }
    function finish(commit: boolean) {
      clearTimeout(hold)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('touchmove', stopScroll)
      if (!moved) return
      suppressClick.current = true
      if (commit) moveInSong(id, dropIndex(id, dy))
      setDrag(null)
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('touchmove', stopScroll, { passive: false })
  }

  const onRowKey = (e: KeyboardEvent<HTMLElement>, index: number, id: string) => {
    // ⌥↑ and ⌥↓ move the focused row; ⌥← and ⌥→ too, as they move a chord in the editor.
    const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0
    if (!e.altKey || !dir) return
    e.preventDefault()
    e.stopPropagation()
    moveInSong(id, index + dir)
  }

  const bars = (beats: number) => Math.ceil(beats / num)
  return (
    <div
      className={`song-view ${narrow ? 'is-narrow' : ''}`}
      style={{ ['--song-head' as string]: `${headPx}px`, ['--song-track-top' as string]: narrow ? `${NARROW_HEAD_H}px` : '0px' }}
    >
      <div className="song-scroll" ref={scrollRef}>
        <div className="song-sheet" style={{ width: `calc(var(--song-head) + ${longest * beatPx + (narrow ? 16 : END_PX)}px)`, height: rowTop(spans.length, rowH) + (narrow ? 80 : 60) }}>
          {/* Faint lines between the rows, staying put while a row is dragged past them. */}
          {spans.slice(1).map((_, i) => (
            <div key={i} className="song-divider" style={{ top: rowTop(i + 1, rowH) - ROW_GAP / 2 }} />
          ))}
          {order.map((span) => {
            const { entry, start, beats } = span
            const section = byId.get(entry.section)
            if (!section) return null
            const index = spans.findIndex((s) => s.entry.id === entry.id)
            return (
              <div
                key={entry.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(entry.id, el)
                  else rowRefs.current.delete(entry.id)
                }}
                className={`song-row ${entry.id === current ? 'is-playing' : ''} ${entry.id === drag?.id ? 'is-dragging' : ''} ${beats ? '' : 'is-empty'}`}
                style={{ top: tops.get(entry.id), height: rowH }}
                onPointerDown={(e) => startPress(entry.id, e)}
              >
                <button
                  type="button"
                  className="song-row-body"
                  onClick={(e) => {
                    if (suppressClick.current) {
                      suppressClick.current = false
                      return
                    }
                    // A click on its chords moves the playhead there; anywhere else on the row opens the section.
                    const bar = (e.target as HTMLElement).closest('.song-row-track')
                    if (bar && e.detail && beats) {
                      const along = (e.clientX - bar.getBoundingClientRect().left) / beatPx
                      void seek(start + Math.min(beats, Math.max(0, Math.round(along))))
                      return
                    }
                    openSection(section.id)
                  }}
                  onKeyDown={(e) => onRowKey(e, index, entry.id)}
                  aria-label={`${section.name}, from bar ${bars(start) + 1}, ${beats ? `${bars(beats)} bars` : 'empty'}. Edit it`}
                  title={`Click the name to edit ${section.name}, or its chords to play from there (⌥↑ ⌥↓ to move it)`}
                >
                  <span className="song-row-head">
                    {/* A grip to show the row can be dragged; the whole row drags, though. */}
                    <svg className="song-row-grip" width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
                      {[2, 8, 14].flatMap((y) => [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" fill="currentColor" />))}
                    </svg>
                    <span className="song-row-title">{section.name}</span>
                    {/* On a phone, how long it is and its key, beside its name. */}
                    {narrow && beats > 0 && (
                      <span className="song-row-length">
                        {bars(beats)} {bars(beats) === 1 ? 'bar' : 'bars'} · {section.chords.length} {section.chords.length === 1 ? 'chord' : 'chords'} ·{' '}
                        {keyLabel(section.sectionKey?.key ?? key, section.sectionKey?.mode ?? mode)} {section.sectionKey?.mode ?? mode}
                      </span>
                    )}
                  </span>
                  {/* The section's tracks in miniature, to scale with the other sections. */}
                  <span className="song-row-track" style={{ width: beats ? beats * beatPx : undefined }}>
                    <span className="song-row-bar">
                      {/* No chords yet: an invitation, opening the section to start it. */}
                      {!beats && (
                        <>
                          <Icon d="M12 5v14M5 12h14" />
                          Add chords
                        </>
                      )}
                      {section.chords.map((c, i) => {
                        const at = section.chords.slice(0, i).reduce((n, prev) => n + prev.beats, 0)
                        return (
                          <span key={c.id} className="song-chord" style={{ left: at * beatPx, width: c.beats * beatPx }}>
                            {chordOf(section.sectionKey?.key ?? key, section.sectionKey?.mode ?? mode, c).name}
                          </span>
                        )
                      })}
                    </span>
                    {/* The drums' kicks and snares, so a row shows at a glance it has a beat. */}
                    {drumTrack && section.drums && beats > 0 && (
                      <span className="song-row-drums" aria-label="Drums">
                        {grooveHits(section.drums, timeSig, 0, beats)
                          .filter((h) => h.piece !== 'hat')
                          .map((h, i) => (
                            // Inset from the bar's ends, so the first and last ticks sit under it.
                            <span key={i} className={`song-drum is-${h.piece}`} style={{ left: `calc(6px + (100% - 14px) * ${h.beat / beats})` }} />
                          ))}
                      </span>
                    )}
                    {/* Where each vocal take sits and how long it runs; several share the strip. */}
                    {beats > 0 && section.takes.some(Boolean) && (
                      <span className="song-row-vocals" aria-label="Vocals">
                        {section.takes.map((t, lane) => {
                          if (!t) return null
                          const used = section.takes.filter(Boolean).length
                          const slot = section.takes.slice(0, lane).filter(Boolean).length
                          const length = Math.min(takeBeats(t.seconds), beats - t.startBeat)
                          return (
                            <span
                              key={lane}
                              className="song-take"
                              style={{ left: t.startBeat * beatPx, width: Math.max(2, length * beatPx), top: `${(slot / used) * 100}%`, height: `${100 / used}%` }}
                            />
                          )
                        })}
                      </span>
                    )}
                  </span>
                </button>
                {/* Move it up or down the song, or take it out; the rest is in its menu. */}
                <div className="song-row-actions">
                  <button type="button" className="icon-btn song-row-act" disabled={index === 0} onClick={() => moveInSong(entry.id, index - 1)} aria-label={`Move ${section.name} earlier`} title="Move earlier (⌥↑)">
                    <Icon d="M6 15l6-6 6 6" />
                  </button>
                  <button type="button" className="icon-btn song-row-act" disabled={index === spans.length - 1} onClick={() => moveInSong(entry.id, index + 1)} aria-label={`Move ${section.name} later`} title="Move later (⌥↓)">
                    <Icon d="M6 9l6 6 6-6" />
                  </button>
                  <button type="button" className="icon-btn song-row-act" onClick={() => removeFromSong(entry.id)} aria-label={`Remove ${section.name} from the song`} title="Remove from the song; the section stays in its tab, and undo brings it back">
                    <Icon d="M6 6l12 12M18 6L6 18" />
                  </button>
                  <BlockMenu entryId={entry.id} section={section} index={index} count={spans.length} shared={(uses.get(section.id) ?? 0) > 1} />
                </div>
              </div>
            )
          })}

          <div className="song-add" style={{ top: rowTop(spans.length, rowH) }}>
            <MenuButton label="Add to the song" title="Add a section to the end of the song" className="song-add-btn" menu={(close) => (
              <>
                {sections.map((sec) => (
                  <button key={sec.id} type="button" className="menu-item menu-item-row" onClick={() => { addToSong(sec.id); close() }}>
                    <span className="menu-item-title">{sec.name}</span>
                    <span className="menu-item-about">{totalBeats(sec.chords) ? `${bars(totalBeats(sec.chords))} bars` : 'empty'}</span>
                  </button>
                ))}
                <div className="menu-divider" role="separator" />
                <p className="menu-label">New section</p>
                <NewSectionItems onPick={(name) => { addSection(name); close() }} />
              </>
            )}>
              <Icon d="M12 5v14M5 12h14" />
              {spans.length ? 'Section' : 'Add the song’s first section'}
            </MenuButton>
          </div>


          {total > 0 && (playing || playhead > 0) && (
            <div
              className="song-playhead"
              ref={(el) => {
                playheadRef.current = el
                if (!playing) placePlayhead(el, playhead)
              }}
              // Along the chords: under the name, on a phone.
              style={{ height: rowH - (narrow ? NARROW_HEAD_H : 0) }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** Move, unlink or remove one place in the song. */
function BlockMenu({ entryId, section, index, count, shared }: { entryId: string; section: Section; index: number; count: number; shared: boolean }) {
  const { moveInSong, removeFromSong, makeUnique, openSection, liftSection } = useStore()
  return (
    <MenuButton label={`${section.name} options`} className="song-row-more icon-btn" align="right" menu={(close) => {
      const act = (fn: () => void) => () => {
        fn()
        close()
      }
      return (
        <>
          <button type="button" className="menu-item" onClick={act(() => openSection(section.id))}>
            <span className="menu-item-title">Edit {section.name}</span>
          </button>
          <button type="button" className="menu-item" disabled={index === 0} onClick={act(() => moveInSong(entryId, index - 1))}>
            <span className="menu-item-title">Move earlier</span>
          </button>
          <button type="button" className="menu-item" disabled={index === count - 1} onClick={act(() => moveInSong(entryId, index + 1))}>
            <span className="menu-item-title">Move later</span>
          </button>
          <button type="button" className="menu-item" disabled={!shared} onClick={act(() => makeUnique(entryId))}>
            <span className="menu-item-title">Make this one a copy</span>
            <span className="menu-item-about">
              {shared ? `Its own copy of ${section.name}’s chords, to change without changing the others` : `${section.name} only plays here`}
            </span>
          </button>
          <button type="button" className="menu-item" onClick={act(() => liftSection(section.id, 2, entryId))}>
            <span className="menu-item-title">Lift this one a whole step</span>
            <span className="menu-item-about">Its own copy, two semitones up, as for a last chorus</span>
          </button>
          <div className="menu-divider" role="separator" />
          <button type="button" className="menu-item" onClick={act(() => removeFromSong(entryId))}>
            <span className="menu-item-title">Remove from the song</span>
            <span className="menu-item-about">The section itself stays, in its tab</span>
          </button>
        </>
      )
    }}>
      <Icon d="M6 12h.01M12 12h.01M18 12h.01" />
    </MenuButton>
  )
}
