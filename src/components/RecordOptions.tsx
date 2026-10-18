import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { checkLatency } from '../audio/engine'
import { listMics } from '../audio/recorder'
import { setRecordPrefs, useRecordPrefs } from '../recordPrefs'
import { MenuButton } from './Sections'
import { Icon } from './Toolbar'

/**
 * How this device records: which microphone, how long the count-in, whether
 * you hear yourself, and the timing that lines takes up with the beat. From
 * the arrow by the record button, and in a vocal track's settings.
 */
export function RecordOptions() {
  const prefs = useRecordPrefs()
  const latency = useStore((s) => s.latency)
  const recording = useStore((s) => s.recording !== 'off')
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])

  // The microphones there are, kept up to date as they're plugged in and out.
  useEffect(() => {
    const refresh = () => void listMics().then(setMics, () => setMics([]))
    refresh()
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh)
  }, [])
  // Named only once the microphone's been allowed; until then, the browser's own is all there is to say.
  const named = mics.filter((m) => m.label && m.deviceId !== 'default' && m.deviceId !== 'communications')

  return (
    <div className="record-options">
      <label className="inspector-field">
        <span>Microphone</span>
        <select value={prefs.micId ?? ''} disabled={recording} onChange={(e) => setRecordPrefs({ micId: e.target.value || null })}>
          <option value="">The browser’s default</option>
          {named.map((m) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label}
            </option>
          ))}
        </select>
        {!named.length && <small className="record-options-note">Others show here once Bounce may use the microphone.</small>}
      </label>

      <div className="inspector-field">
        <span>Count-in</span>
        <div className="chord-pad-seg" role="group" aria-label="Count-in">
          {([0, 1, 2] as const).map((bars) => (
            <button type="button" key={bars} aria-pressed={prefs.countIn === bars} disabled={recording} onClick={() => setRecordPrefs({ countIn: bars })}>
              {bars === 0 ? 'Off' : `${bars} ${bars === 1 ? 'bar' : 'bars'}`}
            </button>
          ))}
        </div>
        {/* The count-in's clicks are how a take's timing is measured, singing to speakers. */}
        <small className="record-options-note">{prefs.countIn === 0 ? 'Starts at once, lined up by the last timing check' : 'Clicks the tempo in before the take'}</small>
      </div>

      <label className="record-options-switch">
        <input type="checkbox" checked={prefs.monitor} onChange={(e) => setRecordPrefs({ monitor: e.target.checked })} />
        <span>
          Hear yourself while recording
          <small className="record-options-note">On headphones: through speakers it feeds back. Browsers add a little delay.</small>
        </span>
      </label>

      {/* How late this device's recordings arrive, measured so takes line up with the beat. */}
      <button type="button" className="track-sheet-link" disabled={recording} onClick={() => void checkLatency()} title="Play a few clicks and listen for them, so takes line up with the beat on this device">
        {latency === null ? 'Check recording timing' : `Recording timing ${Math.round(latency * 1000)} ms · check again`}
      </button>
    </div>
  )
}

/** The arrow by the record button, opening the recording options. */
export function RecordOptionsButton() {
  return (
    <MenuButton label="Recording options" title="Recording options: microphone, count-in, hearing yourself" className="record-options-btn" role="dialog" panelClassName="record-options-menu" menu={() => <RecordOptions />}>
      <Icon d="M6 9l6 6 6-6" />
    </MenuButton>
  )
}
