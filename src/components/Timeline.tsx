import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { AUDIBLE_FIELDS, audibleTracks, chordsTrackName, drumsTrackName, keyOf, useFields, useStore, vocalTrackName, type Chord } from '../store'
import { chordOf } from '../music/theory'
import { audition, engine, moveTake, seek, trimTake } from '../audio/engine'
import { earliestMove, sectionBeatOf } from '../song'
import { cuts, LANES, MIN_TRIM, trimOf, type Trim } from '../audio/take'
import { LoopLane } from './LoopLane'
import { AddChordMenu } from './AddChordMenu'
import { SectionStarter } from './SectionStarter'
import type { TakeInfo } from '../audio/take'
import { grooveHits, grooveLabel } from '../audio/drums'
import { MenuButton } from './Sections'
import { useNarrow } from '../hooks/useNarrow'
import { InspectorButton, showInspector, useInspector } from './InspectorToggle'
import { setLyricsOpen, useLyricsPanel } from '../lyricsPanel'
import { PALETTE, vocalColor, vocalColorId, DEFAULT_CHORDS_COLOR, DEFAULT_DRUMS_COLOR, type ColorId } from '../colors'

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
  const { chords, timeSig, selectedId, playing, loopOn, select, updateChord, reorderChord } = useFields('chords', 'timeSig', 'selectedId', 'playing', 'loopOn', 'select', 'updateChord', 'reorderChord')
  // The open section's key: its own, if it has one.
  const { key, mode } = keyOf(useFields('key', 'mode', 'sectionKey'))
  const [num, den] = timeSig
  // Shorter beat units get narrower columns, so a bar stays a sensible width.
  // A phone has no zoom buttons, and starts zoomed out, to see more of the section at once.
  const zoom = useStore((s) => s.zoom)
  const narrow = useNarrow()
  const beatPx = (den === 16 ? 20 : den === 8 ? 30 : 44) * (narrow ? NARROW_ZOOM : zoom)
  const barPx = num * beatPx

  // Where a bar divides: 6/8, 9/8 and 12/8 in threes; others halfway, the longer half first in an odd meter (7/8 as 4 + 3); 2/4 and 3/4 not at all.
  const divides = (beatInBar: number) =>
    den === 8 && num % 3 === 0 && num > 3 ? beatInBar % 3 === 0 : num >= 4 && beatInBar === Math.ceil(num / 2)

  const totalBeats = chords.reduce((sum, c) => sum + c.beats, 0)
  const bars = Math.max(1, Math.ceil(totalBeats / num))
  const width = Math.max(bars * barPx, totalBeats * beatPx) + barPx

  const playheadRef = useRef<HTMLDivElement>(null)
  const playhead = useStore((s) => s.playhead)
  const recordingRef = useRef<HTMLDivElement>(null)
  const { takes, allTakes, trims, recording, bpm, armedLane, selectedVocal, selectVocal, vocalTracks, vocalNames, vocalColors, chordsTrackSelected } = useFields(
    'takes', 'allTakes', 'trims', 'recording', 'bpm', 'armedLane', 'selectedVocal', 'selectVocal', 'vocalTracks', 'vocalNames', 'vocalColors', 'chordsTrackSelected',
  )
  const audible = audibleTracks(useFields(...AUDIBLE_FIELDS))
  // The tracks added so far, plus the one a recording is adding.
  // An empty section shows only its chords track and the + to start it; its other tracks come back with its chords.
  const empty = totalBeats === 0
  const laneCount = empty ? 0 : Math.max(vocalTracks, recording === 'off' ? 0 : armedLane + 1)
  // With chords but no vocal tracks, a row invites you to add one.
  // Under the last vocal track, a row to add another, while there's room for one.
  // Not in an empty section, though: tracks go under chords, so they come once there are some.
  const vocalHint = laneCount < LANES && recording === 'off' && !empty
  // And under that, one to add the drum track, until there is one.
  const hasDrumTrack = useStore((s) => s.drumTrack)
  const drumTrack = hasDrumTrack && !empty
  const drumHint = !hasDrumTrack && recording === 'off' && !empty
  // On a phone, a row the size of a track under the vocal tracks opens the menu to add one (the lyrics are in it too);
  // beside a column of names, the menu is the + at its top instead.
  const addRow = narrow && recording === 'off' && !empty
  const rows = laneCount + (addRow ? 1 : 0)
  const recordStart = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  // A click in the timeline's open space moves the playhead there, to the nearest beat, as the bar numbers do.
  const seekAt = (clientX: number | null) => {
    const el = timelineRef.current
    if (clientX === null || !el || !totalBeats || recording !== 'off') return
    const x = clientX - el.getBoundingClientRect().left
    void seek(Math.min(totalBeats, Math.max(0, Math.round(x / beatPx))))
  }
  const [activeId, setActiveId] = useState<string | null>(null)
  // The + slot moves whenever the progression's length changes. When it slides
  // under a still pointer it shouldn't light up as if picked, so its hover
  // waits until the pointer moves over it at its new place.
  const slotRef = useRef<HTMLButtonElement>(null)
  const [adding, setAdding] = useState(false)
  const closeAdding = useCallback(() => setAdding(false), [])
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
      const raw = engine.position()
      const st = useStore.getState()
      // While the whole song plays, this section's playhead waits until the song comes round to it.
      const pos = raw === null ? null : st.playingView === 'song' ? sectionBeatOf(st, raw) : raw
      if (playheadRef.current) playheadRef.current.style.visibility = raw !== null && pos === null ? 'hidden' : ''
      if (raw !== null && pos === null) setActiveId(null)
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
    <div
      className={`timeline-wrap ${rows ? 'has-vocals' : ''} ${addRow && laneCount ? 'has-adds' : ''}`}
      style={{
        ['--lanes' as string]: rows,
        ['--drum-rows' as string]: drumTrack ? 1 : 0,
        ['--adds-row' as string]: laneCount,
        // The add buttons sit a gap under whichever divider is above them: the one over them, or (with no vocal tracks) the one over the vocals.
        ['--adds-shift' as string]: laneCount ? 'calc(var(--gap) / 2)' : '2px',
      }}
    >
      {/* Faint lines between tracks, across the names and the timeline: chords from drums, and each vocal from the next. */}
      {!empty && drumTrack && <div className="track-line is-drums" aria-hidden="true" />}
      {!empty && Array.from({ length: Math.max(0, laneCount - 1) }, (_, i) => <div key={i} className="track-line" style={{ ['--row' as string]: i + 1 }} aria-hidden="true" />)}
      {/* An empty section has no tracks yet, nor the switch over them; its settings are in the gear on the tabs. */}
      {!empty && <TrackHeaders laneCount={laneCount} vocalHint={vocalHint} drumTrack={drumTrack} drumHint={drumHint} addRow={addRow} />}
      <div className="timeline-scroll" ref={scrollRef}>
        <div
          ref={timelineRef}
          className={`timeline ${chords.length ? '' : 'is-empty'} ${audible.chords ? '' : 'chords-silent'} ${chordsTrackSelected ? 'chords-selected' : ''}`}
          style={{
            width,
            ['--beat' as string]: `${beatPx}px`,
            ['--bar' as string]: `${barPx}px`,
          }}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return
            select(null)
            seekAt(e.clientX)
          }}
        >
          {/*
            The beats as notches along the foot of the bar numbers; where the bar
            divides (halfway, or between its groups of three) the notch is longer.
            A bar's own notch shows only on a phone, where there are no bar lines
            down through the tracks to mark it.
          */}
          {!empty && (
            <div className="ruler-notches" aria-hidden="true">
              {Array.from({ length: Math.floor(width / beatPx) }, (_, b) => (
                <i key={b} className={b % num === 0 ? 'is-bar' : divides(b % num) ? 'is-mid' : undefined} style={{ left: b * beatPx }} />
              ))}
            </div>
          )}
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

          {/* An empty section is only its ways to start: no ruler, track or + until it has a chord. */}
          {empty && recording === 'off' && <SectionStarter />}

          {chords.map((c) => {
            const isDragged = c.id === drag?.id
            return (
              <ChordBlock
                key={c.id}
                chord={c}
                left={lefts.get(c.id) ?? 0}
                beatPx={beatPx}
                name={chordOf(key, mode, c).name}
                roman={chordOf(key, mode, c).roman}
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
                onOpen={() => {
                  select(c.id)
                  showInspector()
                }}
              />
            )
          })}

          {!empty && (
            <button
              type="button"
              ref={slotRef}
              className={`add-slot ${slotMoved ? 'is-moved' : ''} ${adding ? 'is-open' : ''}`}
              style={{ left: totalBeats * beatPx, width: barPx - 6 }}
              onPointerMove={() => slotMoved && setSlotMoved(false)}
              onPointerDown={(e) => {
                // A click shouldn't leave focus here, or the keys that follow
                // (⌫ especially) draw a focus ring that looks like a selected chord.
                e.preventDefault()
                // Keep the menu's outside-click from closing it before this toggles it.
                e.stopPropagation()
              }}
              onClick={() => setAdding(!adding)}
              aria-label="Add a chord"
              aria-expanded={adding}
              title="Add a chord"
            >
              +
            </button>
          )}
          {adding && !empty && <AddChordMenu anchor={slotRef} onClose={closeAdding} />}

          {drumTrack && <DrumLane beatPx={beatPx} beats={totalBeats} muted={!audible.drums} />}

          {Array.from({ length: laneCount }, (_, lane) => (
            <VocalLane
              key={lane}
              lane={lane}
              color={vocalColor(vocalColors, lane)}
              name={vocalTrackName({ vocalNames }, lane)}
              take={takes[lane]}
              takeCount={allTakes[lane]?.length ?? 0}
              takeNumber={(allTakes[lane]?.findIndex((t) => t.id === takes[lane]?.id) ?? -1) + 1}
              trim={takes[lane] ? trims[takes[lane]!.id] : undefined}
              muted={!audible.vocals[lane]}
              locked={recording !== 'off'}
              selected={lane === selectedVocal}
              onSelect={(clientX) => {
                selectVocal(lane)
                seekAt(clientX)
              }}
              bpm={bpm}
              beatPx={beatPx}
              beatsPerQuarter={den / 4}
            />
          ))}
          {recording === 'on' && (
            <div className="vocal-recording" ref={recordingRef} style={{ ['--row' as string]: armedLane, ['--track' as string]: vocalColor(vocalColors, armedLane) }} aria-hidden="true" />
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
  /** A double-click: its settings, bringing the settings panel back if it's hidden. */
  onOpen: () => void
}

function ChordBlock({ chord, left, beatPx, name, roman, selected, active, dragging, onPress, onSelect, onResize, onOpen }: BlockProps) {
  const drag = useRef<{ x: number; beats: number } | null>(null)

  return (
    <div
      className={`chord ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''} ${dragging ? 'is-dragging' : ''}`}
      style={{ left, width: chord.beats * beatPx - 6 }}
    >
      <button type="button" className="chord-body" onClick={onSelect} onDoubleClick={onOpen} aria-pressed={selected} title="Click to select · double-click for its settings · drag to move" onPointerDown={onPress}>
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
  /** How many takes the track has, and which of them plays (from 1), to label it once there's more than one. */
  takeCount: number
  takeNumber: number
  /** How its take is trimmed, if it is. */
  trim: Trim | undefined
  muted: boolean
  /** True while recording, when the selection can't change. */
  locked: boolean
  /** Its take is selected, for deleting or recording over. */
  selected: boolean
  /** Selects the track; with where it was clicked, to move the playhead there too. */
  onSelect: (clientX: number | null) => void
  bpm: number
  beatPx: number
  /** Beats per quarter note: 1 in x/4, 2 in x/8. */
  beatsPerQuarter: number
  /** The track's colour, as Logic gives each track its own. */
  color: string
}

/**
 * One vocal track: click it to select it (to record into, or delete); its take
 * is drawn at the beat it starts on. Selected, its ends can be dragged in to
 * trim it, the part cut off showing faintly, to drag back out. Any take can
 * be dragged along to another beat with a mouse; on a touch screen, once it's
 * selected, so a swipe across the others still scrolls.
 */
function VocalLane({ lane, name, take, takeCount, takeNumber, trim, muted, selected, locked, onSelect, bpm, beatPx, beatsPerQuarter, color }: VocalLaneProps) {
  const row = { ['--row' as string]: lane, ['--track' as string]: color }
  // The trim while an end is dragged, saved only when it's let go.
  const [dragging, setDragging] = useState<Trim | null>(null)
  const drag = useRef<{ edge: 'start' | 'end'; x: number; from: Trim; moved: boolean } | null>(null)
  // The beats it's moved by while it's dragged along, saved only when it's let go.
  const [moving, setMoving] = useState<number | null>(null)
  const carrying = useRef<{ x: number; from: number; min: number; moved: boolean } | null>(null)
  // A press the drag dealt with, so the click that follows it doesn't select again.
  const pressed = useRef(false)
  const pxPerSecond = (bpm / 60) * beatsPerQuarter * beatPx
  const fullWidth = take ? take.seconds * pxPerSecond - 6 : 0
  // The whole take's waveform, one bar every 4px, each as tall as the loudest moment it covers;
  // worked out once for the take and width, not on every render (a trim drag re-renders each move).
  const count = Math.max(1, Math.floor((fullWidth - 4) / 4))
  const peaks = take?.peaks
  const bars = useMemo(
    () => (peaks ? waveHeights(peaks, count).map((h, i) => <span key={i} style={{ height: `${Math.max(6, h * 80)}%` }} />) : null),
    [peaks, count],
  )
  let content = null
  if (take) {
    const kept = dragging ?? trimOf(take, trim)
    const cut = dragging ? kept.start > 0.001 || kept.end < take.seconds - 0.001 : cuts(take, trim)
    // Moved by the beats it's been dragged and by its nudge, if it has them, as it plays.
    const fullLeft = (take.startBeat + (moving ?? trim?.moved ?? 0)) * beatPx + (trim?.nudge ?? 0) * pxPerSecond
    const left = fullLeft + kept.start * pxPerSecond
    const width = (kept.end - kept.start) * pxPerSecond - 6
    // A trimmed take shows the part of it that plays, shifted by what's cut, so its bars stay put while an end is dragged.
    const wave = (shift: number) => (
      <div className="vocal-take-wave" style={{ left: -shift, width: fullWidth }}>
        {bars}
      </div>
    )

    const grab = (edge: 'start' | 'end') => ({
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { edge, x: e.clientX, from: kept, moved: false }
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        if (Math.abs(dx) > 2) d.moved = true
        if (!d.moved) return
        const by = dx / pxPerSecond
        setDragging(
          d.edge === 'start'
            ? { start: Math.max(0, Math.min(d.from.start + by, d.from.end - MIN_TRIM)), end: d.from.end }
            : { start: d.from.start, end: Math.min(take.seconds, Math.max(d.from.end + by, d.from.start + MIN_TRIM)) },
        )
      },
      onPointerUp: () => {
        const d = drag.current
        drag.current = null
        if (d?.moved && dragging) {
          const whole = dragging.start < 0.001 && dragging.end > take.seconds - 0.001
          trimTake(take.id, whole ? null : dragging)
        }
        setDragging(null)
      },
      onPointerCancel: () => {
        drag.current = null
        setDragging(null)
      },
      // A click on a handle mustn't reach the row and move the playhead.
      onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    })

    // A take dragged along: by whole beats, or freely with ⌥ held; earlier than the section's start, too, where what's before it doesn't play.
    const movable = !locked
    const carry = {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        pressed.current = false
        // A touch on a take that isn't selected may be a swipe to scroll; a tap selects it (onClick).
        if (e.button !== 0 || (e.pointerType === 'touch' && !selected)) return
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        pressed.current = true
        // Picked up, it's selected, as a click would; the playhead moves only on a click.
        if (!selected) onSelect(null)
        const from = trim?.moved ?? 0
        // Past the section's start, to bring a late take forward, as long as a little of it stays in.
        const min = earliestMove(take, trim, beatPx / pxPerSecond)
        carrying.current = { x: e.clientX, from, min, moved: false }
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const c = carrying.current
        if (!c) return
        const dx = e.clientX - c.x
        if (Math.abs(dx) > 3) c.moved = true
        if (!c.moved) return
        const by = dx / beatPx
        setMoving(Math.max(c.min, c.from + (e.altKey ? by : Math.round(by))))
      },
      onPointerUp: (e: PointerEvent<HTMLElement>) => {
        const c = carrying.current
        carrying.current = null
        if (c?.moved) {
          if (moving !== null && Math.abs(moving - c.from) > 0.0005) moveTake(take.id, moving)
        } else if (c) {
          // A click, as on the track: the playhead goes there.
          onSelect(e.clientX)
        }
        setMoving(null)
      },
      onPointerCancel: () => {
        carrying.current = null
        setMoving(null)
      },
      onClick: (e: { clientX: number; detail: number }) => {
        if (pressed.current) return
        onSelect(e.detail ? e.clientX : null)
      },
      onDoubleClick: showInspector,
    }

    content = (
      <>
        {selected && cut && (
          <div className="vocal-take is-cut" style={{ ...row, left: fullLeft, width: fullWidth }} aria-hidden="true">
            {wave(0)}
          </div>
        )}
        <div
          className={`vocal-take ${muted ? 'is-muted' : ''} ${selected ? 'is-selected' : ''} ${movable ? 'is-movable' : ''} ${moving !== null ? 'is-moving' : ''}`}
          style={{ ...row, left, width }}
          title={movable ? `${name}: drag to move it (hold ⌥ to move it off the beat)` : undefined}
          {...(movable ? carry : {})}
          role="img"
          aria-label={`${name} waveform${takeCount > 1 ? `, take ${takeNumber} of ${takeCount}` : ''}${cut ? ', trimmed' : ''}`}
        >
          {wave(kept.start * pxPerSecond)}
          {takeCount > 1 && <b className="vocal-take-label">{`Take ${takeNumber} of ${takeCount}`}</b>}
        </div>
        {selected && !locked && (
          <>
            <span className="vocal-trim is-start" style={{ ...row, left: left + 3 }} title="Drag to trim the start" {...grab('start')} />
            <span className="vocal-trim is-end" style={{ ...row, left: left + 3 + width }} title="Drag to trim the end" {...grab('end')} />
          </>
        )}
      </>
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
        // A click (not a key press, which has no place) also moves the playhead to where it was.
        onClick={(e) => onSelect(e.detail ? e.clientX : null)}
        onDoubleClick={showInspector}
      >
        {/* On a phone, an empty track says what it's for, and once selected, where to record from. */}
        {!take && (
          <span className="vocal-row-empty" aria-hidden="true">
            {selected ? 'Ready: tap Record below' : 'Empty: tap to record here'}
          </span>
        )}
      </button>
      {content}
    </>
  )
}

/**
 * The section's drums: its groove drawn hit by hit under the chords, as long
 * as they are. Click it to pick another groove, or none.
 */
function DrumLane({ beatPx, beats, muted }: { beatPx: number; beats: number; muted: boolean }) {
  const groove = useStore((s) => s.drums)
  const fill = useStore((s) => s.drumFill)
  const intensity = useStore((s) => s.drumIntensity)
  const timeSig = useStore((s) => s.timeSig)
  const locked = useStore((s) => s.recording !== 'off')
  const selected = useStore((s) => s.drumsTrackSelected)
  const selectDrumsTrack = useStore((s) => s.selectDrumsTrack)
  const hits = grooveHits(groove, timeSig, 0, beats, fill, { intensity, crashAtStart: fill !== 'none' })
  return (
    // Clicking the drums selects the track, as clicking a chord selects it; its groove is chosen in the track's settings.
    <button
      type="button"
      aria-label={groove ? `Drums: ${grooveLabel(groove)}. Select to change the groove` : 'No drums here. Select to add a groove'}
      title={groove ? `${grooveLabel(groove)} · click for its settings` : 'Click to give this section a groove'}
      className={`drum-region ${groove ? '' : 'is-empty'} ${muted ? 'is-muted' : ''} ${selected ? 'is-selected' : ''}`}
      style={{ width: beats * beatPx - 6 }}
      disabled={locked}
      onClick={selectDrumsTrack}
      onDoubleClick={showInspector}
    >
      {groove ? (
        <>
          <span className="drum-label">{grooveLabel(groove)}</span>
          {hits.map((h, i) => (
            <span key={i} className={`drum-hit is-${h.piece}`} style={{ left: h.beat * beatPx, opacity: 0.45 + h.velocity * 0.55 }} />
          ))}
        </>
      ) : (
        <span className="drum-label">+ Groove</span>
      )}
    </button>
  )
}

/** Brings back every muted or soloed-out track; only there while something is. */
function UnmuteAllButton() {
  const any = useStore((s) => s.chordsMuted || s.chordsSolo || s.drumsMuted || s.drumsSolo || s.vocalMuted.some(Boolean) || s.vocalSolo.some(Boolean))
  const unmuteAll = useStore((s) => s.unmuteAll)
  if (!any) return null
  return (
    <button type="button" className="unmute-all" aria-label="Unmute all tracks" title="Unmute all and clear solos" onClick={unmuteAll}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
      </svg>
      <span className="unmute-all-label">Unmute all</span>
    </button>
  )
}

/** `peaks` gathered into `count` bars, each the loudest of the peaks it covers. */
function waveHeights(peaks: number[], count: number) {
  const per = peaks.length / count
  return Array.from({ length: count }, (_, i) => {
    let max = 0
    for (let j = Math.floor(i * per), end = Math.ceil((i + 1) * per); j < end && j < peaks.length; j++) max = Math.max(max, peaks[j])
    return max
  })
}

/** A phone's zoom, fixed: about four bars of 4/4 across its width. */
const NARROW_ZOOM = 0.45

/** Track names with mute and solo, beside each track's row; what's selected has its settings in the inspector beside them. */
function TrackHeaders({ laneCount, vocalHint, drumTrack, drumHint, addRow }: { laneCount: number; vocalHint: boolean; drumTrack: boolean; drumHint: boolean; addRow: boolean }) {
  const s = useFields('addDrumTrack', 'addVocalTrack', 'chords', 'chordsColor', 'chordsMuted', 'chordsName', 'chordsSolo', 'chordsTrackSelected', 'chordsVolume', 'drumsColor', 'drumsMuted', 'drumsName', 'drumsSolo', 'drumsTrackSelected', 'drumsVolume', 'recording', 'renameChords', 'renameDrums', 'renameVocal', 'selectChordsTrack', 'selectDrumsTrack', 'selectVocal', 'selectedVocal', 'setChordsColor', 'setChordsVolume', 'setDrumsColor', 'setDrumsVolume', 'setVocalColor', 'setVocalVolume', 'toggleChordsMute', 'toggleChordsSolo', 'toggleDrumsMute', 'toggleDrumsSolo', 'toggleVocalMute', 'toggleVocalSolo', 'vocalColors', 'vocalMuted', 'vocalNames', 'vocalSolo', 'vocalVolume')
  // With the settings panel hidden, its button waits here, where the panel would be.
  const narrow = useNarrow()
  const shown = useInspector((i) => i.shown)
  const settingsHidden = !narrow && !shown
  return (
    <div className="track-headers">
      <div className="timeline-corner">
        {settingsHidden && <InspectorButton />}
        {/* What the column is, level with the inspector's title beside it. */}
        <span className="column-title">Tracks</span>
        <UnmuteAllButton />
        {!narrow && <AddTrackButton canVocal={vocalHint} canDrums={drumHint} />}
      </div>
      {/* An empty section has no chords track to show yet. */}
      {s.chords.length > 0 && (
        <TrackHeader
          className={`is-chords ${s.chordsTrackSelected ? 'is-selected' : ''}`}
          icon={<KeysIcon />}
          color={s.chordsColor ?? DEFAULT_CHORDS_COLOR}
          onColor={s.setChordsColor}
          name={chordsTrackName(s)}
          muted={s.chordsMuted}
          solo={s.chordsSolo}
          onMute={s.toggleChordsMute}
          onSolo={s.toggleChordsSolo}
          onRename={s.renameChords}
          volume={s.chordsVolume}
          onVolume={s.setChordsVolume}
          onSelect={s.recording === 'off' ? s.selectChordsTrack : undefined}
        />
      )}
      {drumTrack && (
        <TrackHeader
          className={`is-drums ${s.drumsTrackSelected ? 'is-selected' : ''}`}
          icon={<DrumIcon />}
          color={s.drumsColor ?? DEFAULT_DRUMS_COLOR}
          onColor={s.setDrumsColor}
          name={drumsTrackName(s)}
          muted={s.drumsMuted}
          solo={s.drumsSolo}
          onMute={s.toggleDrumsMute}
          onSolo={s.toggleDrumsSolo}
          onRename={s.renameDrums}
          volume={s.drumsVolume}
          onVolume={s.setDrumsVolume}
          onSelect={s.recording === 'off' ? s.selectDrumsTrack : undefined}
        />
      )}
      {Array.from({ length: laneCount }, (_, lane) => (
        <TrackHeader
          key={lane}
          className={`is-vocal ${s.selectedVocal === lane ? 'is-selected' : ''}`}
          icon={<MicIcon />}
          color={vocalColorId(s.vocalColors, lane)}
          onColor={(c) => s.setVocalColor(lane, c)}
          style={{ ['--row' as string]: lane, ['--track' as string]: vocalColor(s.vocalColors, lane) }}
          name={vocalTrackName(s, lane)}
          muted={s.vocalMuted[lane]}
          solo={s.vocalSolo[lane]}
          onMute={() => s.toggleVocalMute(lane)}
          onSolo={() => s.toggleVocalSolo(lane)}
          onRename={(name) => s.renameVocal(lane, name)}
          volume={s.vocalVolume[lane] ?? 0}
          onVolume={(db) => s.setVocalVolume(lane, db)}
          onSelect={s.recording === 'off' ? () => s.selectVocal(lane) : undefined}
        />
      ))}
      {addRow && <AddTrackButton canVocal={vocalHint} canDrums={drumHint} slot={laneCount} />}
    </div>
  )
}

/**
 * Beside a column of names, the + at its top; on a phone, a row under the
 * tracks (in `slot`, the row it takes): a menu to add a vocal track
 * (selected, ready to record into) or the drum track. It says what's allowed:
 * as many vocal tracks as there's room for, but one drum track and one chords
 * track, the chords one always there. Under them, the lyrics, so they're
 * found where the song's other parts are added.
 */
function AddTrackButton({ canVocal, canDrums, slot }: { canVocal: boolean; canDrums: boolean; slot?: number }) {
  const { addVocalTrack, addDrumTrack, drumTrack, recording, activeSection } = useFields('addVocalTrack', 'addDrumTrack', 'drumTrack', 'recording', 'activeSection')
  const lyricsOpen = useLyricsPanel((l) => l.open)
  const item = (icon: ReactNode, title: string, about: string, disabled: boolean, act: () => void, close: () => void) => (
    <button
      type="button"
      className="menu-item has-icon"
      disabled={disabled}
      onClick={() => {
        act()
        close()
      }}
    >
      <span className="menu-item-icon">{icon}</span>
      <span className="menu-item-title">{title}</span>
      <span className="menu-item-about">{about}</span>
    </button>
  )
  return (
    <MenuButton
      label="Add a track"
      title="Add a vocal track, the drum track or chords"
      className={slot === undefined ? 'icon-btn track-add-btn' : 'track-add'}
      style={slot === undefined ? undefined : { ['--row' as string]: slot }}
      align="right"
      menu={(close) => (
      <>
        {item(
          <MicIcon />,
          'Vocal track',
          canVocal ? `Add as many as you like, up to ${LANES}` : recording !== 'off' ? 'Not while recording' : `${LANES} is the most a section can have`,
          !canVocal,
          addVocalTrack,
          close,
        )}
        {item(<DrumIcon />, 'Drum track', drumTrack ? 'Already added: there’s one per song' : 'One per song, with a groove for each section', !canDrums, addDrumTrack, close)}
        {item(<KeysIcon />, 'Chords track', 'Already added: there’s one per song', true, () => undefined, close)}
        <div className="menu-divider" role="separator" />
        {item(
          <LyricsIcon />,
          'Lyrics',
          lyricsOpen ? 'Showing beside the tracks: write this section’s words' : 'Write the words, section by section, beside the tracks',
          false,
          () => {
            setLyricsOpen(true)
            // Once it's there, straight into this section's words.
            requestAnimationFrame(() => document.getElementById(`lyrics-${activeSection}`)?.focus())
          },
          close,
        )}
      </>
    )}>
      <PlusIcon />
      {slot !== undefined && <span className="track-add-label">Track</span>}
    </MenuButton>
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
  /** The track's level in dB from its usual one, and setting it. */
  volume: number
  /** The track's colour, and choosing another from the palette. */
  color: ColorId
  onColor: (color: ColorId) => void
  onVolume: (db: number) => void
  /** Clicking the header (other than mute and solo) selects the track. */
  onSelect?: () => void
}

export const MIN_DB = -30
export const MAX_DB = 6
export const dbLabel = (db: number) => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`

function TrackHeader({ name, icon, className, style, muted, solo, onMute, onSolo, onRename, volume, onVolume, color, onColor, onSelect }: TrackHeaderProps) {
  const [editing, setEditing] = useState(false)
  // A double tap or double click; timed by hand, since phones don't reliably send dblclick.
  const lastTap = useRef(0)
  return (
    <div
      className={`track-header ${className} ${onSelect ? 'is-selectable' : ''}`}
      style={style}
      role="group"
      aria-label={name}
      onClick={(e) => {
        // Clicks from the colour menu reach here too (it's rendered elsewhere on the page, but within this in React); they don't select.
        if (!e.currentTarget.contains(e.target as Node)) return
        if (!(e.target as HTMLElement).closest('.track-btn, .track-color, input')) onSelect?.()
      }}
      onDoubleClick={(e) => {
        // A double-click on the name renames it instead.
        if (onSelect && e.currentTarget.contains(e.target as Node) && !(e.target as HTMLElement).closest('.track-btn, .track-color, .track-name, input')) showInspector()
      }}
    >
      <span className="track-title">
        {/* The track's icon, in its colour: click it to pick another colour. */}
        <MenuButton
          label={`${name} colour`}
          title="Change the track's colour"
          className="track-color"
          menu={(close) => (
            <>
              <p className="menu-label">{name} colour</p>
              <div className="swatches">
                {PALETTE.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="swatch"
                    style={{ ['--swatch' as string]: c.hex }}
                    aria-pressed={c.id === color}
                    aria-label={c.label}
                    title={c.label}
                    onClick={() => {
                      onColor(c.id)
                      close()
                    }}
                  />
                ))}
              </div>
            </>
          )}
        >
          {icon}
        </MenuButton>
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
      {/* Its level, like a fader laid on its side; double-click puts it back to the usual level. */}
      <input
        type="range"
        className="track-volume"
        min={MIN_DB}
        max={MAX_DB}
        step={0.5}
        value={volume}
        style={{ ['--fill' as string]: `${((volume - MIN_DB) / (MAX_DB - MIN_DB)) * 100}%` }}
        aria-label={`${name} volume`}
        aria-valuetext={dbLabel(volume)}
        title={`Volume ${dbLabel(volume)} · double-click for 0 dB`}
        onChange={(e) => onVolume(Number(e.target.value))}
        onDoubleClick={() => onVolume(0)}
      />
    </div>
  )
}

const trackIcon = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
  className: 'track-icon',
} as const

export const KeysIcon = () => (
  <svg {...trackIcon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M9 13v6M15 13v6" />
    <rect x="7.5" y="5" width="3" height="8" fill="currentColor" stroke="none" />
    <rect x="13.5" y="5" width="3" height="8" fill="currentColor" stroke="none" />
  </svg>
)

export const DrumIcon = () => (
  <svg {...trackIcon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="9" rx="8" ry="3" />
    <path d="M4 9v7c0 1.7 3.6 3 8 3s8-1.3 8-3V9M14 4l5-2M10 4 5 2" />
  </svg>
)

const PlusIcon = () => (
  <svg {...trackIcon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

/** A sheet of lines, for the lyrics. */
const LyricsIcon = () => (
  <svg {...trackIcon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3h9l4 4v14H6zM9 10h7M9 14h7M9 18h4" />
  </svg>
)

export const MicIcon = () => (
  <svg {...trackIcon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
  </svg>
)
