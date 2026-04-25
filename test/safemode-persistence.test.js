/**
 * Audits Safe Scan preference persistence through the renderer bridge.
 *
 * Scanner relies on configGet('safeScanDefault') during mount and must
 * preserve explicit true/false values while treating absent/corrupt data as
 * safe fallback input.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import bridge from '../src/lib/electronBridge.js'

describe('Safe Scan persistence through config bridge', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('loads a persisted true value', async () => {
        await bridge.configSet('safeScanDefault', true)
        await expect(bridge.configGet('safeScanDefault')).resolves.toBe(true)
    })

    it('loads a persisted false value without treating it as missing', async () => {
        await bridge.configSet('safeScanDefault', false)
        await expect(bridge.configGet('safeScanDefault')).resolves.toBe(false)
    })

    it('returns null when the preference was never saved', async () => {
        await expect(bridge.configGet('safeScanDefault')).resolves.toBeNull()
    })

    it('does not throw on corrupt stored config values', async () => {
        localStorage.setItem('netpulse_cfg_safeScanDefault', 'not-json')
        await expect(bridge.configGet('safeScanDefault')).resolves.toBe('not-json')
    })
})
