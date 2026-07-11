import { describe, expect, it } from 'vitest'
import {
    DEFAULT_POLL_INTERVAL_SECONDS,
    POLL_INTERVAL_OPTIONS_SECONDS,
    normalizePollIntervalMs,
} from './polling'

describe('polling defaults', () => {
    it('uses a selectable three-second default', () => {
        expect(DEFAULT_POLL_INTERVAL_SECONDS).toBe(3)
        expect(POLL_INTERVAL_OPTIONS_SECONDS).toContain(DEFAULT_POLL_INTERVAL_SECONDS)
    })

    it('normalizes configured seconds to milliseconds', () => {
        expect(normalizePollIntervalMs(undefined)).toBe(3000)
        expect(normalizePollIntervalMs('3')).toBe(3000)
        expect(normalizePollIntervalMs('0')).toBe(1000)
        expect(normalizePollIntervalMs('90')).toBe(60000)
    })
})
