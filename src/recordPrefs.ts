import { create } from 'zustand'

/**
 * How this device records, a habit of its owner kept on it rather than with
 * the song: which microphone (null for the browser's default), how many bars
 * are counted in (0 for none), and whether you hear yourself while singing.
 */
export interface RecordPrefs {
  micId: string | null
  countIn: 0 | 1 | 2
  monitor: boolean
}

const KEY = 'bounce-record-prefs'
const DEFAULTS: RecordPrefs = { micId: null, countIn: 1, monitor: false }

function saved(): RecordPrefs {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<RecordPrefs>
    return {
      micId: typeof kept.micId === 'string' ? kept.micId : null,
      countIn: kept.countIn === 0 || kept.countIn === 2 ? kept.countIn : 1,
      monitor: kept.monitor === true,
    }
  } catch {
    return DEFAULTS
  }
}

export const useRecordPrefs = create<RecordPrefs>(() => (typeof window === 'undefined' ? DEFAULTS : saved()))

export function setRecordPrefs(change: Partial<RecordPrefs>) {
  useRecordPrefs.setState(change)
  try {
    localStorage.setItem(KEY, JSON.stringify(useRecordPrefs.getState()))
  } catch {
    // Kept for this visit only.
  }
}
