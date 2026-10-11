/** When each one-note-at-a-time instrument (the bass, each drum, the click) last started a note. */
const lastStarts = new WeakMap<object, number>()

/**
 * When an instrument that plays one note at a time should start its next:
 * when asked, or just after its last note if that's later. Tone refuses to
 * start one at or before its last, and throws; and when a slow device or a
 * busy page runs late, it moves every late note to "now", so two in a row can
 * land on the same instant. The throw would also drop every other note due in
 * the same moment, whole chords and drum hits, so it's never let happen.
 */
export function monoStart(instrument: object, time: number) {
  const at = Math.max(time, (lastStarts.get(instrument) ?? -Infinity) + 0.002)
  lastStarts.set(instrument, at)
  return at
}

/**
 * Runs a scheduled callback so that one note that still fails can't take the
 * notes due with it down too: Tone plays everything due in a moment in one
 * go, and a throw stops the rest.
 */
export function safely<A extends unknown[]>(play: (...args: A) => void) {
  return (...args: A) => {
    try {
      play(...args)
    } catch (error) {
      console.warn('A note was skipped:', error)
    }
  }
}
