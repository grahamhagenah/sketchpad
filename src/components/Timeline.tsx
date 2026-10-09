import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { audibleTracks, chordsTrackName, drumsTrackName, keyOf, useStore, vocalTrackName, type Chord } from '../store'
import { chordOf } from '../music/theory'
import { audition, engine, seek } from '../audio/engine'
import { sectionBeatOf } from '../song'
import { LANES } from '../audio/take'
import { LoopLane } from './LoopLane'
import { AddChordMenu } from './AddChordMenu'
import type { TakeInfo } from '../audio/take'
import { GROOVES, grooveHits, grooveLabel } from '../audio/drums'
import { MenuButton } from './Sections'
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
  const { chords, timeSig, selectedId, playing, loopOn } = useStore()
  // The open section's key: its own, if it has one.
  const { key, mode } = keyOf(useStore())
  const { select, updateChord, reorderChord } = useStore()
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
  const { takes, recording, bpm, armedLane, selectedVocal, selectVocal, vocalTracks, vocalNames, vocalColors, chordsTrackSelected } = useStore()
  const audible = audibleTracks(useStore())
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
  // Both add buttons share one row, under the vocal tracks.
  const addRow = vocalHint || drumHint
  const rows = laneCount + (addRow ? 1 : 0)
  const recordStart = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
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
      style={{ ['--lanes' as string]: rows, ['--drum-rows' as string]: drumTrack ? 1 : 0, ['--adds-row' as string]: laneCount }}
    >
      <TrackHeaders laneCount={laneCount} vocalHint={vocalHint} drumTrack={drumTrack} drumHint={drumHint} />
      <div className="timeline-scroll" ref={scrollRef}>
        <div
          className={`timeline ${chords.length ? '' : 'is-empty'} ${audible.chords ? '' : 'chords-silent'} ${chordsTrackSelected ? 'chords-selected' : ''}`}
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
              <span>Click + to add chords or start from a ready-made progression.</span>
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
              />
            )
          })}

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
          {adding && <AddChordMenu anchor={slotRef} onClose={closeAdding} />}

          {drumTrack && <DrumLane beatPx={beatPx} beats={totalBeats} muted={!audible.drums} />}

          {Array.from({ length: laneCount }, (_, lane) => (
            <VocalLane
              key={lane}
              lane={lane}
              color={vocalColor(vocalColors, lane)}
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
  /** The track's colour, as Logic gives each track its own. */
  color: string
}

/** One vocal track: click it to select it (to record into, or delete); its take is drawn at the beat it starts on. */
function VocalLane({ lane, name, take, muted, selected, locked, onSelect, bpm, beatPx, beatsPerQuarter, color }: VocalLaneProps) {
  const row = { ['--row' as string]: lane, ['--track' as string]: color }
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

/**
 * The section's drums: its groove drawn hit by hit under the chords, as long
 * as they are. Click it to pick another groove, or none.
 */
function DrumLane({ beatPx, beats, muted }: { beatPx: number; beats: number; muted: boolean }) {
  const groove = useStore((s) => s.drums)
  const timeSig = useStore((s) => s.timeSig)
  const setDrums = useStore((s) => s.setDrums)
  const removeDrumTrack = useStore((s) => s.removeDrumTrack)
  const locked = useStore((s) => s.recording !== 'off')
  const selected = useStore((s) => s.drumsTrackSelected)
  const selectDrumsTrack = useStore((s) => s.selectDrumsTrack)
  const hits = grooveHits(groove, timeSig, 0, beats)
  return (
    <MenuButton
      label={groove ? `Drums: ${grooveLabel(groove)}. Change the groove` : 'Add drums'}
      title={groove ? `${grooveLabel(groove)} · click to change` : 'Add a drum groove to this section'}
      className={`drum-region ${groove ? '' : 'is-empty'} ${muted ? 'is-muted' : ''} ${selected ? 'is-selected' : ''}`}
      style={{ width: beats * beatPx - 6 }}
      // Clicking the drums selects the track as well, as clicking a chord selects it.
      onOpen={locked ? undefined : selectDrumsTrack}
      menu={(close) => (
        <>
          {GROOVES.map((g) => (
            <button
              key={g.id}
              type="button"
              className="menu-item"
              role="menuitemradio"
              aria-checked={g.id === groove}
              disabled={locked}
              onClick={() => {
                setDrums(g.id)
                close()
              }}
            >
              <span className="menu-item-title">{g.label}</span>
              <span className="menu-item-about">{g.about}</span>
            </button>
          ))}
          <div className="menu-divider" role="separator" />
          {groove && (
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setDrums(null)
                close()
              }}
            >
              <span className="menu-item-title">No drums here</span>
              <span className="menu-item-about">This section plays without drums</span>
            </button>
          )}
          <button
            type="button"
            className="menu-item is-danger"
            disabled={locked}
            onClick={() => {
              removeDrumTrack()
              close()
            }}
          >
            <span className="menu-item-title">Remove drum track</span>
            <span className="menu-item-about">From the whole song</span>
          </button>
        </>
      )}
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
    </MenuButton>
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
      Unmute all
    </button>
  )
}

/** Track names with mute and solo, beside each track's row. */
function TrackHeaders({ laneCount, vocalHint, drumTrack, drumHint }: { laneCount: number; vocalHint: boolean; drumTrack: boolean; drumHint: boolean }) {
  const s = useStore()
  return (
    <div className="track-headers">
      <div className="timeline-corner">
        <UnmuteAllButton />
      </div>
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
        onSelect={s.recording === 'off' && s.chords.length > 0 ? s.selectChordsTrack : undefined}
      />
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
      {(vocalHint || drumHint) && (
        <div className="track-adds" style={{ ['--row' as string]: laneCount }}>
          {vocalHint && (
            <button type="button" className="track-add" onClick={s.addVocalTrack} aria-label="Add a vocal track" title="Add a vocal track to record into">
              <PlusIcon />
              <span className="track-add-label">Vocal track</span>
            </button>
          )}
          {drumHint && (
            <button type="button" className="track-add" onClick={s.addDrumTrack} aria-label="Add a drum track" title="Add a drum track, with a groove for each section">
              <PlusIcon />
              <span className="track-add-label">Drum track</span>
            </button>
          )}
        </div>
      )}
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
  /** The track's level in dB from its usual one, and setting it. */
  volume: number
  /** The track's colour, and choosing another from the palette. */
  color: ColorId
  onColor: (color: ColorId) => void
  onVolume: (db: number) => void
  /** Clicking the header (other than mute and solo) selects the track. */
  onSelect?: () => void
}

const MIN_DB = -30
const MAX_DB = 6
const dbLabel = (db: number) => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`

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

/** A drum, for the drums. */
const DrumIcon = () => (
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

/** A microphone, for the vocals. */
const MicIcon = () => (
  <svg {...trackIcon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
  </svg>
)
