import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { audibleTracks, chordsTrackName, useStore, vocalTrackName, type Chord } from '../store'
import { chordInfo } from '../music/theory'
import { audition, engine, seek } from '../audio/engine'
import { LoopLane } from './LoopLane'
import type { TakeInfo } from '../audio/take'

interface Drag {
  id: string
  /** How far the pointer has moved, in px. */
  dx: number
}

/**
 * Where a dragged chord would land: the other chords close up around it, and
 * it goes in front of the first one whose middle its own middle hasn't passed.
 */
function dragLayout(chords: Chord[], drag: Drag | null, beatPx: number) {
  const from = drag ? chords.findIndex((c) => c.id === drag.id) : -1
  if (!drag || from === -1) return { order: chords, to: -1, originLeft: 0 }
  const dragged = chords[from]
  const originBeat = chords.slice(0, from).reduce((sum, c) => sum + c.beats, 0)
  const middle = originBeat + drag.dx / beatPx + dragged.beats / 2
  const others = chords.filter((c) => c.id !== drag.id)
  let beat = 0
  let to = 0
  for (const c of others) {
    if (beat + c.beats / 2 < middle) to++
    beat += c.beats
  }
  const order = [...others]
  order.splice(to, 0, dragged)
  return { order, to, originLeft: originBeat * beatPx }
}

