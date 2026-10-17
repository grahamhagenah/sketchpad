import type { Mode } from './theory'

/**
 * How well each note fits a major or minor key, from listeners' ratings
 * (Krumhansl and Kessler's key profiles), from the key's own note upward.
 */
const PROFILES: Record<Mode, number[]> = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
}

/** The notes that belong to a key, from its own note: a minor key's raised 7th too, as a tune in A minor often has a G♯. */
const IN_KEY: Record<Mode, Set<number>> = {
  major: new Set([0, 2, 4, 5, 7, 9, 11]),
  minor: new Set([0, 2, 3, 5, 7, 8, 10, 11]),
}

export interface KeyGuess {
  key: number
  mode: Mode
  /** The notes played that aren't in the key, as pitch classes, each once. */
  outside: number[]
  /** How much the tune sounds like it's in this key, from -1 to 1. */
  likeness: number
}

/**
 * Every major and minor key, likeliest first, for a tune given as its notes
 * in order (pitch classes, 0 for C to 11 for B, repeats and all). A key that
 * has every note comes before one that doesn't; among those, the one the
 * tune sounds most at home in, weighing notes by how often they come, and
 * the first and last notes a little more, since a tune tends to start and end
 * on its key's own note. That tells apart keys with the same notes, as C
 * major and A minor.
 */
export function findKeys(notes: number[]): KeyGuess[] {
  if (!notes.length) return []
  const weight = Array<number>(12).fill(0)
  for (const n of notes) weight[n] += 1
  weight[notes[0]] += 1
  weight[notes[notes.length - 1]] += 1
  const played = [...new Set(notes)]

  const guesses: KeyGuess[] = []
  for (const mode of ['major', 'minor'] as const) {
    for (let key = 0; key < 12; key++) {
      const profile = weight.map((_, pc) => PROFILES[mode][(pc - key + 12) % 12])
      guesses.push({
        key,
        mode,
        outside: played.filter((pc) => !IN_KEY[mode].has((pc - key + 12) % 12)),
        likeness: correlation(weight, profile),
      })
    }
  }
  return guesses.sort((a, b) => a.outside.length - b.outside.length || b.likeness - a.likeness)
}

function correlation(a: number[], b: number[]) {
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const ma = mean(a)
  const mb = mean(b)
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}
