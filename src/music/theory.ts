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

/** A sus or added note that changes a chord's colour. */
export type ChordColor = 'sus2' | 'sus4' | 'add9'
/** A chord tone other than the root in the bass, making a slash chord. */
export type ChordBass = 'third' | 'fifth'

/** Which chord to play: a degree of the key, and anything that changes it. */
export interface ChordSpec {
  /** Scale degree, 0–6. */
  degree: number
  seventh: boolean
  /** Taken from the parallel key (minor when in major, and the other way round), e.g. ♭VII or iv in a major key. */
  borrowed?: boolean
  color?: ChordColor
  bass?: ChordBass
}

export interface ChordInfo {
  name: string
  roman: string
  rootPc: number
  /** Pitch classes, root first. */
  pcs: number[]
  /** What the bass plays: the root, or another chord tone for a slash chord. */
  bassPc: number
}

const otherMode = (mode: Mode): Mode => (mode === 'major' ? 'minor' : 'major')

export function chordInfo(key: number, mode: Mode, degree: number, seventh: boolean, extra: Omit<ChordSpec, 'degree' | 'seventh'> = {}): ChordInfo {
  const scale = SCALES[extra.borrowed ? otherMode(mode) : mode]
  const tone = (i: number) => scale[(degree + i) % 7] + 12 * Math.floor((degree + i) / 7)
  const root = tone(0)
  const intervals = (seventh ? [0, 2, 4, 6] : [0, 2, 4]).map((i) => tone(i) - root)
  const [, third, fifth, sev] = intervals

  const triad = third === 4 ? (fifth === 8 ? 'aug' : 'maj') : fifth === 6 ? 'dim' : 'min'
  // A borrowed root a semitone off the key's own is written ♭ or ♯ (♭VII, ♭VI…).
  const shift = root - SCALES[mode][degree]
  const accidental = shift < 0 ? '♭' : shift > 0 ? '♯' : ''
  let roman = NUMERALS[degree]
  if ((triad === 'min' || triad === 'dim') && !extra.color?.startsWith('sus')) roman = roman.toLowerCase()

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

  // A sus chord swaps its third for the 2nd or 4th; add9 puts a 9th on top.
  if (extra.color === 'sus2' || extra.color === 'sus4') {
    intervals[1] = extra.color === 'sus2' ? 2 : 5
    suffix = (seventh ? (sev === 11 ? 'maj7' : '7') : '') + extra.color
    roman = NUMERALS[degree] + (seventh ? '7' : '') + extra.color
  } else if (extra.color === 'add9') {
    intervals.push(14)
    suffix += seventh ? '(9)' : 'add9'
    roman += seventh ? '(9)' : 'add9'
  }

  const rootPc = (key + root) % 12
  const pcs = intervals.map((x) => (rootPc + x) % 12)
  const names = accidental === '♭' ? FLAT_NAMES : accidental === '♯' ? SHARP_NAMES : noteNames(key, mode)
  const bassPc = extra.bass === 'third' ? pcs[1] : extra.bass === 'fifth' ? pcs[2] : rootPc
  const slash = bassPc === rootPc ? '' : `/${noteNames(key, mode)[bassPc]}`
  return {
    name: names[rootPc] + suffix + slash,
    roman: accidental + roman + (extra.bass === 'third' ? '/3' : extra.bass === 'fifth' ? '/5' : ''),
    rootPc,
    pcs,
    bassPc,
  }
}

/** chordInfo for a chord as stored, with its borrowing, colour and bass. */
export const chordOf = (key: number, mode: Mode, c: ChordSpec) => chordInfo(key, mode, c.degree, c.seventh, c)

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
export function voiceProgression(key: number, mode: Mode, chords: (ChordSpec & { key?: number; mode?: Mode })[]) {
  let prev: number[] | null = null
  return chords.map((c) => {
    // A chord can carry its own key, from a section in another one; the voicing still leads on from the last chord.
    const info = chordOf(c.key ?? key, c.mode ?? mode, c)
    prev = voiceChord(info.pcs, prev)
    return { notes: prev, bass: bassNote(info.bassPc) }
  })
}

/** Sharps (positive) or flats (negative) in a key's signature. */
export function keySignature(key: number, mode: Mode) {
  const majorTonic = mode === 'major' ? key : (key + 3) % 12
  const fifths = (majorTonic * 7) % 12
  return fifths <= 6 ? fifths : fifths - 12
}

/**
 * Chords commonly borrowed from the parallel key: the darker ones a major
 * song takes from minor, and the major IV and V a minor song takes from major.
 */
export const BORROWED: Record<Mode, number[]> = { major: [3, 5, 6, 2], minor: [3, 4] }

/** A chord by its place in the key, and whether it's borrowed from the parallel one. */
export type ChordPlace = { degree: number; borrowed?: boolean }

const p = (degree: number, borrowed = false): ChordPlace => ({ degree, borrowed })

/**
 * Where each chord most often goes next, by its place in the key: the moves
 * that sound like progress, tonic to predominant to dominant and home again.
 * Keyed by degree, with a b prefix for a borrowed chord.
 */
const NEXT: Record<Mode, Record<string, ChordPlace[]>> = {
  major: {
    0: [p(3), p(4), p(5)], // I → IV, V, vi
    1: [p(4), p(6)], // ii → V, vii°
    2: [p(5), p(3)], // iii → vi, IV
    3: [p(4), p(0), p(1)], // IV → V, I, ii
    4: [p(0), p(5)], // V → I, vi
    5: [p(3), p(1), p(4)], // vi → IV, ii, V
    6: [p(0), p(2)], // vii° → I, iii
    b3: [p(0)], // iv → I
    b5: [p(6, true), p(4)], // ♭VI → ♭VII, V
    b6: [p(0)], // ♭VII → I
    b2: [p(3)], // ♭III → IV
  },
  minor: {
    0: [p(3), p(5), p(6)], // i → iv, VI, VII
    1: [p(4), p(4, true)], // ii° → v, V
    2: [p(5), p(3)], // III → VI, iv
    3: [p(4), p(0), p(6)], // iv → v, i, VII
    4: [p(0), p(5)], // v → i, VI
    5: [p(6), p(3), p(2)], // VI → VII, iv, III
    6: [p(0), p(2)], // VII → i, III
    b3: [p(0), p(4, true)], // IV → i, V
    b4: [p(0)], // V → i
  },
}

/** The chords that most often follow `last`; with nothing before, the tonic. */
export function nextChords(mode: Mode, last: ChordPlace | null): ChordPlace[] {
  if (!last) return [p(0)]
  return NEXT[mode][`${last.borrowed ? 'b' : ''}${last.degree}`] ?? []
}

export const FUNCTIONS: { id: string; label: string; about: string; degrees: number[] }[] = [
  { id: 'tonic', label: 'Tonic', about: 'Stable and at rest. Progressions tend to start and end here.', degrees: [0, 2, 5] },
  { id: 'predominant', label: 'Predominant', about: 'Moves away from the tonic and sets up the dominant.', degrees: [1, 3] },
  { id: 'dominant', label: 'Dominant', about: 'Builds tension that wants to resolve to the tonic.', degrees: [4, 6] },
]