export function Timeline() {
  const { chords, key, mode, timeSig, selectedId, playing, loopOn } = useStore()
  const { select, updateChord, addChord, reorderChord } = useStore()
  const [num, den] = timeSig
  // Shorter beat units get narrower columns, so a bar stays a sensible width.
  const zoom = useStore((s) => s.zoom)
  const beatPx = (den === 16 ? 20 : den === 8 ? 30 : 44) * zoom
  const barPx = num * beatPx

  const totalBeats = chords.reduce((sum, c) => sum + c.beats, 0)
  const bars = Math.max(1, Math.ceil(totalBeats / num))
  const width = Math.max(bars * barPx, totalBeats * beatPx) + barPx

  const playheadRef = useRef<HTMLDivElement>(null)
  const playhead = useStore((s) => s.playhead)
  const recordingRef = useRef<HTMLDivElement>(null)
  const { takes, recording, bpm, armedLane, selectedVocal, selectVocal, vocalTracks, vocalNames } = useStore()
  const audible = audibleTracks(useStore())
  // The tracks added so far, plus the one a recording is adding.
  const laneCount = Math.max(vocalTracks, recording === 'off' ? 0 : armedLane + 1)
  const recordStart = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  // The + slot moves whenever the progression's length changes. When it slides
  // under a still pointer it shouldn't light up as if picked, so its hover
  // waits until the pointer moves over it at its new place.
  const [slotAt, setSlotAt] = useState(totalBeats)
  const [slotMoved, setSlotMoved] = useState(false)
  if (slotAt !== totalBeats) {
    setSlotAt(totalBeats)
    setSlotMoved(true)
  }

  const [drag, setDrag] = useState<Drag | null>(null)
  const suppressClick = useRef(false)
  // Chords stay in their stored order on the page while one is dragged (moving
  // DOM nodes mid-drag would drop the pointer); only their positions change.
  const layout = dragLayout(chords, drag, beatPx)
  const lefts = new Map<string, number>()
  {
    let beat = 0
    for (const c of layout.order) {
      lefts.set(c.id, c.id === drag?.id ? layout.originLeft + drag.dx : beat * beatPx)
      beat += c.beats
    }
  }

  // A press is followed on the window rather than the chord, so a fast drag
  // that outruns the chord, or a re-render under the pointer, can't lose it.
  // On a touch screen a swipe scrolls the timeline, so a chord only picks up
  // for dragging after you hold it still for a moment.
  const startPress = (c: Chord, e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    suppressClick.current = false
    const x = e.clientX
    let dx = 0
    let moved = false
    const touch = e.pointerType === 'touch'
    let held = !touch
    const hold = touch
      ? setTimeout(() => {
          held = true
          select(c.id)
          navigator.vibrate?.(10)
        }, 350)
      : undefined
    // Once held, keep the page from scrolling under the drag.
    const stopScroll = (ev: TouchEvent) => held && ev.preventDefault()

    const onMove = (ev: globalThis.PointerEvent) => {
      dx = ev.clientX - x
      if (!held) {
        if (Math.abs(dx) > 8 || Math.abs(ev.clientY - e.clientY) > 8) finish(false)
        return
      }
      if (!moved && Math.abs(dx) < 5) return
      if (!moved) {
        moved = true
        select(c.id)
      }
      setDrag({ id: c.id, dx })
    }
    function finish(commit: boolean) {
      clearTimeout(hold)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('touchmove', stopScroll)
      if (!moved) return
      suppressClick.current = true
      if (commit) {
        const { to } = dragLayout(useStore.getState().chords, { id: c.id, dx }, beatPx)
        if (to !== -1) reorderChord(c.id, to)
      }
      setDrag(null)
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    if (touch) window.addEventListener('touchmove', stopScroll, { passive: false })
  }

  // Zoom around the middle of the view, so what you were looking at stays put.
  const lastBeatPx = useRef(beatPx)
  useLayoutEffect(() => {
    const view = scrollRef.current
    const ratio = beatPx / lastBeatPx.current
    lastBeatPx.current = beatPx
    if (!view || ratio === 1) return
    const mid = view.scrollLeft + view.clientWidth / 2
    view.scrollLeft = mid * ratio - view.clientWidth / 2
  }, [beatPx])

  useEffect(() => {
    // Where the take will start, from the recording itself: the playhead may
    // already be a little past it, or not moving yet, when this runs.
    if (recording === 'on') recordStart.current = engine.recordingStartBeat
  }, [recording])

  useEffect(() => {
    if (!playing) {
      setActiveId(null)
      return
    }
    let raf = 0
    // Where a smooth scroll is heading, so it isn't restarted every frame.
    let target: number | null = null
    const frame = () => {
      const pos = engine.position()
      if (pos !== null && playheadRef.current) {
        const x = pos * beatPx
        playheadRef.current.style.transform = `translateX(${x}px)`
        if (recordingRef.current) {
          recordingRef.current.style.left = `${recordStart.current * beatPx}px`
          recordingRef.current.style.width = `${Math.max(0, x - recordStart.current * beatPx)}px`
        }
        // Turn the page when the playhead runs off either edge, as it does at
        // the end of the view or when the loop jumps back.
        const view = scrollRef.current
        if (view) {
          if (target !== null && Math.abs(view.scrollLeft - target) < 2) target = null
          const left = target ?? view.scrollLeft
          if (x < left || x > left + view.clientWidth - 24) {
            target = Math.min(Math.max(0, x - 24), view.scrollWidth - view.clientWidth)
            view.scrollTo({ left: target, behavior: 'smooth' })
          }
        }
        let start = 0
        const chs = useStore.getState().chords
        let id: string | null = null
        for (const c of chs) {
          if (pos >= start && pos < start + c.beats) id = c.id
          start += c.beats
        }
        setActiveId(id)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing, beatPx])

  return (
    <div className="timeline-wrap" style={{ ['--lanes' as string]: laneCount }}>
      <TrackHeaders laneCount={laneCount} />
      <div className="timeline-scroll" ref={scrollRef}>
        <div
          className={`timeline ${chords.length ? '' : 'is-empty'} ${audible.chords ? '' : 'chords-silent'}`}
          style={{
            width,
            ['--beat' as string]: `${beatPx}px`,
            ['--bar' as string]: `${barPx}px`,
          }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) select(null)
          }}
        >
          {chords.length > 0 && (
            <div
              className="ruler"
              title="Click to move the playhead"
              onPointerDown={(e) => {
                // To the nearest beat.
                const x = e.clientX - e.currentTarget.getBoundingClientRect().left
                void seek(Math.min(totalBeats, Math.max(0, Math.round(x / beatPx))))
              }}
            >
              {Array.from({ length: bars + 1 }, (_, i) => (
                <span key={i} style={{ left: i * barPx }}>
                  {i + 1}
                </span>
              ))}
            </div>
          )}

          {loopOn && totalBeats > 0 && <LoopLane beatPx={beatPx} total={totalBeats} perBar={num} />}

          {chords.length === 0 && (
            <p className="timeline-empty" style={{ left: barPx + 16 }}>
              <span>Pick a chord below, or press 1–7, to start a progression.</span>
            </p>
          )}

          {chords.map((c) => {
            const isDragged = c.id === drag?.id
            return (
              <ChordBlock
                key={c.id}
                chord={c}
                left={lefts.get(c.id) ?? 0}
                beatPx={beatPx}
                name={chordInfo(key, mode, c.degree, c.seventh).name}
                roman={chordInfo(key, mode, c.degree, c.seventh).roman}
                selected={c.id === selectedId}
                active={c.id === activeId}
                dragging={isDragged}
                onPress={(e) => startPress(c, e)}
                onSelect={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false
                    return
                  }
                  select(c.id)
                  audition(c)
                }}
                onResize={(beats) => updateChord(c.id, { beats })}
              />
            )
          })}

          <button
            type="button"
            className={`add-slot ${slotMoved ? 'is-moved' : ''}`}
            style={{ left: totalBeats * beatPx, width: barPx - 6 }}
            onPointerMove={() => slotMoved && setSlotMoved(false)}
            // A click shouldn't leave focus here, or the keys that follow
            // (⌫ especially) draw a focus ring that looks like a selected chord.
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              select(chords[chords.length - 1]?.id ?? null)
              addChord(0)
            }}
            aria-label="Add a bar"
          >
            +
          </button>

          {Array.from({ length: laneCount }, (_, lane) => (
            <VocalLane
              key={lane}
              lane={lane}
              name={vocalTrackName({ vocalNames }, lane)}
              take={takes[lane]}
              muted={!audible.vocals[lane]}
              locked={recording !== 'off'}
              selected={lane === selectedVocal}
              onSelect={() => selectVocal(lane)}
              bpm={bpm}
              beatPx={beatPx}
              beatsPerQuarter={den / 4}
            />
          ))}
          {recording === 'on' && (
            <div className="vocal-recording" ref={recordingRef} style={{ ['--row' as string]: armedLane }} aria-hidden="true" />
          )}

          {chords.length > 0 && (playing || playhead > 0) && (
            // While playing, the animation frame moves it; paused, it marks where play resumes.
            <div className="playhead" ref={playheadRef} style={{ transform: `translateX(${playhead * beatPx}px)` }} aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  )
}

