/**
 * A plain zip archive: the files stored as they are, uncompressed, which is
 * what audio needs anyway, and quick to write.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export async function zip(files: { name: string; data: Blob }[]): Promise<Blob> {
  const parts: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const data = new Uint8Array(await file.data.arrayBuffer())
    const name = new TextEncoder().encode(file.name)
    const crc = crc32(data)
    const local = header(30 + name.length, (v) => {
      v.setUint32(0, 0x04034b50, true)
      v.setUint16(4, 20, true)
      // Bit 11: the name is UTF-8.
      v.setUint16(6, 0x0800, true)
      v.setUint32(14, crc, true)
      v.setUint32(18, data.length, true)
      v.setUint32(22, data.length, true)
      v.setUint16(26, name.length, true)
    })
    local.set(name, 30)
    central.push(
      (() => {
        const entry = header(46 + name.length, (v) => {
          v.setUint32(0, 0x02014b50, true)
          v.setUint16(4, 20, true)
          v.setUint16(6, 20, true)
          v.setUint16(8, 0x0800, true)
          v.setUint32(16, crc, true)
          v.setUint32(20, data.length, true)
          v.setUint32(24, data.length, true)
          v.setUint16(28, name.length, true)
          v.setUint32(42, offset, true)
        })
        entry.set(name, 46)
        return entry
      })(),
    )
    parts.push(local, data)
    offset += local.length + data.length
  }
  const size = central.reduce((n, entry) => n + entry.length, 0)
  const end = header(22, (v) => {
    v.setUint32(0, 0x06054b50, true)
    v.setUint16(8, files.length, true)
    v.setUint16(10, files.length, true)
    v.setUint32(12, size, true)
    v.setUint32(16, offset, true)
  })
  return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/zip' })
}

/** A zeroed record of `length` bytes, filled in by `fill`. */
function header(length: number, fill: (view: DataView) => void) {
  const bytes = new Uint8Array(length)
  fill(new DataView(bytes.buffer))
  return bytes
}
