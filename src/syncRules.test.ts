import { describe, expect, it } from 'vitest'
import { decide, stampOf } from './syncRules'

describe('settling a sketch between this device and the cloud', () => {
  it('goes by whichever changed last', () => {
    expect(decide(200, 100, true)).toBe('up')
    expect(decide(100, 200, true)).toBe('down')
    expect(decide(100, 100, true)).toBe('none')
  })

  it('sends up a sketch new here, and fetches one new in the cloud', () => {
    expect(decide(100, null, false)).toBe('up')
    expect(decide(null, 100, false)).toBe('down')
  })

  it('follows a sketch deleted for good on one side, once this device has synced it', () => {
    // Synced before and gone from the cloud: deleted for good on another device.
    expect(decide(100, null, true)).toBe('drop-here')
    // Synced before and gone from here: deleted for good on this one.
    expect(decide(null, 100, true)).toBe('drop-there')
    expect(decide(null, null, true)).toBe('none')
  })

  it('counts deleting (to Recently deleted) as a change', () => {
    expect(stampOf({ updated: 100 })).toBe(100)
    expect(stampOf({ updated: 100, deleted: 300 })).toBe(300)
    expect(stampOf({ updated: 100, deleted: null })).toBe(100)
  })
})
