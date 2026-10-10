import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore, vocalTrackName } from '../store'
import { deleteTake, toggleRecord } from '../audio/engine'
import { PALETTE, vocalColor, vocalColorId } from '../colors'
import { dbLabel, MAX_DB, MIN_DB } from './Timeline'

/**
 * On a phone, the sheet along the bottom with a vocal track selected, in
 * place of the chord pad: its name and colour (the palette behind the dot),
 * what's on it, mute, solo, level and reverb, and buttons to record into it
 * or delete it. Done (or selecting anything else) brings the chord pad back.
 */
export function VocalPad({ lane }: { lane: number }) {
  const s = useStore()
  const name = vocalTrackName(s, lane)
  const take = s.takes[lane]
  const volume = s.vocalVolume[lane] ?? 0
  const reverb = s.vocalReverb[lane] ?? 0
  const [picking, setPicking] = useState(false)
  const color = vocalColorId(s.vocalColors, lane)
  const [text, setText] = useState(name)
  useEffect(() => setText(name), [name])
  const ref = useRef<HTMLDivElement>(null)

  // Leave room under the page for the sheet, as the chord pad does.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const observer = new ResizeObserver(() => root.style.setProperty('--chord-pad-h', `${el.offsetHeight}px`))
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--chord-pad-h')
    }
  }, [])

  const perBar = s.timeSig[0]
  const about = take
    ? `${Math.round(take.seconds)} s take, from bar ${Math.floor(take.startBeat / perBar) + 1}`
    : 'Nothing recorded yet'

  return (
    <div className="chord-pad vocal-pad" ref={ref} role="region" aria-label={`${name} settings`} style={{ ['--track' as string]: vocalColor(s.vocalColors, lane) }}>
      <div className="vocal-pad-head">
        <button
          type="button"
          className="vocal-pad-dot"
          aria-label="Colour"
          aria-expanded={picking}
          title="Change the track's colour"
          onClick={() => setPicking(!picking)}
        />
        <input
          className="vocal-pad-name"
          aria-label="Track name"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text.trim() !== name && s.renameVocal(lane, text.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setText(name)
              e.currentTarget.blur()
            }
          }}
        />
        <button type="button" className="chord-pad-chip" onClick={() => s.selectVocal(null)} title="Back to the chord pad">
          Done
        </button>
      </div>
      {picking && (
        <div className="vocal-pad-colors" role="group" aria-label="Colour">
          {PALETTE.map((c) => (
            <button
              key={c.id}
              type="button"
              className="swatch"
              style={{ ['--swatch' as string]: c.hex }}
              aria-label={c.label}
              aria-pressed={c.id === color}
              onClick={() => {
                s.setVocalColor(lane, c.id)
                setPicking(false)
              }}
            />
          ))}
        </div>
      )}

      <div className="vocal-pad-status">
        <p className="vocal-pad-about">{about}</p>
        <div className="chord-pad-seg" role="group" aria-label="Mute and solo">
          <button type="button" aria-pressed={!!s.vocalMuted[lane]} onClick={() => s.toggleVocalMute(lane)}>
            Mute
          </button>
          <button type="button" aria-pressed={!!s.vocalSolo[lane]} onClick={() => s.toggleVocalSolo(lane)}>
            Solo
          </button>
        </div>
      </div>
      <label className="vocal-pad-slider">
        <span>Level</span>
        <input
          type="range"
          min={MIN_DB}
          max={MAX_DB}
          step={0.5}
          value={volume}
          aria-label={`${name} volume`}
          aria-valuetext={dbLabel(volume)}
          onChange={(e) => s.setVocalVolume(lane, Number(e.target.value))}
          onDoubleClick={() => s.setVocalVolume(lane, 0)}
        />
        <output>{dbLabel(volume)}</output>
      </label>
      <label className="vocal-pad-slider">
        <span>Reverb</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={reverb}
          aria-label={`${name} reverb`}
          aria-valuetext={`${Math.round(reverb * 100)}%`}
          onChange={(e) => s.setVocalReverb(lane, Number(e.target.value))}
        />
        <output>{Math.round(reverb * 100)}%</output>
      </label>

      <div className="chord-pad-actions">
        <button type="button" className="chord-pad-replace" onClick={() => void deleteTake(lane)} title="Delete this track and its take; undo brings it back">
          Delete track
        </button>
        <button type="button" className="chord-pad-add vocal-pad-record" disabled={!s.chords.length} onClick={() => void toggleRecord()}>
          <span className="vocal-pad-record-dot" aria-hidden="true" />
          {take ? 'Record again' : 'Record'}
        </button>
      </div>
    </div>
  )
}
