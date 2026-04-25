import { describe, it, expect } from 'vitest'
import { mergeScanWithInventory, primaryLabel, isHideableWhenOffline } from './deviceInventory'

describe('mergeScanWithInventory', () => {
    const scan = [
        { ip: '192.168.1.1', mac: 'aa:bb:cc:dd:ee:01', hostname: 'router', vendor: 'TP-Link', deviceType: 'Router', alive: true, isGateway: true },
        { ip: '192.168.1.22', mac: 'aa:bb:cc:dd:ee:22', hostname: 'laptop', vendor: 'Dell', deviceType: 'Laptop', alive: true },
    ]

    const inventory = [
        { deviceKey: 'mac:aabbccddee01', baseIP: '192.168.1', ip: '192.168.1.1', mac: 'aa:bb:cc:dd:ee:01', hostname: 'router', vendor: 'TP-Link', type: 'Router', nickname: 'Main Router', lastSeen: 1000, firstSeen: 500 },
        { deviceKey: 'mac:aabbccddee22', baseIP: '192.168.1', ip: '192.168.1.22', mac: 'aa:bb:cc:dd:ee:22', hostname: 'laptop', vendor: 'Dell', type: 'Laptop', lastSeen: 1500, firstSeen: 800 },
        { deviceKey: 'mac:aabbccddee99', baseIP: '192.168.1', ip: '192.168.1.99', mac: 'aa:bb:cc:dd:ee:99', hostname: 'printer', vendor: 'HP', type: 'Printer', lastSeen: 900, firstSeen: 400 },
    ]

    it('marks scanned devices as online', () => {
        const merged = mergeScanWithInventory(scan, inventory)
        const router = merged.find(d => d.ip === '192.168.1.1')
        expect(router.presence).toBe('online')
    })

    it('marks inventory-only devices as offline', () => {
        const merged = mergeScanWithInventory(scan, inventory)
        const printer = merged.find(d => d.ip === '192.168.1.99')
        expect(printer.presence).toBe('offline')
        expect(printer.alive).toBe(false)
    })

    it('preserves user nickname even when online', () => {
        const merged = mergeScanWithInventory(scan, inventory)
        const router = merged.find(d => d.ip === '192.168.1.1')
        expect(router.nickname).toBe('Main Router')
    })

    it('applies type override to deviceType but keeps raw type', () => {
        const inv = [{ deviceKey: 'mac:aabbccddee01', mac: 'aa:bb:cc:dd:ee:01', type: 'Router', typeOverride: 'Firewall', ip: '192.168.1.1', lastSeen: 1, firstSeen: 1 }]
        const merged = mergeScanWithInventory(scan.slice(0, 1), inv)
        expect(merged[0].deviceType).toBe('Firewall')
        expect(merged[0].rawDeviceType).toBe('Router')
    })

    it('marks devices flagged as new with presence = "new"', () => {
        const merged = mergeScanWithInventory(scan, inventory, new Set(['mac:aabbccddee22']))
        const laptop = merged.find(d => d.ip === '192.168.1.22')
        expect(laptop.presence).toBe('new')
    })

    it('works with empty inventory (first scan)', () => {
        const merged = mergeScanWithInventory(scan, [])
        expect(merged).toHaveLength(scan.length)
        merged.forEach(d => expect(d.presence).toBe('online'))
    })

    it('works with empty scan (nothing alive)', () => {
        const merged = mergeScanWithInventory([], inventory)
        expect(merged).toHaveLength(inventory.length)
        merged.forEach(d => expect(d.presence).toBe('offline'))
    })

    it('accepts an array as newKeySet', () => {
        const merged = mergeScanWithInventory(scan, [], ['mac:aabbccddee01'])
        const router = merged.find(d => d.ip === '192.168.1.1')
        expect(router.presence).toBe('new')
    })
})

describe('primaryLabel', () => {
    it('prefers nickname', () => {
        expect(primaryLabel({ nickname: 'Mi router', hostname: 'router', vendor: 'TP-Link' })).toBe('Mi router')
    })
    it('falls back to hostname', () => {
        expect(primaryLabel({ hostname: 'router', vendor: 'TP-Link' })).toBe('router')
    })
    it('falls back to vendor', () => {
        expect(primaryLabel({ vendor: 'Samsung' })).toBe('Samsung')
    })
    it('falls back to deviceType when vendor missing', () => {
        expect(primaryLabel({ deviceType: 'Randomized MAC' })).toBe('Randomized MAC')
        expect(primaryLabel({ deviceType: 'Network Device' })).toBe('Network Device')
    })
    it('does not use Unknown deviceType as label', () => {
        expect(primaryLabel({ deviceType: 'Unknown' })).toBe('Unknown Device')
    })
    it('labels gateway when nothing else', () => {
        expect(primaryLabel({ isGateway: true })).toBe('Gateway')
    })
    it('defaults to "Unknown Device"', () => {
        expect(primaryLabel({})).toBe('Unknown Device')
    })
})

describe('mergeScanWithInventory — offline flag re-derivation', () => {
    it('re-derives isRandomized for offline devices from their MAC', () => {
        const inventory = [{
            deviceKey: 'mac:5ea4420e4a77',
            baseIP: '192.168.1',
            ip: '192.168.1.113',
            mac: '5e:a4:42:0e:4a:77',
            hostname: null,
            vendor: null,
            type: 'Network Device',
            lastSeen: 1000,
            firstSeen: 500,
        }]
        const merged = mergeScanWithInventory([], inventory)
        expect(merged[0].isRandomized).toBe(true)
    })

    it('re-derives isGateway from .1 IP when offline', () => {
        const inventory = [{
            deviceKey: 'mac:aabbccddee01',
            baseIP: '192.168.1',
            ip: '192.168.1.1',
            mac: 'aa:bb:cc:dd:ee:01',
            type: 'Router',
            lastSeen: 1, firstSeen: 1,
        }]
        const merged = mergeScanWithInventory([], inventory)
        expect(merged[0].isGateway).toBe(true)
    })

    it('does not flag non-randomized MACs as randomized', () => {
        const inventory = [{
            deviceKey: 'mac:001122334455',
            baseIP: '192.168.1',
            ip: '192.168.1.77',
            mac: '00:11:22:33:44:55',
            lastSeen: 1, firstSeen: 1,
        }]
        const merged = mergeScanWithInventory([], inventory)
        expect(merged[0].isRandomized).toBe(false)
    })
})

describe('isHideableWhenOffline', () => {
    it('hides regular offline devices', () => {
        expect(isHideableWhenOffline({ presence: 'offline' })).toBe(true)
    })
    it('keeps online devices visible', () => {
        expect(isHideableWhenOffline({ presence: 'online' })).toBe(false)
    })
    it('keeps gateway visible even offline', () => {
        expect(isHideableWhenOffline({ presence: 'offline', isGateway: true })).toBe(false)
    })
    it('keeps local device visible even offline', () => {
        expect(isHideableWhenOffline({ presence: 'offline', isLocal: true })).toBe(false)
    })
})
