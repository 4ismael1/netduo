import { describe, expect, it, vi } from 'vitest'
import { persistPublicIpVisible, readPublicIpVisible } from './publicIpPrivacy'

describe('public IP display privacy', () => {
    it('is hidden before the user chooses a preference', () => {
        expect(readPublicIpVisible({ getItem: () => null })).toBe(false)
    })

    it('restores the hidden preference across Dashboard remounts', () => {
        const values = new Map()
        const storage = {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
        }
        persistPublicIpVisible(false, storage)
        expect(readPublicIpVisible(storage)).toBe(false)
    })

    it('fails safely if storage is unavailable', () => {
        const storage = {
            getItem: vi.fn(() => { throw new Error('blocked') }),
            setItem: vi.fn(() => { throw new Error('blocked') }),
        }
        expect(readPublicIpVisible(storage)).toBe(false)
        expect(persistPublicIpVisible(false, storage)).toBe(false)
    })
})
