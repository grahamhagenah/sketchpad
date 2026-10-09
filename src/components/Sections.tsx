import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SECTION_KINDS, sectionsNow, totalBeats, useStore, type Section } from '../store'
import { chordOf } from '../music/theory'
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
  const { duplicateSection, deleteSection, openSection, addToSong } = useStore()
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

/** The narrowest a place in the song is drawn, so a short section's name and chords stay readable. */
const MIN_BLOCK = 170

/**
 * Where each place in the song is drawn. Each is sized to its length, but
 * never narrower than MIN_BLOCK, so a short one is stretched; `scale` is its
 * own pixels per beat. An empty section still gets that width, to be seen and picked.
 */
function layout(spans: ReturnType<typeof songSpans>, beatPx: number) {
  let x = 0
  return spans.map((span) => {
    const width = Math.max(span.beats * beatPx, MIN_BLOCK)
    const placed = { ...span, x, width, scale: span.beats ? width / span.beats : beatPx }
    x += width
    return placed
  })
}
type Placed = ReturnType<typeof layout>[number]

/** The x of a beat of the song, through each place's own scale. */
function beatToX(placed: Placed[], beat: number) {
  for (const p of placed) if (p.beats && beat < p.start + p.beats) return p.x + Math.max(0, beat - p.start) * p.scale
  const last = placed[placed.length - 1]
  return last ? last.x + last.width : 0
}

/**
 * The whole song: each place a section plays, in order, sized to its length
 * and showing its chords. Click one to edit it; drag to reorder; play to
 * hear the song through.
 */
