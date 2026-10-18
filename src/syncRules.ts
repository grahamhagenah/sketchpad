/** How sync (sync.ts) settles each sketch between this device and the cloud. */

/** When a sketch last changed: saved, or deleted. */
export const stampOf = (r: { updated: number; deleted?: number | null }) => Math.max(r.updated, r.deleted ?? 0)

export type Decision = 'up' | 'down' | 'drop-here' | 'drop-there' | 'none'

/**
 * What to do with one sketch, from when it last changed here and in the
 * cloud (null where there's none), and whether this device has synced it
 * before. The later change wins. A sketch only one side has is new there,
 * unless this device synced it before: then the other side deleted it for
 * good, and so does this one.
 */
export function decide(here: number | null, there: number | null, known: boolean): Decision {
  if (here !== null && there !== null) return here > there ? 'up' : there > here ? 'down' : 'none'
  if (here !== null) return known ? 'drop-here' : 'up'
  if (there !== null) return known ? 'drop-there' : 'down'
  return 'none'
}

