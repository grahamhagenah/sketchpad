import { useState } from 'react'
import { chordsTrackName, drumsTrackName, sectionsNow, useStore, vocalTrackName } from '../store'
import { engine } from '../audio/engine'
import { tally } from '../analytics'
import { download, exportName, placedTakes, songToMidi, songToStems, songToWav, takeToWav } from '../audio/export'
import { LANES } from '../audio/take'
import { playbackOf } from '../song'

/** What exports: the whole song, or the open section while the song has nothing in it. */
function exported(s = useStore.getState()) {
  const song = playbackOf(s, 'song')
  return song.chords.length ? song : playbackOf(s, 'section')
}

/** The song with every track playing, muted or not, for exports a DAW can mute tracks in itself. */
function unmuted(s: ReturnType<typeof useStore.getState>) {
  const quiet = Array(LANES).fill(false)
  return {
    ...s,
    chordsMuted: false,
    chordsSolo: false,
    drumsMuted: false,
    drumsSolo: false,
    vocalMuted: quiet,
    vocalSolo: quiet,
    sections: s.sections.map((sec) => ({ ...sec, vocalMuted: quiet, vocalSolo: quiet })),
  }
}

/** Whether there's anything to export yet: chords in the song, or in the open section. */
export const useCanExport = () => useStore((s) => s.chords.length > 0 || playbackOf(s, 'song').chords.length > 0)

/** The ways to export, as items in the file menu: MIDI, WAV, stems, and each vocal take alone. */
export function ExportItems({ close }: { close: () => void }) {
  const takes = useStore((s) => s.takes)
  const vocalNames = useStore((s) => s.vocalNames)
  const sectionName = useStore((s) => s.sections.find((sec) => sec.id === s.activeSection)?.name ?? 'the section')
  const hasTake = useStore((s) => sectionsNow(s).some((sec) => sec.takes.some(Boolean)))
  const [rendering, setRendering] = useState<'wav' | 'stems' | null>(null)

  const exportMidi = () => {
    const s = useStore.getState()
    // Every chord and drum hit, muted or not: in a DAW each track can be muted there.
    const song = exported(unmuted(s))
    download(songToMidi({ ...song, chords: song.chords.map((c) => ({ ...c, silent: false })) }), `${exportName(s)}.mid`)
    tally('export/midi')
    close()
  }
  const exportWav = async () => {
    const s = useStore.getState()
    setRendering('wav')
    try {
      // The mix is what you hear: muted and un-soloed tracks are left out.
      const song = exported()
      download(await songToWav(song, placedTakes(song, (id) => engine.takeAudio(id))), `${exportName(s)}.wav`)
      tally('export/wav')
      close()
    } finally {
      setRendering(null)
    }
  }
  const exportStems = async () => {
    const s = useStore.getState()
    setRendering('stems')
    try {
      // Every track, muted or not, as with MIDI.
      const song = exported(unmuted(s))
      const takes = placedTakes(song, (id) => engine.takeAudio(id))
      const names = { chords: chordsTrackName(s), drums: drumsTrackName(s), vocal: (track: number) => vocalTrackName(s, track) }
      download(await songToStems(song, takes, names), `${exportName(s)}-stems.zip`)
      tally('export/stems')
      close()
    } finally {
      setRendering(null)
    }
  }
  const exportVocal = (lane: number) => {
    const s = useStore.getState()
    const info = s.takes[lane]
    const take = info && engine.takeAudio(info.id)
    if (!take) return
    const slug = vocalTrackName(s, lane).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `vocal-${lane + 1}`
    download(takeToWav(s, take), `${exportName(s)}-${slug}.wav`)
    tally('export/vocal')
    close()
  }

  // Each indented under Export, as the songs are under Start from a song.
  const item = (key: string, title: string, about: string, act: () => void) => (
    <button key={key} type="button" className="menu-item has-icon" onClick={act} disabled={rendering !== null} aria-live="polite">
      <span className="menu-item-icon" aria-hidden="true" />
      <span className="menu-item-title">{title}</span>
      <span className="menu-item-about">{about}</span>
    </button>
  )
  return (
    <>
      {item('midi', 'MIDI', 'The whole song’s chords, bass and drums on separate tracks, for a DAW', exportMidi)}
      {item('wav', rendering === 'wav' ? 'Rendering…' : 'WAV', `The whole song as 24-bit audio${hasTake ? ', with the vocals' : ''}`, () => void exportWav())}
      {item('stems', rendering === 'stems' ? 'Rendering stems…' : 'Stems', 'Each track as its own WAV, all from bar 1, in a zip for Logic', () => void exportStems())}
      {takes.map((t, lane) => t && item(`vocal-${lane}`, vocalTrackName({ vocalNames }, lane), `This take alone, lined up to the start of ${sectionName}`, () => exportVocal(lane)))}
    </>
  )
}
