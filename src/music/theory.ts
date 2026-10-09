export type Mode = 'major' | 'minor'

const SCALES: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
}

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
// Major keys spelled with sharps: G D A E B F♯
const SHARP_MAJOR_TONICS = new Set([7, 2, 9, 4, 11, 6])
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

function noteNames(key: number, mode: Mode) {
  const majorTonic = mode === 'major' ? key : (key + 3) % 12
  return SHARP_MAJOR_TONICS.has(majorTonic) ? SHARP_NAMES : FLAT_NAMES
}

export function keyLabel(key: number, mode: Mode) {
  return noteNames(key, mode)[key]
}

export interface ChordInfo {
  name: string
  roman: string
  rootPc: number
  /** Pitch classes, root first. */
  pcs: number[]
}

export function chordInfo(key: number, mode: Mode, degree: number, seventh: boolean): ChordInfo {
  const scale = SCALES[mode]
  const tone = (i: number) => scale[(degree + i) % 7] + 12 * Math.floor((degree + i) / 7)
  const root = tone(0)
  const intervals = (seventh ? [0, 2, 4, 6] : [0, 2, 4]).map((i) => tone(i) - root)
  const [, third, fifth, sev] = intervals

  const triad = third === 4 ? (fifth === 8 ? 'aug' : 'maj') : fifth === 6 ? 'dim' : 'min'
  let roman = NUMERALS[degree]
  if (triad === 'min' || triad === 'dim') roman = roman.toLowerCase()

  let suffix: string
  if (!seventh) {
    suffix = { maj: '', min: 'm', dim: '°', aug: '+' }[triad]
    roman += { maj: '', min: '', dim: '°', aug: '+' }[triad]
  } else if (triad === 'maj') {
    suffix = sev === 11 ? 'maj7' : '7'
    roman += suffix
  } else if (triad === 'min') {
    suffix = sev === 10 ? 'm7' : 'm(maj7)'
    roman += sev === 10 ? '7' : '(maj7)'
  } else if (triad === 'dim') {
    suffix = sev === 10 ? 'ø7' : '°7'
    roman += suffix
  } else {
    suffix = '+maj7'
    roman += '+maj7'
  }

  const rootPc = (key + root) % 12
  return {
    name: noteNames(key, mode)[rootPc] + suffix,
    roman,
    rootPc,
    pcs: intervals.map((x) => (rootPc + x) % 12),
  }
}

/**
 * Picks the inversion of a chord, around middle C, that moves least from the
 * previous voicing, so a progression sounds connected rather than jumping.
 */
export function voiceChord(pcs: number[], prev: number[] | null): number[] {
  let best: number[] = []
  let bestScore = Infinity
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)]
    for (let low = 52; low <= 64; low++) {
      if (low % 12 !== order[0]) continue
      const notes = [low]
      for (const pc of order.slice(1)) {
        let n = notes[notes.length - 1] + 1
        while (n % 12 !== pc) n++
        notes.push(n)
      }
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length
      let score: number
      if (!prev) {
        score = Math.abs(mean - 62)
      } else {
        const prevMean = prev.reduce((a, b) => a + b, 0) / prev.length
        score =
          notes.reduce((sum, n) => sum + Math.min(...prev.map((p) => Math.abs(p - n))), 0) +
          Math.abs(mean - prevMean) * 0.5 +
          Math.abs(mean - 62) * 0.3
      }
      if (score < bestScore) {
        bestScore = score
        best = notes
      }
    }
  }
  return best
}

export function bassNote(rootPc: number) {
  return 36 + rootPc
}

/** MIDI notes for each chord of a progression, each voiced to lead smoothly from the last. */
export function voiceProgression(key: number, mode: Mode, chords: { degree: number; seventh: boolean }[]) {
  let prev: number[] | null = null
  return chords.map((c) => {
    const info = chordInfo(key, mode, c.degree, c.seventh)
    prev = voiceChord(info.pcs, prev)
    return { notes: prev, bass: bassNote(info.rootPc) }
  })
}

/** Sharps (positive) or flats (negative) in a key's signature. */
export function keySignature(key: number, mode: Mode) {
  const majorTonic = mode === 'major' ? key : (key + 3) % 12
  const fifths = (majorTonic * 7) % 12
  return fifths <= 6 ? fifths : fifths - 12
}

export const FUNCTIONS: { id: string; label: string; about: string; degrees: number[] }[] = [
  { id: 'tonic', label: 'Tonic', about: 'Stable and at rest. Progressions tend to start and end here.', degrees: [0, 2, 5] },
  { id: 'predominant', label: 'Predominant', about: 'Moves away from the tonic and sets up the dominant.', degrees: [1, 3] },
  { id: 'dominant', label: 'Dominant', about: 'Builds tension that wants to resolve to the tonic.', degrees: [4, 6] },
]
