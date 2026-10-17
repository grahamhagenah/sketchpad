import { create } from 'zustand'

/**
 * The key finder: whether it's open, and the notes played into it so far, in
 * order (pitch classes, 0 for C). Kept while it's closed, to come back to,
 * though not with the song.
 */
export const useKeyFinder = create(() => ({ open: false, notes: [] as number[] }))
