import { describe, expect, it } from 'vitest'
import { assessDeviceEvidence } from './deviceEvidence'

describe('assessDeviceEvidence', () => {
    it('separates active proof from stale neighbor evidence', () => {
        expect(assessDeviceEvidence({ alive: true, time: 3, mac: 'aa:bb:cc:dd:ee:ff' }).state).toBe('confirmed')
        expect(assessDeviceEvidence({ seenOnly: true, neighborState: 'stale' }).state).toBe('recent')
    })

    it('does not present inventory-only devices as detected online', () => {
        expect(assessDeviceEvidence({ presence: 'offline' })).toEqual({ state: 'offline', label: 'Historical only', confidence: 0 })
    })
})
