import { create } from 'zustand'

/**
 * The key finder: whether it's open, the notes played into it so far, in
 * order (pitch classes, 0 for C), and the octave its notes sound in, to match
 * the voice singing them (4 is middle C's). Kept while it's closed, to come
 * back to, though not with the song.
 */
export const useKeyFinder = create(() => ({ open: false, notes: [] as number[], octave: 4 }))

/** The octaves the key finder's notes can sound in: low enough for a low voice, high enough for a high one. */
export const LOWEST_OCTAVE = 2
export const HIGHEST_OCTAVE = 6

/** Moves the key finder's notes an octave down (-1) or up (1), as far as they go. */
export function shiftOctave(by: number) {
  useKeyFinder.setState((s) => ({ octave: Math.min(HIGHEST_OCTAVE, Math.max(LOWEST_OCTAVE, s.octave + by)) }))
}
