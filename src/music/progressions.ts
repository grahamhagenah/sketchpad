import type { Mode } from './theory'

export interface Progression {
  name: string
  /** Scale degrees, 0 for the tonic; each chord gets a bar. */
  degrees: number[]
  seventh?: boolean
}

/** Well-worn progressions to start from, written in the key's own chords. */
export const PROGRESSIONS: Record<Mode, Progression[]> = {
  major: [
    { name: 'Pop', degrees: [0, 4, 5, 3] },
    { name: 'Sensitive', degrees: [5, 3, 0, 4] },
    { name: 'Doo-wop', degrees: [0, 5, 3, 4] },
    { name: 'Rock', degrees: [0, 3, 0, 4] },
    { name: 'Royal road', degrees: [3, 4, 2, 5] },
    { name: 'Canon', degrees: [0, 4, 5, 2, 3, 0, 3, 4] },
    { name: 'Jazz ii–V–I', degrees: [1, 4, 0, 0], seventh: true },
  ],
  minor: [
    { name: 'Epic', degrees: [0, 5, 2, 6] },
    { name: 'Andalusian', degrees: [0, 6, 5, 4] },
    { name: 'Aeolian', degrees: [0, 6, 5, 6] },
    { name: 'Ballad', degrees: [0, 5, 3, 4] },
    { name: 'Circle', degrees: [0, 3, 6, 2] },
    { name: 'Cadence', degrees: [0, 3, 4, 0] },
    { name: 'Jazz ii–v–i', degrees: [1, 4, 0, 0], seventh: true },
  ],
}
