import { describe, it, expect } from 'vitest'
import { diffSnapshots, summarizeDiff, stableKey, normalizeMac } from './deviceDiff'

describe('normalizeMac', () => {
    it('normalizes different casing and separators', () => {
        expect(normalizeMac('AA:BB:CC:DD:EE:01')).toBe('aabbccddee01')
        expect(normalizeMac('aa-bb-cc-dd-ee-01')).toBe('aabbccddee01')
        expect(normalizeMac('aabbccddee01')).toBe('aabbccddee01')
    })
    it('rejects invalid / broadcast / empty MACs', () => {
        expect(normalizeMac(null)).toBeNull()
        expect(normalizeMac('')).toBeNull()
        expect(normalizeMac('00:00:00:00:00:00')).toBeNull()
        expect(normalizeMac('ff:ff:ff:ff:ff:ff')).toBeNull()
        expect(normalizeMac('nope')).toBeNull()
    })
})

describe('stableKey', () => {
    it('prefers MAC when present', () => {
        expect(stableKey({ mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.1' }))
            .toBe('mac:aabbccddee01')
    })
    it('falls back to IP when MAC is missing or invalid', () => {
        expect(stableKey({ mac: null, ip: '10.0.0.1' })).toBe('ip:10.0.0.1')
        expect(stableKey({ mac: '00:00:00:00:00:00', ip: '10.0.0.2' })).toBe('ip:10.0.0.2')
    })
    it('returns null when nothing stable is available', () => {
        expect(stableKey({ mac: null, ip: null })).toBeNull()
    })
})

describe('diffSnapshots', () => {
    const prev = [
        { ip: '192.168.1.1', mac: 'aa:bb:cc:dd:ee:01', hostname: 'router', vendor: 'TP-Link', deviceType: 'Router' },
        { ip: '192.168.1.22', mac: 'aa:bb:cc:dd:ee:22', hostname: 'printer', vendor: 'HP', deviceType: 'Printer' },
        { ip: '192.168.1.100', mac: '11:22:33:44:55:66', hostname: 'ismael-pc', vendor: 'Dell', deviceType: 'Laptop' },
    ]

    it('returns empty diff for identical snapshots', () => {
        const d = diffSnapshots(prev, [...prev])
        expect(d.added).toEqual([])
        expect(d.removed).toEqual([])
        expect(d.modified).toEqual([])
    })

    it('returns empty when there is no previous snapshot (first scan)', () => {
        const d = diffSnapshots([], prev)
        expect(d.added).toEqual([])
        expect(d.removed).toEqual([])
        expect(d.modified).toEqual([])
    })

    it('detects new devices (added)', () => {
        const curr = [
            ...prev,
            { ip: '192.168.1.47', mac: 'de:ad:be:ef:00:01', hostname: 'new-cam', vendor: 'Hikvision', deviceType: 'Camera' },
        ]
        const d = diffSnapshots(prev, curr)
        expect(d.added).toHaveLength(1)
        expect(d.added[0].ip).toBe('192.168.1.47')
        expect(d.removed).toEqual([])
        expect(d.modified).toEqual([])
    })

    it('detects removed devices', () => {
        const curr = prev.slice(0, 2) // drop the laptop
        const d = diffSnapshots(prev, curr)
        expect(d.removed).toHaveLength(1)
        expect(d.removed[0].hostname).toBe('ismael-pc')
    })

    it('detects modified devices (hostname changed)', () => {
        const curr = prev.map(d => d.mac === '11:22:33:44:55:66'
            ? { ...d, hostname: 'ismael-laptop' } : d)
        const d = diffSnapshots(prev, curr)
        expect(d.modified).toHaveLength(1)
        expect(d.modified[0].changes).toContain('hostname')
        expect(d.modified[0].after.hostname).toBe('ismael-laptop')
    })

    it('detects IP moves (same MAC, different IP)', () => {
        const curr = prev.map(d => d.mac === 'aa:bb:cc:dd:ee:22'
            ? { ...d, ip: '192.168.1.23' } : d)
        const d = diffSnapshots(prev, curr)
        expect(d.modified).toHaveLength(1)
        expect(d.modified[0].changes).toContain('ip')
    })

    it('matches on IP when MAC is absent (both snapshots)', () => {
        const prevNoMac = [{ ip: '192.168.1.50', mac: null, hostname: 'old' }]
        const currNoMac = [{ ip: '192.168.1.50', mac: null, hostname: 'renamed' }]
        const d = diffSnapshots(prevNoMac, currNoMac)
        expect(d.modified).toHaveLength(1)
        expect(d.modified[0].changes).toContain('hostname')
    })

    it('treats empty MAC same as missing', () => {
        const prevEmpty = [{ ip: '10.0.0.5', mac: '00:00:00:00:00:00', hostname: 'host' }]
        const currEmpty = [{ ip: '10.0.0.5', mac: '00:00:00:00:00:00', hostname: 'host-2' }]
        const d = diffSnapshots(prevEmpty, currEmpty)
        expect(d.modified).toHaveLength(1)
    })
})

describe('summarizeDiff', () => {
    it('counts each category', () => {
        const diff = {
            added: [{}, {}],
            removed: [{}],
            modified: [{}, {}, {}],
        }
        expect(summarizeDiff(diff)).toEqual({ added: 2, removed: 1, modified: 3, total: 6 })
    })
    it('handles empty / null safely', () => {
        expect(summarizeDiff({})).toEqual({ added: 0, removed: 0, modified: 0, total: 0 })
        expect(summarizeDiff(null)).toEqual({ added: 0, removed: 0, modified: 0, total: 0 })
    })
})
