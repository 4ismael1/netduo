/**
 * subnet.test.js
 * Tests for the subnet calculation logic extracted from SubnetTool in Tools.jsx
 */
import { describe, it, expect } from 'vitest'

// ─── Subnet calculator (pure function extracted for testing) ──────────────
function calcSubnet(cidr) {
    const [ip, prefix] = cidr.split('/')
    const pl = parseInt(prefix)
    if (isNaN(pl) || pl < 0 || pl > 32) throw new Error('Invalid prefix')
    const ipParts = ip.split('.').map(Number)
    if (ipParts.length !== 4 || ipParts.some(p => isNaN(p) || p < 0 || p > 255)) throw new Error('Invalid IP')
    const mask = pl === 0 ? 0 : (~0 << (32 - pl)) >>> 0
    const ipInt = ipParts.reduce((acc, p) => (acc << 8) | p, 0) >>> 0
    const netInt = (ipInt & mask) >>> 0
    const bcastInt = (netInt | (~mask >>> 0)) >>> 0
    const firstHost = pl < 31 ? (netInt + 1) >>> 0 : netInt
    const lastHost = pl < 31 ? (bcastInt - 1) >>> 0 : bcastInt
    const hosts = pl < 31 ? Math.pow(2, 32 - pl) - 2 : pl === 31 ? 2 : 1
    const toIP = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
    return {
        network: toIP(netInt),
        broadcast: toIP(bcastInt),
        mask: toIP(mask),
        wildcard: toIP(~mask >>> 0),
        first: toIP(firstHost),
        last: toIP(lastHost),
        hosts,
        prefix: pl,
    }
}

// ── /24 networks ──────────────────────────────────────────────────────────
describe('Subnet Calculator — /24', () => {
    let result
    beforeAll(() => { result = calcSubnet('192.168.1.0/24') })

    it('network address is correct', () => expect(result.network).toBe('192.168.1.0'))
    it('broadcast address is correct', () => expect(result.broadcast).toBe('192.168.1.255'))
    it('subnet mask is correct', () => expect(result.mask).toBe('255.255.255.0'))
    it('wildcard mask is correct', () => expect(result.wildcard).toBe('0.0.0.255'))
    it('first host is correct', () => expect(result.first).toBe('192.168.1.1'))
    it('last host is correct', () => expect(result.last).toBe('192.168.1.254'))
    it('host count is 254', () => expect(result.hosts).toBe(254))
    it('prefix length is 24', () => expect(result.prefix).toBe(24))
})

// ── /16 networks ──────────────────────────────────────────────────────────
describe('Subnet Calculator — /16', () => {
    let result
    beforeAll(() => { result = calcSubnet('10.0.0.0/16') })

    it('network address is 10.0.0.0', () => expect(result.network).toBe('10.0.0.0'))
    it('broadcast is 10.0.255.255', () => expect(result.broadcast).toBe('10.0.255.255'))
    it('mask is 255.255.0.0', () => expect(result.mask).toBe('255.255.0.0'))
    it('65534 usable hosts', () => expect(result.hosts).toBe(65534))
    it('first host is 10.0.0.1', () => expect(result.first).toBe('10.0.0.1'))
    it('last host is 10.0.255.254', () => expect(result.last).toBe('10.0.255.254'))
})

// ── /32 (single host) ─────────────────────────────────────────────────────
describe('Subnet Calculator — /32 single host', () => {
    let result
    beforeAll(() => { result = calcSubnet('192.168.1.1/32') })

    it('network equals broadcast for /32', () => expect(result.network).toBe(result.broadcast))
    it('exactly 1 host', () => expect(result.hosts).toBe(1))
    it('mask is 255.255.255.255', () => expect(result.mask).toBe('255.255.255.255'))
})

// ── /31 (point-to-point) ──────────────────────────────────────────────────
describe('Subnet Calculator — /31 point-to-point', () => {
    let result
    beforeAll(() => { result = calcSubnet('192.168.1.0/31') })

    it('exactly 2 hosts', () => expect(result.hosts).toBe(2))
})

// ── /0 (full internet) ────────────────────────────────────────────────────
describe('Subnet Calculator — /0', () => {
    it('network is 0.0.0.0', () => {
        const r = calcSubnet('0.0.0.0/0')
        expect(r.network).toBe('0.0.0.0')
    })
    it('broadcast is 255.255.255.255', () => {
        const r = calcSubnet('0.0.0.0/0')
        expect(r.broadcast).toBe('255.255.255.255')
    })
    it('mask is 0.0.0.0', () => {
        const r = calcSubnet('0.0.0.0/0')
        expect(r.mask).toBe('0.0.0.0')
    })
})

// ── Error handling ────────────────────────────────────────────────────────
describe('Subnet Calculator — error cases', () => {
    it('throws on prefix > 32', () => expect(() => calcSubnet('192.168.1.0/33')).toThrow())
    it('throws on negative prefix', () => expect(() => calcSubnet('192.168.1.0/-1')).toThrow())
    it('throws on invalid IP octets', () => expect(() => calcSubnet('999.168.1.0/24')).toThrow())
    it('throws on non-numeric prefix', () => expect(() => calcSubnet('192.168.1.0/abc')).toThrow())
})

// ── network alignment ─────────────────────────────────────────────────────
describe('Subnet Calculator — host IPs resolve to same network', () => {
    it('192.168.1.50/24 has same network as 192.168.1.0/24', () => {
        const r = calcSubnet('192.168.1.50/24')
        expect(r.network).toBe('192.168.1.0')
    })

    it('172.16.5.200/12 resolves to 172.16.0.0', () => {
        const r = calcSubnet('172.16.5.200/12')
        expect(r.network).toBe('172.16.0.0')
    })
})
