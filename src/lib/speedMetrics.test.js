import { describe, expect, it } from 'vitest'
import { deriveProgressMbps, isStalePhaseEvent, phaseIndex } from './speedMetrics'

describe('speedMetrics.phaseIndex', () => {
    it('returns a valid index for known phases', () => {
        expect(phaseIndex('idle')).toBe(0)
        expect(phaseIndex('downloading')).toBeGreaterThan(0)
    })
})

describe('speedMetrics.isStalePhaseEvent', () => {
    it('flags old events as stale', () => {
        expect(isStalePhaseEvent('done', 'uploading')).toBe(true)
    })

    it('accepts forward phase transitions', () => {
        expect(isStalePhaseEvent('latency', 'downloading')).toBe(false)
    })
})

describe('speedMetrics.deriveProgressMbps', () => {
    it('prefers overallSpeed when present', () => {
        expect(deriveProgressMbps({
            overallSpeed: 91.234,
            avgSpeed: 40,
            instantSpeed: 10,
            bytesReceived: 1000,
            elapsed: 1,
        })).toBe(91.23)
    })

    it('falls back to avgSpeed when overall is missing', () => {
        expect(deriveProgressMbps({ avgSpeed: 64.567, instantSpeed: 70 })).toBe(64.57)
    })

    it('falls back to instantSpeed when avg is missing', () => {
        expect(deriveProgressMbps({ instantSpeed: 22.345 })).toBe(22.35)
    })

    it('derives from bytes and elapsed as last fallback', () => {
        expect(deriveProgressMbps({ bytesSent: 1_000_000, elapsed: 1 })).toBe(8)
    })

    it('returns zero on invalid payload', () => {
        expect(deriveProgressMbps(null)).toBe(0)
        expect(deriveProgressMbps({})).toBe(0)
    })
})
