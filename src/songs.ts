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
          { name: 'Verse', chords: riff(), drums: 'rock', drumFill: 'end', drumIntensity: 'sparse' },
          { name: 'Chorus', chords: riff(), drums: 'rock', drumFill: 'end', drumIntensity: 'busy' },
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
            drums: 'rock',
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
          { name: 'Verse', chords: loop(), drums: 'dembow', drumFill: 'end', drumIntensity: 'sparse' },
          { name: 'Chorus', chords: loop(), drums: 'dembow', drumFill: 'end' },
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
          { name: 'Verse', chords: loop(), drums: 'ballad', drumFill: 'end' },
          { name: 'Chorus', chords: loop(), drums: 'rock', drumFill: 'end' },
        ],
        [0, 1, 0, 1],
      )
    },
  },
  {
    name: 'Bleak piano ballad',
    think: 'Mad World',
    // F minor, a bar each: Fm A♭ E♭ B♭, the B♭ major borrowed from F major; the chorus rocks between Fm and B♭. Piano alone.
    build: () =>
      songStart(
        {
          key: 5,
          mode: 'minor',
          bpm: 88,
          timeSig: [4, 4],
          sound: preset('Piano', { reverb: 0.38 }),
          arp: DEFAULT_ARP,
          rhythm: { chords: 'beats', bass: 'held' },
          chordsVolume: 0,
          drumsVolume: 0,
          drumTrack: false,
        },
        [
          { name: 'Verse', chords: times(2, () => [chord(0, 4), chord(2, 4), chord(6, 4), chord(3, 4, { borrowed: true })]), drums: null },
          { name: 'Chorus', chords: times(4, () => [chord(0, 4), chord(3, 4, { borrowed: true })]), drums: null },
        ],
        [0, 1, 0, 1],
      ),
  },
  {
    name: 'Picked new wave',
    think: 'Every Breath You Take',
    // A♭ major, a bar each: A♭ Fm D♭ E♭ (I vi IV V), picked out in eighths across two octaves.
    build: () =>
      songStart(
        {
          key: 8,
          mode: 'major',
          bpm: 117,
          timeSig: [4, 4],
          sound: preset('Pluck', { decay: 0.6, release: 0.5, brightness: 3400, bass: true }),
          arp: { ...DEFAULT_ARP, on: true, pattern: 'up', rate: '1/8', octaves: 2, gate: 0.8, accent: 0.2 },
          rhythm: { chords: 'held', bass: 'held' },
          chordsVolume: 0,
          drumsVolume: -2,
        },
        [{ name: 'Verse', chords: times(2, () => [chord(0, 4), chord(5, 4), chord(3, 4), chord(4, 4)]), drums: 'backbeat', drumFill: 'end' }],
        [0, 0],
      ),
  },
  {
    name: 'Cascading piano',
    think: 'Clocks',
    // E♭ major, a bar each: E♭ B♭m B♭m Fm, the B♭ minor borrowed from E♭ minor; piano tumbling down each chord, drums joining after the intro.
    build: () => {
      const loop = () => times(2, () => [chord(0, 4), chord(4, 4, { borrowed: true }), chord(4, 4, { borrowed: true }), chord(1, 4)])
      return songStart(
        {
          key: 3,
          mode: 'major',
          bpm: 131,
          timeSig: [4, 4],
          sound: preset('Piano', { reverb: 0.26 }),
          arp: { ...DEFAULT_ARP, on: true, pattern: 'down', rate: '1/8', octaves: 2, gate: 0.9, accent: 0.45 },
          rhythm: { chords: 'held', bass: 'held' },
          chordsVolume: 0,
          drumsVolume: 0,
        },
        [
          { name: 'Intro', chords: loop(), drums: null },
          { name: 'Verse', chords: loop(), drums: 'rock', drumFill: 'end' },
        ],
        [0, 1, 1],
      )
    },
  },
  {
    name: 'Disco sequencer',
    think: 'I Feel Love',
    // Long on one chord, C, a squelchy sixteenth-note arpeggio over four on the floor, then a while on B♭ (borrowed from C minor) and back.
    build: () =>
      songStart(
        {
          key: 0,
          mode: 'major',
          bpm: 128,
          timeSig: [4, 4],
          sound: preset('Synth', { attack: 0.002, decay: 0.15, sustain: 0.1, release: 0.05, brightness: 2800, resonance: 0.5, reverb: 0.15 }),
          arp: { ...DEFAULT_ARP, on: true, pattern: 'up', rate: '1/16', octaves: 2, gate: 0.4, accent: 0.5 },
          rhythm: { chords: 'held', bass: 'kick' },
          chordsVolume: -2,
          drumsVolume: 0,
        },
        [
          { name: 'Groove', chords: [chord(0, 16), chord(0, 16)], drums: 'disco', drumFill: 'none' },
          { name: 'Shift', chords: [chord(6, 16, { borrowed: true })], drums: 'disco', drumFill: 'end' },
        ],
        [0, 1, 0],
      ),
  },
  {
    name: 'Piano singalong',
    think: 'Hey Jude',
    // F major: F C C7 F · B♭ F C7 F, struck on every beat; then the long outro, F E♭ B♭ F, the E♭ borrowed from F minor.
    build: () =>
      songStart(
        {
          key: 5,
          mode: 'major',
          bpm: 74,
          timeSig: [4, 4],
          sound: preset('Piano', { reverb: 0.24 }),
          arp: DEFAULT_ARP,
          rhythm: { chords: 'beats', bass: 'held' },
          chordsVolume: 0,
          drumsVolume: -2,
        },
        [
          {
            name: 'Verse',
            chords: [chord(0, 4), chord(4, 4), chord(4, 4, { seventh: true }), chord(0, 4), chord(3, 4), chord(0, 4), chord(4, 4, { seventh: true }), chord(0, 4)],
            drums: 'ballad',
            drumFill: 'end',
          },
          { name: 'Outro', chords: times(2, () => [chord(0, 4), chord(6, 4, { borrowed: true }), chord(3, 4), chord(0, 4)]), drums: 'rock', drumFill: 'four', drumIntensity: 'busy' },
        ],
        [0, 0, 1, 1],
      ),
  },
  {
    name: 'Swelling anthem',
    think: 'With or Without You',
    // D major, a bar each: D A Bm G (I V vi IV), a slow-swelling pad over a steady bass; the drums open up in the chorus.
    build: () => {
      const loop = () => times(2, () => [chord(0, 4), chord(4, 4), chord(5, 4), chord(3, 4)])
      return songStart(
        {
          key: 2,
          mode: 'major',
          bpm: 110,
          timeSig: [4, 4],
          sound: preset('Pad', { reverb: 0.45 }),
          arp: DEFAULT_ARP,
          rhythm: { chords: 'held', bass: 'held' },
          chordsVolume: 0,
          drumsVolume: -2,
        },
        [
          { name: 'Verse', chords: loop(), drums: 'light', drumFill: 'none' },
          { name: 'Chorus', chords: loop(), drums: 'rock', drumFill: 'end' },
        ],
        [0, 1, 0, 1],
      )
    },
  },
  {
    name: 'Slow power ballad',
    think: 'Purple Rain',
    // B♭ major, a bar each: B♭add9 Gm7 F E♭maj7 (I vi V IV), held strings, slow.
    build: () => {
      const loop = () => times(2, () => [chord(0, 4, { color: 'add9' }), chord(5, 4, { seventh: true }), chord(4, 4), chord(3, 4, { seventh: true })])
      return songStart(
        {
          key: 10,
          mode: 'major',
          bpm: 57,
          timeSig: [4, 4],
          sound: preset('Strings', { reverb: 0.42 }),
          arp: DEFAULT_ARP,
          rhythm: { chords: 'held', bass: 'held' },
          chordsVolume: 0,
          drumsVolume: -2,
        },
        [
          { name: 'Verse', chords: loop(), drums: 'ballad', drumFill: 'none' },
          { name: 'Chorus', chords: loop(), drums: 'backbeat', drumFill: 'end' },
        ],
        [0, 1, 0, 1],
      )
    },
  },
  {
    name: 'Glitch hyperpop',
    think: 'money machine',
    // E major falling by major thirds, Eadd9 C G♯, then a half step to Gsus2 and Bsus4; the chorus jumps a tritone
    // to B♭ (E♭maj7 B♭/D A♭ Gm7 C G♭), a drumless E minor glitch, and the last chorus up a half step again, in B.
    // A wide, squelchy saw scattered at random across three octaves, over trap verses and drum & bass choruses.
    build: () => {
      const verse = () => times(2, () => [chord(0, 4, { color: 'add9' }), chord(5, 4, { borrowed: true }), chord(2, 4, { major: true }), chord(2, 2, { borrowed: true, color: 'sus2' }), chord(4, 2, { color: 'sus4' })])
      const chorus = () => times(2, () => [chord(3, 4, { seventh: true }), chord(0, 2, { bass: 'third' }), chord(6, 2, { borrowed: true }), chord(5, 4, { seventh: true }), chord(1, 2, { major: true }), chord(5, 2, { borrowed: true })])
      return songStart(
        {
          key: 4,
          mode: 'major',
          bpm: 160,
          timeSig: [4, 4],
          sound: preset('Synth', { attack: 0.002, decay: 0.18, sustain: 0.4, release: 0.2, brightness: 5200, width: 0.9, resonance: 0.35, reverb: 0.3 }),
          arp: { ...DEFAULT_ARP, on: true, pattern: 'random', rate: '1/16', octaves: 3, gate: 0.45, accent: 0.6 },
          rhythm: { chords: 'held', bass: 'kick' },
          chordsVolume: -2,
          drumsVolume: 1,
        },
        [
          { name: 'Verse', chords: verse(), drums: 'trap', drumFill: 'end' },
          { name: 'Chorus', chords: chorus(), drums: 'dnb', drumFill: 'four', drumIntensity: 'busy', sectionKey: { key: 10, mode: 'major' } },
          { name: 'Glitch', chords: [chord(0, 4, { color: 'add9' }), chord(5, 4, { seventh: true }), chord(3, 4, { color: 'sus4' }), chord(4, 4, { major: true })], drums: null, sectionKey: { key: 4, mode: 'minor' } },
          { name: 'Last chorus', chords: chorus(), drums: 'dnb', drumFill: 'end', drumIntensity: 'busy', sectionKey: { key: 11, mode: 'major' } },
        ],
        [0, 1, 0, 1, 2, 3],
      )
    },
  },
  {
    name: 'Jazz-pop bossa nova',
    think: 'From the Start',
    // F major, a bar each, all sevenths: Fmaj7 Dm7 Gm7 C7, then Am7 into D7 (the VI played major, leaning on the ii) Gm7 C7.
    // The chorus sighs from B♭maj7 to B♭m7, the minor iv borrowed from F minor, down Am7 D7 Gm7 C7 home; the bridge
    // starts on the vi with a G7 for the ii. A soft electric piano pushed across the bar over bossa rim clicks, the bass
    // rocking with the kick.
    build: () => {
      const turn = () => [chord(2, 4, { seventh: true }), chord(5, 4, { seventh: true, major: true }), chord(1, 4, { seventh: true }), chord(4, 4, { seventh: true })]
      return songStart(
        {
          key: 5,
          mode: 'major',
          bpm: 130,
          timeSig: [4, 4],
          sound: preset('E-piano', { attack: 0.004, decay: 1.4, sustain: 0.35, release: 0.7, brightness: 4200, reverb: 0.3, bassVoice: { kind: 'round', tone: 0.3 } }),
          arp: DEFAULT_ARP,
          rhythm: { chords: 'tresillo', bass: 'kick' },
          chordsVolume: 0,
          drumsVolume: -3,
        },
        [
          { name: 'Verse', chords: [chord(0, 4, { seventh: true }), chord(5, 4, { seventh: true }), chord(1, 4, { seventh: true }), chord(4, 4, { seventh: true }), ...turn()], drums: 'bossa', drumFill: 'none', drumIntensity: 'sparse' },
          {
            name: 'Chorus',
            chords: [chord(3, 4, { seventh: true }), chord(3, 4, { seventh: true, borrowed: true }), ...turn(), chord(0, 4, { seventh: true }), chord(4, 4, { color: 'sus4' })],
            drums: 'bossa',
            drumFill: 'end',
          },
          {
            name: 'Bridge',
            chords: [chord(5, 4, { seventh: true }), chord(1, 4, { seventh: true, major: true }), chord(1, 4, { seventh: true }), chord(4, 4, { seventh: true }), chord(2, 4, { seventh: true }), chord(5, 4, { seventh: true, major: true }), chord(1, 4, { seventh: true }), chord(4, 4, { color: 'sus4' })],
            drums: 'bossa',
            drumFill: 'end',
            drumIntensity: 'sparse',
          },
        ],
        [0, 1, 0, 1, 2, 1],
      )
    },
  },
]
