import { describe, expect, it } from 'vitest'
import { exportName, songToMidi } from './export'
import { DEFAULT_ARP } from './arrange'
import { DEFAULT_SOUND } from './sound'
import { grooveHits } from './drums'

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
    expect(exportName({ ...song, key: 10, mode: 'major' })).toBe('bounce-Bb-96bpm')
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
    expect(names).toEqual(['Bounce', 'Chords', 'Bass'])
  })

  it('adds the drums as a track on the drum channel', async () => {
    const bytes = [...new Uint8Array(await songToMidi({ ...song, drums: grooveHits('backbeat', song.timeSig, 0, 12) }).arrayBuffer())]
    expect([bytes[10], bytes[11]]).toEqual([0, 4])
    // A kick (36) on channel 10 (status 0x99) at the start.
    expect(bytes.some((b, i) => b === 0x99 && bytes[i + 1] === 36)).toBe(true)
  })

  it('changes the key signature where a section in another key starts', async () => {
    const chords = [{ ...song.chords[0] }, { ...song.chords[1], key: 8, mode: 'minor' as const }]
    const bytes = [...new Uint8Array(await songToMidi({ ...song, chords }).arrayBuffer())]
    const sigs = bytes.flatMap((b, i) => (b === 0xff && bytes[i + 1] === 0x59 && bytes[i + 2] === 2 ? [[(bytes[i + 3] << 24) >> 24, bytes[i + 4]]] : []))
    // F♯ minor, then G♯ minor (five sharps).
    expect(sigs).toEqual([[3, 1], [5, 1]])
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

describe('zip', () => {
  it('stores each file with its name and a matching checksum', async () => {
    const { zip, crc32 } = await import('./zip')
    const data = new TextEncoder().encode('hello')
    const bytes = new Uint8Array(await (await zip([{ name: '01 Chords.wav', data: new Blob([data]) }])).arrayBuffer())
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint32(14, true)).toBe(crc32(data))
    expect(String.fromCharCode(...bytes.slice(30, 43))).toBe('01 Chords.wav')
    // The end record counts one file.
    expect(view.getUint16(bytes.length - 12, true)).toBe(1)
    // "hello" is a known checksum.
    expect(crc32(data)).toBe(0x3610a686)
  })
})
