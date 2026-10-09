import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from './id'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses crypto.randomUUID where the page has it', () => {
    expect(newId()).toMatch(UUID)
  })

  it('makes a UUID of its own on a page without it, as on plain http', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) })
    const ids = Array.from({ length: 200 }, newId)
    for (const id of ids) expect(id).toMatch(UUID)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
