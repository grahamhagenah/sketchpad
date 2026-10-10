/**
 * The colours a track can be: sixteen hues round the colour wheel, all as
 * light as each other, so they sit together on the dark editor, each light
 * enough for the dark text drawn on it, and every track can have its own.
 */
export const PALETTE = [
  { id: 'blue', label: 'Blue', hex: '#86a8ff' },
  { id: 'indigo', label: 'Indigo', hex: '#9d93ff' },
  { id: 'violet', label: 'Violet', hex: '#be9cff' },
  { id: 'orchid', label: 'Orchid', hex: '#e293ff' },
  { id: 'pink', label: 'Pink', hex: '#ff92c9' },
  { id: 'rose', label: 'Rose', hex: '#ff8fa6' },
  { id: 'red', label: 'Red', hex: '#ff8585' },
  { id: 'coral', label: 'Coral', hex: '#ff9b7a' },
  { id: 'orange', label: 'Orange', hex: '#ffaa66' },
  { id: 'amber', label: 'Amber', hex: '#ffbf5c' },
  { id: 'yellow', label: 'Yellow', hex: '#ffd166' },
  { id: 'lime', label: 'Lime', hex: '#c8e37a' },
  { id: 'green', label: 'Green', hex: '#7fdc9a' },
  { id: 'mint', label: 'Mint', hex: '#6fe3c1' },
  { id: 'teal', label: 'Teal', hex: '#5fd4d0' },
  { id: 'sky', label: 'Sky', hex: '#6cc6ff' },
] as const

export type ColorId = (typeof PALETTE)[number]['id']

export const DEFAULT_CHORDS_COLOR: ColorId = 'blue'
export const DEFAULT_DRUMS_COLOR: ColorId = 'yellow'
/** Vocal tracks take these in turn, until given their own. */
const DEFAULT_VOCAL_COLORS: ColorId[] = ['violet', 'teal', 'orange', 'pink', 'green', 'red', 'blue', 'yellow']

export const colorHex = (id: ColorId) => PALETTE.find((c) => c.id === id)?.hex ?? PALETTE[0].hex

/** A vocal track's colour id: its own, or the one its lane takes by default. */
export const vocalColorId = (colors: readonly (ColorId | null)[] | undefined, lane: number) => colors?.[lane] ?? DEFAULT_VOCAL_COLORS[lane % DEFAULT_VOCAL_COLORS.length]

export const vocalColor = (colors: readonly (ColorId | null)[] | undefined, lane: number) => colorHex(vocalColorId(colors, lane))
