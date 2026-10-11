/**
 * Roughly how many syllables a word has, by its vowel sounds: groups of
 * vowels, less a silent e at the end ("love", "moved"), but not "-ted" or
 * "-ded", which are sung ("wanted"). Near enough to compare one line with the next.
 */
export function syllables(word: string) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1
  const sounded = w.replace(/(?:[^laeiouy]es|[^tdlaeiouy]ed|[^laeiouy]e)$/, '').replace(/^y/, '')
  return Math.max(1, sounded.match(/[aeiouy]{1,2}/g)?.length ?? 1)
}

/** The syllables in a line of lyrics; a hyphen splits a word, as in "half-way". */
export const lineSyllables = (line: string) => line.split(/[\s-]+/).reduce((n, word) => n + syllables(word), 0)
