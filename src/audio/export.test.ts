import { describe, expect, it } from 'vitest'
import { exportName, songToMidi } from './export'
import { DEFAULT_ARP } from './arrange'
import { DEFAULT_SOUND } from './sound'

const song = {
  key: 6,
  mode: 'minor' as const,
  bpm: 96,
  timeSig: [6, 8] as [number, number],
  chords: [0, 4].map((degree, i) => ({ id: String(i), degree, beats: 6, seventh: false })),
  sound: { ...DEFAULT_SOUND, bass: true },
  arp: DEFAULT_ARP,
}

const text = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.slice(at, at + 4))
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0

describe('exportName', () => {
  it('names the file after the title, key and tempo', () => {
    expect(exportName({ ...song, title: 'Night Drive!' })).toBe('night-drive-F#m-96bpm')
    expect(exportName({ ...song, key: 10, mode: 'major' })).toBe('sketchpad-Bb-96bpm')
  })
})

describe('songToMidi', () => {
  it('writes a type-1 file with a conductor, chords and bass track', async () => {
    const bytes = new Uint8Array(await songToMidi(song).arrayBuffer())
    expect(text(bytes, 0)).toBe('MThd')
    expect([bytes[8], bytes[9]]).toEqual([0, 1])
    expect([bytes[10], bytes[11]]).toEqual([0, 3])

    // Each track chunk's length leads to the next one, ending at the file's end.
    let at = 14
    const names: string[] = []
    while (at < bytes.length) {
      expect(text(bytes, at)).toBe('MTrk')
      const length = u32(bytes, at + 4)
      const body = bytes.slice(at + 8, at + 8 + length)
      names.push(String.fromCharCode(...body.slice(4, 4 + body[3])))
      expect([...body.slice(-3)]).toEqual([0xff, 0x2f, 0])
      at += 8 + length
    }
    expect(at).toBe(bytes.length)
    expect(names).toEqual(['Sketchpad', 'Chords', 'Bass'])
  })

  it('records the meter and key', async () => {
    const bytes = [...new Uint8Array(await songToMidi(song).arrayBuffer())]
    const find = (meta: number[]) => bytes.findIndex((_, i) => meta.every((b, j) => bytes[i + j] === b))
    const timeSig = find([0xff, 0x58, 4])
    expect(bytes.slice(timeSig + 3, timeSig + 5)).toEqual([6, 3])
    // F♯ minor: three sharps, minor.
    const keySig = find([0xff, 0x59, 2])
    expect(bytes.slice(keySig + 3, keySig + 5)).toEqual([3, 1])
  })
})
