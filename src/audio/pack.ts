/**
 * Recordings packed smaller for the cloud copy, losslessly, with what every
 * browser has built in: each sample kept as how far it moved from the one
 * before (small numbers, as a voice moves smoothly), split into a run of
 * every sample's high byte (mostly 0 or 255, so very repetitive) and then
 * one of its low byte, and the lot gzipped. Unpacked, it's the same samples,
 * to the bit.
 */

/** Whether this browser can pack and unpack: gzip by CompressionStream (every current browser; Safari since 16.4). */
export const canPack = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'

/** The samples as differences, high bytes then low bytes. */
export function toPlanes(pcm: Int16Array): Uint8Array {
  const n = pcm.length
  const out = new Uint8Array(n * 2)
  let last = 0
  for (let i = 0; i < n; i++) {
    // Kept to 16 bits: a jump from one extreme to the other wraps round, and wraps back unpacking.
    const step = (pcm[i] - last) & 0xffff
    last = pcm[i]
    out[i] = step >> 8
    out[n + i] = step & 0xff
  }
  return out
}

/** toPlanes undone: the samples again. */
export function fromPlanes(planes: Uint8Array): Int16Array {
  const n = planes.length >> 1
  const pcm = new Int16Array(n)
  let last = 0
  for (let i = 0; i < n; i++) {
    // Assigning to an Int16Array wraps to 16 bits, undoing the wrap above.
    pcm[i] = last + ((planes[i] << 8) | planes[n + i])
    last = pcm[i]
  }
  return pcm
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer())
}

/** The samples packed: differences, split, gzipped. */
export const pack = (pcm: Int16Array) => through(toPlanes(pcm), new CompressionStream('gzip'))

/** pack undone. */
export const unpack = async (bytes: Uint8Array) => fromPlanes(await through(bytes, new DecompressionStream('gzip')))
