import { MAX_BPM, MIN_BPM } from './store'

/** A pause this long between taps starts the counting over. */
export const TAP_RESET_MS = 2000
/** How many of the latest taps the tempo is worked out from: enough to even out a wobble, few enough to follow a change of mind. */
const TAPS_KEPT = 6

/**
 * Taps on the beat, as times in milliseconds: the taps to keep (those since
 * the last long pause, the latest few), and the tempo they make, once there
 * are two: the average gap between them, as beats per minute, rounded, and
 * kept within the tempos Bounce plays.
 */
export function tapTempo(taps: number[], now: number): { taps: number[]; bpm: number | null } {
  const last = taps[taps.length - 1]
  const kept = [...(last !== undefined && now - last < TAP_RESET_MS ? taps : []), now].slice(-TAPS_KEPT)
  if (kept.length < 2) return { taps: kept, bpm: null }
  const gap = (kept[kept.length - 1] - kept[0]) / (kept.length - 1)
  return { taps: kept, bpm: Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(60000 / gap))) }
}
