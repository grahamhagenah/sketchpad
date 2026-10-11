import { newChord as chord, songStart, type Chord, type SongStart } from './store'
import { PRESETS, type Sound } from './audio/sound'
import { DEFAULT_ARP, DEFAULT_RHYTHM } from './audio/arrange'

/**
 * A song to start from: chords and a groove you'd know anywhere, named by
 * their style, with the song they bring to mind.
 */
export interface SongTemplate {
  name: string
  think: string
  build: () => SongStart
}

const preset = (name: string, changes: Partial<Sound> = {}): Sound => ({ ...PRESETS.find((p) => p.name === name)!.sound, preset: name, ...changes })
const times = (n: number, chords: () => Chord[]) => Array.from({ length: n }, chords).flat()

export const SONG_TEMPLATES: SongTemplate[] = [
  {
    name: 'Minor synth-pop',
    think: 'Sweet Dreams (Are Made of This)',
    // C minor: Cm for a bar, then A♭ and the major V, G, borrowed from C major; a bouncing saw arpeggio over a drum machine.
    build: () =>
      songStart(
        {
          key: 0,
          mode: 'minor',
          bpm: 126,
          timeSig: [4, 4],
          sound: preset('Synth', { attack: 0.004, decay: 0.22, sustain: 0.25, release: 0.15, brightness: 3800, reverb: 0.2 }),
          arp: { ...DEFAULT_ARP, on: true, pattern: 'up', rate: '1/16', octaves: 2, gate: 0.55, accent: 0.4 },
          rhythm: DEFAULT_RHYTHM,
          chordsVolume: -2,
          drumsVolume: 0,
        },
        [{ name: 'Verse', chords: times(4, () => [chord(0, 4), chord(5, 2), chord(4, 2, { borrowed: true })]), drums: 'four', drumFill: 'four' }],
        [0, 0],
      ),
  },
  {
    name: 'Grunge anthem',
    think: 'Smells Like Teen Spirit',
    // F major: F and B♭, then A♭ and D♭ borrowed from F minor, two beats each, chugged in eighths; quiet verse, loud chorus.
    build: () => {
      const riff = () => times(4, () => [chord(0, 2), chord(3, 2), chord(2, 2, { borrowed: true }), chord(5, 2, { borrowed: true })])
      return songStart(
        {
          key: 5,
          mode: 'major',
          bpm: 117,
          timeSig: [4, 4],
          sound: preset('Synth', { attack: 0.002, decay: 0.2, sustain: 0.6, release: 0.1, brightness: 2400, reverb: 0.1 }),
          arp: DEFAULT_ARP,
          rhythm: { chords: 'pulse', bass: 'held' },
          chordsVolume: 0,
          drumsVolume: 2,
        },
        [
          { name: 'Verse', chords: riff(), drums: 'light', drumFill: 'end' },
          { name: 'Chorus', chords: riff(), drums: 'backbeat', drumFill: 'end' },
        ],
        [0, 1, 0, 1],
      )
    },
  },
  {
    name: 'Desert ballad',
    think: 'Hotel California',
    // B minor, a bar each: Bm F♯ A E G D Em F♯, the F♯ and E major borrowed from B major; the chorus starts on G. Arpeggiated piano.
    build: () =>
      songStart(
        {
          key: 11,
          mode: 'minor',
          bpm: 74,
          timeSig: [4, 4],
          sound: preset('Piano', { reverb: 0.32 }),
          arp: { ...DEFAULT_ARP, on: true, pattern: 'updown', rate: '1/16', octaves: 2, gate: 0.9, accent: 0.2 },
          rhythm: { chords: 'held', bass: 'held' },
          chordsVolume: 0,
          drumsVolume: 0,
        },
        [
          {
            name: 'Verse',
            chords: [chord(0, 4), chord(4, 4, { borrowed: true }), chord(6, 4), chord(3, 4, { borrowed: true }), chord(5, 4), chord(2, 4), chord(3, 4), chord(4, 4, { borrowed: true })],
            drums: 'backbeat',
            drumFill: 'end',
          },
          {
            name: 'Chorus',
            chords: [chord(5, 4), chord(2, 4), chord(4, 4, { borrowed: true }), chord(0, 4), chord(5, 4), chord(2, 4), chord(3, 4), chord(4, 4, { borrowed: true })],
            drums: 'backbeat',
            drumFill: 'end',
          },
        ],
        [0, 1, 0, 1],
      ),
  },
  {
    name: 'Reggaeton pop',
    think: 'Despacito',
    // D major, a bar each: Bm G D A (vi IV I V), plucked in the three-three-two push over a kick on every beat.
    build: () => {
      const loop = () => times(2, () => [chord(5, 4), chord(3, 4), chord(0, 4), chord(4, 4)])
      return songStart(
        {
          key: 2,
          mode: 'major',
          bpm: 89,
          timeSig: [4, 4],
          sound: preset('Pluck', { decay: 0.5, release: 0.3, brightness: 3000, bass: true }),
          arp: DEFAULT_ARP,
          rhythm: { chords: 'tresillo', bass: 'kick' },
          chordsVolume: 0,
          drumsVolume: 0,
        },
        [
          { name: 'Verse', chords: loop(), drums: 'light', drumFill: 'end' },
          { name: 'Chorus', chords: loop(), drums: 'four', drumFill: 'end' },
        ],
        [0, 1, 0, 1],
      )
    },
  },
  {
    name: 'Alt-rock ballad',
    think: 'Creep',
    // G major, a bar each: G, B made major (outside the key), C, and C minor borrowed from G minor. Picked out, then strummed.
    build: () => {
      const loop = () => times(2, () => [chord(0, 4), chord(2, 4, { major: true }), chord(3, 4), chord(3, 4, { borrowed: true })])
      return songStart(
        {
          key: 7,
          mode: 'major',
          bpm: 92,
          timeSig: [4, 4],
          sound: preset('Keys', { decay: 1.2, sustain: 0.35, release: 0.8, reverb: 0.25 }),
          arp: { ...DEFAULT_ARP, on: true, pattern: 'up', rate: '1/8', octaves: 2, gate: 0.85, accent: 0.25 },
          rhythm: { chords: 'held', bass: 'held' },
          chordsVolume: 0,
          drumsVolume: 0,
        },
        [
          { name: 'Verse', chords: loop(), drums: 'light', drumFill: 'end' },
          { name: 'Chorus', chords: loop(), drums: 'backbeat', drumFill: 'end' },
        ],
        [0, 1, 0, 1],
      )
    },
  },
]
