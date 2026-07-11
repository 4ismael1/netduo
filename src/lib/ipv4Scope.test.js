import { describe, expect, it } from 'vitest'
import { buildContextScanSegments } from './ipv4Scope'

describe('buildContextScanSegments', () => {
    it('keeps /24 network and broadcast addresses out', () => {
        const result = buildContextScanSegments({ firstHost: '192.168.1.1', lastHost: '192.168.1.254', cidr: '192.168.1.0/24' })
        expect(result.segments).toEqual([{ baseIP: '192.168.1', start: 1, end: 254 }])
    })

    it('includes valid .255 and .0 hosts inside a /23', () => {
        const result = buildContextScanSegments({ firstHost: '192.168.10.1', lastHost: '192.168.11.254', cidr: '192.168.10.0/23' })
        expect(result.segments).toEqual([
            { baseIP: '192.168.10', start: 1, end: 255 },
            { baseIP: '192.168.11', start: 0, end: 254 },
        ])
        expect(result.hostCount).toBe(510)
    })

    it('rejects an unexpectedly huge automatic scan', () => {
        expect(buildContextScanSegments({ firstHost: '10.0.0.1', lastHost: '10.0.255.254' }, 4096).ok).toBe(false)
    })
})
