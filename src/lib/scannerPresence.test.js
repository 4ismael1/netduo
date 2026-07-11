import { describe, expect, it } from 'vitest'
import { buildCompletedPresenceInput, buildScanPresenceInput, ipIsInsideScanSegments } from './scannerPresence'

const segments = [{ baseIP: '192.168.1', start: 1, end: 100 }]

describe('Scanner re-scan presence', () => {
    it('recognizes addresses inside the selected segments', () => {
        expect(ipIsInsideScanSegments('192.168.1.50', segments)).toBe(true)
        expect(ipIsInsideScanSegments('192.168.1.150', segments)).toBe(false)
        expect(ipIsInsideScanSegments('192.168.2.1', segments)).toBe(false)
    })

    it('marks pending devices without mutating the completed snapshot', () => {
        const completed = [
            { ip: '192.168.1.10', alive: true },
            { ip: '192.168.1.150', alive: true },
        ]
        const input = buildScanPresenceInput(completed, [], [], segments)
        expect(input.find(device => device.ip === '192.168.1.10')).toMatchObject({ presenceHint: 'checking', alive: false })
        expect(input.find(device => device.ip === '192.168.1.150')).toMatchObject({ presenceHint: 'not-checked', alive: false })
        expect(completed.every(device => device.alive === true)).toBe(true)
    })

    it('replaces a placeholder as soon as the device responds', () => {
        const completed = [{ ip: '192.168.1.10', alive: true, time: 8 }]
        const fresh = [{ ip: '192.168.1.10', alive: true, time: 3 }]
        expect(buildScanPresenceInput(completed, fresh, [], segments)).toEqual(fresh)
    })

    it('also verifies inventory devices after an app restart', () => {
        const inventory = [{ deviceKey: 'net::mac:aabb', ip: '192.168.1.10', mac: 'aa:bb', hostname: 'printer', lastSeen: 123 }]
        expect(buildScanPresenceInput([], [], inventory, segments)[0]).toMatchObject({
            ip: '192.168.1.10', presenceHint: 'checking', lastSeen: 123,
        })
    })

    it('does not mark inventory outside a completed partial scan as offline', () => {
        const inventory = [
            { deviceKey: 'net::ip:192.168.1.20', ip: '192.168.1.20' },
            { deviceKey: 'net::ip:192.168.1.150', ip: '192.168.1.150' },
        ]
        const input = buildCompletedPresenceInput([], inventory, segments)
        expect(input).toHaveLength(1)
        expect(input[0]).toMatchObject({ ip: '192.168.1.150', presenceHint: 'not-checked' })
    })
})
