import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { SECTION_KINDS, sectionsNow, totalBeats, useStore, type Section } from '../store'
import { keyLabel, type Mode } from '../music/theory'
import { engine } from '../audio/engine'
import { songSpans } from '../song'
import { Icon, ZoomButtons } from './Toolbar'

const KIND_COLORS = ['#8fa8c8', '#5ad8c8', '#e8c46a', '#ff8fa3', '#b39cff', '#9aa5b1']

/** What kind of section a name is: "Verse 2" is a verse. */
const sectionKind = (name: string) => name.replace(/\s+\d+$/, '').toLowerCase()

/** A colour for each kind of section, so a song's repeats are easy to pick out; "Verse 2" takes Verse's. */
function sectionColor(name: string) {
  const base = sectionKind(name)
  const kind = SECTION_KINDS.findIndex((k) => k.toLowerCase() === base)
  if (kind !== -1) return KIND_COLORS[kind]
  let hash = 0
  for (const ch of base) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return KIND_COLORS[hash % KIND_COLORS.length]
}

const colorStyle = (name: string) => ({ ['--section' as string]: sectionColor(name) }) as CSSProperties

/** The menu of section kinds to start a new section from. */
function NewSectionItems({ onPick }: { onPick: (name: string) => void }) {
  return (
    <>
      {SECTION_KINDS.map((kind) => (
        <button key={kind} type="button" className="menu-item menu-item-row" style={colorStyle(kind)} onClick={() => onPick(kind)}>
          <span className="section-dot" aria-hidden="true" />
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
  const { openSection, setView, addSection } = useStore()
  const inSong = new Set(arrangement.map((entry) => entry.section))
  const [renaming, setRenaming] = useState<string | null>(null)

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
          <Icon d="M4 6h4v12H4zM10 6h4v12h-4zM16 6h4v12h-4z" />
          Song
        </button>
        {sections.map((sec) => {
          const open = view === 'section' && sec.id === activeSection
          return (
            <div key={sec.id} className={`section-tab-wrap ${open ? 'is-open' : ''}`} style={colorStyle(sec.name)}>
              {renaming === sec.id ? (
                <RenameField section={sec} onDone={() => setRenaming(null)} />
              ) : (
                <button
                  type="button"
                  role="tab"
                  className={`section-tab ${inSong.has(sec.id) ? '' : 'is-unused'}`}
                  aria-selected={open}
                  disabled={recording && !open}
                  onClick={() => openSection(sec.id)}
                  onDoubleClick={() => setRenaming(sec.id)}
                  title={inSong.has(sec.id) ? `Edit ${sec.name} (double-click to rename)` : `${sec.name} isn’t in the song yet; add it in the song view`}
                >
                  <span className="section-dot" aria-hidden="true" />
                  {sec.name}
                </button>
              )}
              {open && renaming !== sec.id ? (
                <SectionMenu section={sec} onRename={() => setRenaming(sec.id)} />
              ) : (
                // The menu button's room, kept on every tab so opening one doesn't shift the rest.
                renaming !== sec.id && <span className="section-more-space" aria-hidden="true" />
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
      {/* Zoom works on whichever view is showing, so it sits with the views. */}
      <div className="section-bar-end">
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

/** Rename, duplicate or delete the open section. */
function SectionMenu({ section, onRename }: { section: Section; onRename: () => void }) {
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
    <MenuButton label={`${section.name} options`} className="section-more icon-btn" menu={(close) => (
      <>
        <button type="button" className="menu-item" onClick={() => { onRename(); close() }}>
          <span className="menu-item-title">Rename</span>
        </button>
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
    )}>
      <Icon d="M6 12h.01M12 12h.01M18 12h.01" />
    </MenuButton>
  )
}

/** Each place in the song is a slim row this tall, with this gap under it. */
const ROW_H = 40
const ROW_GAP = 6
const rowTop = (i: number) => i * (ROW_H + ROW_GAP)

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
 * The whole song from above: each place a section plays is a slim row, in
 * order from the top, with its name and a bar as long as it is. The detail
 * (chords, drums, vocals) is in the section itself: click a row to open it.
 * Drag a row (or ⌥↑ ⌥↓) to reorder; play to hear the song through, the
 * playhead running along each row in turn.
 */
export function SongView() {
  const state = useStore()
  const { timeSig, zoom, playing, playhead, arrangement, openSection, addToSong, addSection, moveInSong } = state
  // Worked out here rather than in a selector, since they're new arrays each time.
  const sections = sectionsNow(state)
  const spans = songSpans(state)
  const [num] = timeSig
  const total = spans.reduce((n, span) => n + span.beats, 0)
  // The longest section's bar fills the width beside the names (at normal zoom), and the others are to scale.
  const longest = Math.max(4 * num, ...spans.map((span) => span.beats))
  const scrollRef = useRef<HTMLDivElement>(null)
  const sheetWidth = useWidth(scrollRef)
  const headPx = sheetWidth && sheetWidth < 640 ? 120 : 180
  // Room is left at the end of each row for its menu button.
  const beatPx = (sheetWidth ? (sheetWidth - headPx - 44) / longest : 8) * zoom
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
    el.style.transform = `translate(${along * beatPx}px, ${rowTop(i)}px)`
  }
  useEffect(() => {
    if (!playing) {
      setCurrent(null)
      return
    }
    let raf = 0
    const frame = () => {
      const beat = engine.position()
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
    return Math.min(spans.length - 1, Math.max(0, from + Math.round(dy / (ROW_H + ROW_GAP))))
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
      return [id, id === drag?.id ? rowTop(spans.findIndex((s) => s.entry.id === id)) + drag.dy : rowTop(i)]
    }),
  )

  const startPress = (id: string, e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.song-row-more')) return
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
    <div className="song-view" style={{ ['--song-head' as string]: `${headPx}px` }}>
      <div className="song-scroll" ref={scrollRef}>
        <div className="song-sheet" style={{ width: `calc(var(--song-head) + ${longest * beatPx + 44}px)`, height: rowTop(spans.length) + 44 }}>
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
                style={{ ...colorStyle(section.name), top: tops.get(entry.id), height: ROW_H }}
                onPointerDown={(e) => startPress(entry.id, e)}
              >
                <button
                  type="button"
                  className="song-row-body"
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false
                      return
                    }
                    openSection(section.id)
                  }}
                  onKeyDown={(e) => onRowKey(e, index, entry.id)}
                  aria-label={`${section.name}, from bar ${bars(start) + 1}, ${beats ? `${bars(beats)} bars` : 'empty'}. Edit it`}
                  title={`Edit ${section.name} (⌥↑ ⌥↓ to move it)`}
                >
                  <span className="song-row-head">
                    <span className="section-dot" aria-hidden="true" />
                    <span className="song-row-title">{section.name}</span>
                    <span className="song-row-meta">{beats ? bars(beats) : '–'}</span>
                  </span>
                  {/* The section's length, to scale with the others. */}
                  <span className="song-row-track">
                    <span className="song-row-bar" style={{ width: beats ? beats * beatPx : undefined }} />
                  </span>
                </button>
                <BlockMenu entryId={entry.id} section={section} index={index} count={spans.length} shared={(uses.get(section.id) ?? 0) > 1} />
              </div>
            )
          })}

          {/* As wide as the view, even when zooming in makes the rows scroll sideways. */}
          <div className="song-add" style={{ top: rowTop(spans.length), width: sheetWidth || undefined }}>
            <MenuButton label="Add to the song" title="Add a section to the end of the song" className="song-add-btn" menu={(close) => (
              <>
                {sections.map((sec) => (
                  <button key={sec.id} type="button" className="menu-item menu-item-row" style={colorStyle(sec.name)} onClick={() => { addToSong(sec.id); close() }}>
                    <span className="section-dot" aria-hidden="true" />
                    <span className="menu-item-title">{sec.name}</span>
                    <span className="menu-item-about">{totalBeats(sec.chords) ? `${bars(totalBeats(sec.chords))} bars` : 'empty'}</span>
                  </button>
                ))}
                <div className="menu-divider" role="separator" />
                <p className="menu-label">New section</p>
                <NewSectionItems onPick={(name) => { addSection(name); close() }} />
              </>
            )}>
              <span aria-hidden="true">+</span> {spans.length ? 'Add a section' : 'The song is empty: add its first section'}
            </MenuButton>
          </div>

          {total > 0 && (playing || playhead > 0) && (
            <div
              className="song-playhead"
              ref={(el) => {
                playheadRef.current = el
                if (!playing) placePlayhead(el, playhead)
              }}
              style={{ height: ROW_H }}
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