export function SongView() {
  const state = useStore()
  const { key, mode, timeSig, zoom, playing, playhead, arrangement, openSection, addToSong, addSection, moveInSong } = state
  // Worked out here rather than in a selector, since they're new arrays each time.
  const sections = sectionsNow(state)
  const spans = songSpans(state)
  const [num, den] = timeSig
  // Narrower than the section editor: a song runs much longer than one section.
  const beatPx = (den === 16 ? 12 : den === 8 ? 16 : 24) * zoom
  const placed = layout(spans, beatPx)
  const total = spans.reduce((n, span) => n + span.beats, 0)
  const width = (placed.length ? placed[placed.length - 1].x + placed[placed.length - 1].width : 0)
  const byId = new Map(sections.map((sec) => [sec.id, sec]))
  const uses = new Map<string, number>()
  for (const entry of arrangement) uses.set(entry.section, (uses.get(entry.section) ?? 0) + 1)

  // While playing, the playhead follows the song and the place being played lights up.
  const playheadRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const placedRef = useRef(placed)
  placedRef.current = placed
  useEffect(() => {
    if (!playing) {
      setCurrent(null)
      return
    }
    let raf = 0
    const frame = () => {
      const beat = engine.position()
      if (beat !== null) {
        if (playheadRef.current) playheadRef.current.style.transform = `translateX(${beatToX(placedRef.current, beat)}px)`
        setCurrent(placedRef.current.find((p) => p.beats && beat >= p.start && beat < p.start + p.beats)?.entry.id ?? null)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing, beatPx])

  // Dragging a block: the others close up around it, as chords do in the editor.
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null)
  const suppressClick = useRef(false)
  const dropIndex = (id: string, dx: number) => {
    const from = placed.findIndex((p) => p.entry.id === id)
    const middle = placed[from].x + dx + placed[from].width / 2
    return placed.filter((p) => p.entry.id !== id).filter((p) => p.x + p.width / 2 < middle).length
  }
  const order = (() => {
    if (!drag) return placed
    const to = dropIndex(drag.id, drag.dx)
    const dragged = placed.find((p) => p.entry.id === drag.id)!
    const rest = placed.filter((p) => p.entry.id !== drag.id)
    rest.splice(to, 0, dragged)
    return rest
  })()
  const lefts = new Map<string, number>()
  {
    let x = 0
    for (const p of order) {
      lefts.set(p.entry.id, p.entry.id === drag?.id ? p.x + drag.dx : x)
      x += p.width
    }
  }

  const startPress = (id: string, e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.song-block-more')) return
    suppressClick.current = false
    const x0 = e.clientX
    const y0 = e.clientY
    let dx = 0
    let moved = false
    // On a touch screen a swipe scrolls the song; a block picks up after being held still.
    let held = e.pointerType !== 'touch'
    const hold = held ? undefined : setTimeout(() => ((held = true), navigator.vibrate?.(10)), 350)
    const stopScroll = (ev: TouchEvent) => held && ev.preventDefault()
    const onMove = (ev: globalThis.PointerEvent) => {
      dx = ev.clientX - x0
      if (!held) {
        if (Math.abs(dx) > 8 || Math.abs(ev.clientY - y0) > 8) finish(false)
        return
      }
      if (!moved && Math.abs(dx) < 5) return
      moved = true
      setDrag({ id, dx })
    }
    function finish(commit: boolean) {
      clearTimeout(hold)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('touchmove', stopScroll)
      if (!moved) return
      suppressClick.current = true
      if (commit) moveInSong(id, dropIndex(id, dx))
      setDrag(null)
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('touchmove', stopScroll, { passive: false })
  }

  const onBlockKey = (e: KeyboardEvent<HTMLElement>, index: number, id: string) => {
    // ⌥← and ⌥→ move the focused block, as they move a chord in the editor.
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    e.preventDefault()
    e.stopPropagation()
    moveInSong(id, index + (e.key === 'ArrowLeft' ? -1 : 1))
  }

  return (
    <div className="song-view">
      <div className="song-scroll">
        <div className="song-lane" style={{ width: width + 140 }}>

          {order.map((p) => {
            const section = byId.get(p.entry.section)
            if (!section) return null
            const index = placed.findIndex((q) => q.entry.id === p.entry.id)
            const hasVocals = section.takes.some(Boolean)
            return (
              <div
                key={p.entry.id}
                className={`song-block ${p.entry.id === current ? 'is-playing' : ''} ${p.entry.id === drag?.id ? 'is-dragging' : ''} ${p.beats ? '' : 'is-empty'}`}
                style={{ ...colorStyle(section.name), left: lefts.get(p.entry.id), width: p.width - 6 }}
                onPointerDown={(e) => startPress(p.entry.id, e)}
              >
                <button
                  type="button"
                  className="song-block-body"
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false
                      return
                    }
                    openSection(section.id)
                  }}
                  onKeyDown={(e) => onBlockKey(e, index, p.entry.id)}
                  aria-label={`${section.name}, ${p.beats ? `${Math.ceil(p.beats / num)} bars` : 'empty'}. Edit it`}
                  title={`Edit ${section.name} (⌥← ⌥→ to move it)`}
                >
                  <span className="song-block-name">
                    <span className="section-dot" aria-hidden="true" />
                    {section.name}
                    {(uses.get(section.id) ?? 0) > 1 && <span className="song-block-shared" title="Plays more than once; changing it changes every place it plays">⧉</span>}
                    {hasVocals && (
                      <svg className="song-block-mic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="Has vocals">
                        <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />
                      </svg>
                    )}
                  </span>
                  {/* Each chord where it falls in the section, as in the editor. */}
                  <span className="song-block-chords" aria-hidden={section.chords.length > 0}>
                    {section.chords.length
                      ? section.chords.map((c, i) => {
                          const at = section.chords.slice(0, i).reduce((n, prev) => n + prev.beats, 0)
                          return (
                            <span key={c.id} className="song-chord" style={{ left: at * p.scale, width: c.beats * p.scale }}>
                              {chordOf(key, mode, c).name}
                            </span>
                          )
                        })
                      : 'No chords yet'}
                  </span>
                  <span className="song-block-bars">{p.beats ? `${Math.ceil(p.beats / num)} ${Math.ceil(p.beats / num) === 1 ? 'bar' : 'bars'}` : ''}</span>
                </button>
                <BlockMenu entryId={p.entry.id} section={section} index={index} count={placed.length} shared={(uses.get(section.id) ?? 0) > 1} />
              </div>
            )
          })}

          <div className="song-add" style={{ left: width }}>
            <MenuButton label="Add to the song" title="Add a section to the end of the song" className="song-add-btn" menu={(close) => (
              <>
                {sections.map((sec) => (
                  <button key={sec.id} type="button" className="menu-item menu-item-row" style={colorStyle(sec.name)} onClick={() => { addToSong(sec.id); close() }}>
                    <span className="section-dot" aria-hidden="true" />
                    <span className="menu-item-title">{sec.name}</span>
                    <span className="menu-item-about">{totalBeats(sec.chords) ? `${Math.ceil(totalBeats(sec.chords) / num)} bars` : 'empty'}</span>
                  </button>
                ))}
                <div className="menu-divider" role="separator" />
                <p className="menu-label">New section</p>
                <NewSectionItems onPick={(name) => { addSection(name); close() }} />
              </>
            )}>
              +
            </MenuButton>
          </div>

          {placed.length === 0 && <p className="song-empty">The song is empty. Add sections with +, in the order they play.</p>}

          {total > 0 && (playing || playhead > 0) && (
            <div className="playhead song-playhead" ref={playheadRef} style={{ transform: `translateX(${beatToX(placed, playhead)}px)` }} aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  )
}

/** Move, unlink or remove one place in the song. */
function BlockMenu({ entryId, section, index, count, shared }: { entryId: string; section: Section; index: number; count: number; shared: boolean }) {
  const { moveInSong, removeFromSong, makeUnique, openSection } = useStore()
  return (
    <MenuButton label={`${section.name} options`} className="song-block-more icon-btn" align="right" menu={(close) => {
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