interface BlockProps {
  chord: Chord
  left: number
  beatPx: number
  name: string
  roman: string
  selected: boolean
  active: boolean
  dragging: boolean
  onPress: (e: PointerEvent<HTMLButtonElement>) => void
  onSelect: () => void
  onResize: (beats: number) => void
}

function ChordBlock({ chord, left, beatPx, name, roman, selected, active, dragging, onPress, onSelect, onResize }: BlockProps) {
  const drag = useRef<{ x: number; beats: number } | null>(null)

  return (
    <div
      className={`chord ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''} ${dragging ? 'is-dragging' : ''}`}
      style={{ left, width: chord.beats * beatPx - 6 }}
    >
      <button type="button" className="chord-body" onClick={onSelect} aria-pressed={selected} title="Click to select · drag to move" onPointerDown={onPress}>
        <span className="chord-name">{name}</span>
        <span className="chord-roman">{roman}</span>
      </button>
      <div
        className="resize"
        role="slider"
        tabIndex={-1}
        aria-label={`Length of ${name}`}
        aria-valuemin={1}
        aria-valuenow={chord.beats}
        title="Drag to change length"
        onPointerDown={(e) => {
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, beats: chord.beats }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const beats = Math.max(1, Math.round(drag.current.beats + (e.clientX - drag.current.x) / beatPx))
          if (beats !== chord.beats) onResize(beats)
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
    </div>
  )
}

interface VocalLaneProps {
  lane: number
  name: string
  take: TakeInfo | null
  muted: boolean
  /** True while recording, when the selection can't change. */
  locked: boolean
  /** Its take is selected, for deleting or recording over. */
  selected: boolean
  onSelect: () => void
  bpm: number
  beatPx: number
  /** Beats per quarter note: 1 in x/4, 2 in x/8. */
  beatsPerQuarter: number
}

/** One vocal track: click it to select it (to record into, or delete); its take is drawn at the beat it starts on. */
function VocalLane({ lane, name, take, muted, selected, locked, onSelect, bpm, beatPx, beatsPerQuarter }: VocalLaneProps) {
  const row = { ['--row' as string]: lane }
  let content = null
  if (take) {
    const pxPerSecond = (bpm / 60) * beatsPerQuarter * beatPx
    const width = take.seconds * pxPerSecond - 6
    // One bar every 4px, each as tall as the loudest moment it covers.
    const count = Math.max(1, Math.floor((width - 4) / 4))
    const per = take.peaks.length / count
    const bars = Array.from({ length: count }, (_, i) => Math.max(...take.peaks.slice(Math.floor(i * per), Math.ceil((i + 1) * per)), 0))
    content = (
      <div
        className={`vocal-take ${muted ? 'is-muted' : ''} ${selected ? 'is-selected' : ''}`}
        style={{ ...row, left: take.startBeat * beatPx, width }}
        role="img"
        aria-label={`${name} waveform`}
      >
        {bars.map((b, i) => (
          <span key={i} style={{ height: `${Math.max(6, b * 80)}%` }} />
        ))}
      </div>
    )
  }
  return (
    <>
      <button
        type="button"
        className={`vocal-row ${take ? '' : 'is-empty'} ${selected ? 'is-selected' : ''}`}
        style={row}
        aria-pressed={selected}
        aria-label={take ? `${name}: select` : `${name}, empty: select to record into it`}
        title={take && take.bpm !== bpm ? `${name}, recorded at ${take.bpm} BPM; it won't follow tempo changes` : name}
        disabled={locked}
        onClick={onSelect}
      />
      {content}
    </>
  )
}

/** Track names with mute and solo, beside each track's row. */
function TrackHeaders({ laneCount }: { laneCount: number }) {
  const s = useStore()
  return (
    <div className="track-headers">
      <TrackHeader
        className="is-chords"
        icon={<KeysIcon />}
        name={chordsTrackName(s)}
        muted={s.chordsMuted}
        solo={s.chordsSolo}
        onMute={s.toggleChordsMute}
        onSolo={s.toggleChordsSolo}
        onRename={s.renameChords}
      />
      {Array.from({ length: laneCount }, (_, lane) => (
        <TrackHeader
          key={lane}
          className={`is-vocal ${s.selectedVocal === lane ? 'is-selected' : ''}`}
          icon={<MicIcon />}
          style={{ ['--row' as string]: lane }}
          name={vocalTrackName(s, lane)}
          muted={s.vocalMuted[lane]}
          solo={s.vocalSolo[lane]}
          onMute={() => s.toggleVocalMute(lane)}
          onSolo={() => s.toggleVocalSolo(lane)}
          onRename={(name) => s.renameVocal(lane, name)}
        />
      ))}
    </div>
  )
}

interface TrackHeaderProps {
  name: string
  /** What kind of track it is, at a glance. */
  icon: ReactNode
  className: string
  style?: CSSProperties
  muted: boolean
  solo: boolean
  onMute: () => void
  onSolo: () => void
  /** An empty name puts the usual one back. */
  onRename: (name: string) => void
}

function TrackHeader({ name, icon, className, style, muted, solo, onMute, onSolo, onRename }: TrackHeaderProps) {
  const [editing, setEditing] = useState(false)
  // A double tap or double click; timed by hand, since phones don't reliably send dblclick.
  const lastTap = useRef(0)
  return (
    <div className={`track-header ${className}`} style={style} role="group" aria-label={name}>
      <span className="track-title">
        {icon}
        {editing ? (
          <input
            className="track-name-input"
            defaultValue={name}
            aria-label="Track name"
            maxLength={24}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              onRename(e.currentTarget.value)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                e.currentTarget.value = name
                e.currentTarget.blur()
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="track-name"
            title="Double-click to rename"
            onClick={(e) => {
              if (e.timeStamp - lastTap.current < 400) setEditing(true)
              lastTap.current = e.timeStamp
            }}
          >
            {name}
          </button>
        )}
      </span>
      <button type="button" className="track-btn is-mute" aria-pressed={muted} aria-label={`Mute ${name}`} title="Mute" onClick={onMute}>
        M
      </button>
      <button type="button" className="track-btn is-solo" aria-pressed={solo} aria-label={`Solo ${name}`} title="Solo" onClick={onSolo}>
        S
      </button>
    </div>
  )
}

const trackIcon = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
  className: 'track-icon',
} as const

/** A piano keyboard, for the chords. */
const KeysIcon = () => (
  <svg {...trackIcon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M9 13v6M15 13v6" />
    <rect x="7.5" y="5" width="3" height="8" fill="currentColor" stroke="none" />
    <rect x="13.5" y="5" width="3" height="8" fill="currentColor" stroke="none" />
  </svg>
)

/** A microphone, for the vocals. */
const MicIcon = () => (
  <svg {...trackIcon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
  </svg>
)
