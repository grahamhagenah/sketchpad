import { create } from 'zustand'

/**
 * Whether the lyrics show beside the editor (or, on a phone, over it): a habit
 * of the device's owner, kept on it rather than with the song, as the
 * settings panel's is.
 */
const KEY = 'bounce-lyrics'
const saved = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export const useLyricsPanel = create(() => ({ open: saved() }))

export function setLyricsOpen(open: boolean) {
  useLyricsPanel.setState({ open })
  try {
    localStorage.setItem(KEY, open ? '1' : '0')
  } catch {
    // Kept for this visit only.
  }
}

export const toggleLyrics = () => setLyricsOpen(!useLyricsPanel.getState().open)
