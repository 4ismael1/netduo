/**
 * Audits renderer inventory merging across scoped and unscoped device keys.
 *
 * Scanner stores DB keys as `${networkId}::${baseKey}` but live scans produce
 * unscoped keys. These tests prevent duplicate online/offline rows and verify
 * that DB `newKeys` still mark the live row as new.
 */
import { describe, expect, it } from 'vitest'
import { mergeScanWithInventory } from '../src/lib/deviceInventory.js'

const scanDevice = {
    ip: '192.168.1.40',
    mac: 'AA:BB:CC:DD:EE:40',
    hostname: 'workstation',
    vendor: 'Dell',
    deviceType: 'Computer',
    alive: true,
}

describe('mergeScanWithInventory scoped key handling', () => {
    it('matches a scoped DB key to an unscoped live scan key', () => {
        const merged = mergeScanWithInventory([scanDevice], [{
            deviceKey: 'mac:001122334455::mac:aabbccddee40',
            ip: '192.168.1.40',
            mac: 'aa:bb:cc:dd:ee:40',
            hostname: 'old-name',
            vendor: 'Dell',
            type: 'Computer',
            nickname: 'Desk PC',
            firstSeen: 100,
            lastSeen: 200,
        }])

        expect(merged).toHaveLength(1)
        expect(merged[0].presence).toBe('online')
        expect(merged[0].nickname).toBe('Desk PC')
        expect(merged[0].deviceKey).toBe('mac:001122334455::mac:aabbccddee40')
    })

    it('does not create duplicate online and offline rows for the same MAC', () => {
        const merged = mergeScanWithInventory([scanDevice], [
            {
                deviceKey: 'mac:001122334455::mac:aabbccddee40',
                ip: '192.168.1.40',
                mac: 'aa:bb:cc:dd:ee:40',
                type: 'Computer',
                firstSeen: 100,
                lastSeen: 200,
            },
        ])

        expect(merged.filter(d => d.ip === '192.168.1.40')).toHaveLength(1)
        expect(merged.map(d => d.presence)).toEqual(['online'])
    })

    it('normalizes scoped newKeySet entries before assigning presence=new', () => {
        const merged = mergeScanWithInventory(
            [scanDevice],
            [],
            new Set(['mac:001122334455::mac:aabbccddee40']),
        )

        expect(merged).toHaveLength(1)
        expect(merged[0].presence).toBe('new')
        expect(merged[0].isNew).toBe(true)
    })

    it('keeps scoped cached rows as one non-online row', () => {
        const cachedScanDevice = {
            ...scanDevice,
            alive: false,
            seenOnly: true,
            neighborState: 'stale',
        }
        const merged = mergeScanWithInventory(
            [cachedScanDevice],
            [{
                deviceKey: 'mac:001122334455::mac:aabbccddee40',
                ip: '192.168.1.40',
                mac: 'aa:bb:cc:dd:ee:40',
                type: 'Computer',
                firstSeen: 100,
                lastSeen: 200,
            }],
            new Set(['mac:001122334455::mac:aabbccddee40']),
        )

        expect(merged).toHaveLength(1)
        expect(merged[0].presence).toBe('cached')
        expect(merged[0].alive).toBe(false)
        expect(merged[0].isNew).toBe(true)
        expect(merged[0].neighborState).toBe('stale')
    })

    it('also matches legacy unscoped inventory keys', () => {
        const merged = mergeScanWithInventory([scanDevice], [{
            deviceKey: 'mac:aabbccddee40',
            ip: '192.168.1.40',
            mac: 'aa:bb:cc:dd:ee:40',
            nickname: 'Legacy PC',
            firstSeen: 100,
            lastSeen: 200,
        }])

        expect(merged).toHaveLength(1)
        expect(merged[0].nickname).toBe('Legacy PC')
        expect(merged[0].presence).toBe('online')
    })

    it('treats only the first :: separator as the network scope boundary', () => {
        const merged = mergeScanWithInventory([scanDevice], [{
            deviceKey: 'mac:001122334455::mac:aabbccddee40::stale',
            ip: '192.168.1.40',
            mac: 'aa:bb:cc:dd:ee:40',
            firstSeen: 100,
            lastSeen: 200,
        }])

        expect(merged).toHaveLength(2)
        expect(merged.map(d => d.presence).sort()).toEqual(['offline', 'online'])
    })
})
