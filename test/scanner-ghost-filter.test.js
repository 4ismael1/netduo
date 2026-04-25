/**
 * Audits the Scanner proxy-ARP ghost-filter contract against the pure
 * function now living at electron/scanner/ghostFilter.js. The filter is
 * deterministic — no thresholds, no batch sensitivity — so unit tests
 * are the right place to pin every edge case.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const localRequire = createRequire(import.meta.url)
const { filterGhosts } = localRequire('../electron/scanner/ghostFilter.js')

// Alias so the pre-existing test body keeps reading naturally.
const currentProductionGhostFilter = (rows) => filterGhosts(rows)

const row = (ip, overrides = {}) => ({
    ip,
    alive: true,
    mac: '10:20:30:40:50:60',
    macEmpty: false,
    isGateway: false,
    isLocal: false,
    ...overrides,
})

const ips = rows => currentProductionGhostFilter(rows).map(r => r.ip)

describe('Scanner proxy-ARP ghost filter', () => {
    it('keeps a clean LAN with unique MACs', () => {
        expect(ips([
            row('192.168.1.1', { isGateway: true, mac: 'aa:bb:cc:dd:ee:01' }),
            row('192.168.1.10', { mac: 'aa:bb:cc:dd:ee:10' }),
            row('192.168.1.20', { mac: 'aa:bb:cc:dd:ee:20' }),
        ])).toEqual(['192.168.1.1', '192.168.1.10', '192.168.1.20'])
    })

    it('keeps only the gateway when proxy-ARP replies reuse the gateway MAC', () => {
        expect(ips([
            row('192.168.1.1', { isGateway: true, mac: 'aa:bb:cc:dd:ee:01' }),
            row('192.168.1.40', { mac: 'aa:bb:cc:dd:ee:01' }),
            row('192.168.1.41', { mac: 'aa:bb:cc:dd:ee:01' }),
            row('192.168.1.42', { mac: 'aa:bb:cc:dd:ee:01' }),
        ])).toEqual(['192.168.1.1'])
    })

    it('drops alive non-local MAC-less replies as Rule A ghosts', () => {
        expect(ips([
            row('192.168.1.1', { isGateway: true, mac: 'aa:bb:cc:dd:ee:01' }),
            row('192.168.1.99', { mac: null, macEmpty: true }),
        ])).toEqual(['192.168.1.1'])
    })

    it('preserves the local device even when MAC-less', () => {
        expect(ips([
            row('192.168.1.44', { isLocal: true, mac: null, macEmpty: true }),
        ])).toEqual(['192.168.1.44'])
    })

    it('drops a MAC-less host even when flagged isGateway (proxy-ARP phantom at .254)', () => {
        // The `isGateway` flag in scan output is only the `.1`/`.254`
        // octet heuristic — not authoritative. A real gateway replies
        // to ICMP AND leaves its MAC in the ARP cache. A MAC-less
        // "gateway" candidate is a proxy-ARP phantom (the router
        // answering for an unused IP like .254). Rule A drops it.
        expect(ips([
            row('192.168.1.1', { isGateway: true, mac: 'aa:bb:cc:dd:ee:01' }), // real
            row('192.168.1.254', { isGateway: true, mac: null, macEmpty: true }), // phantom
        ])).toEqual(['192.168.1.1'])
    })

    it('drops a standalone MAC-less host even if it happens to be isGateway=true', () => {
        // Edge case: scan returned ONLY the .254 heuristic-gateway with
        // no real `.1` survivor. Still a phantom — the filter is
        // deterministic, not "preserve one of each".
        expect(ips([
            row('192.168.1.254', { isGateway: true, mac: null, macEmpty: true }),
        ])).toEqual([])
    })

    it('drops a non-gateway device with the gateway MAC', () => {
        expect(ips([
            row('192.168.1.1', { isGateway: true, mac: 'aa:bb:cc:dd:ee:01' }),
            row('192.168.1.88', { mac: 'aa:bb:cc:dd:ee:01' }),
        ])).toEqual(['192.168.1.1'])
    })

    it('is case-insensitive for colon-formatted MACs', () => {
        expect(ips([
            row('192.168.1.1', { isGateway: true, mac: 'AA:BB:CC:DD:EE:01' }),
            row('192.168.1.50', { mac: 'aa:bb:cc:dd:ee:01' }),
        ])).toEqual(['192.168.1.1'])
    })

    it('normalizes dash and colon MAC formats for Rule B', () => {
        expect(ips([
            row('192.168.1.1', { isGateway: true, mac: 'AA-BB-CC-DD-EE-01' }),
            row('192.168.1.51', { mac: 'aa:bb:cc:dd:ee:01' }),
        ])).toEqual(['192.168.1.1'])
    })

    it('keeps offline seen-only rows because they are inventory context, not alive ghosts', () => {
        expect(ips([
            row('192.168.1.1', { isGateway: true, mac: 'aa:bb:cc:dd:ee:01' }),
            row('192.168.1.77', { alive: false, mac: null, macEmpty: true, seenOnly: true }),
        ])).toEqual(['192.168.1.1', '192.168.1.77'])
    })

    it('handles an empty LAN without crashing', () => {
        expect(currentProductionGhostFilter([])).toEqual([])
    })

    it('keeps a single real device with a MAC', () => {
        expect(ips([row('192.168.1.25', { mac: 'de:ad:be:ef:00:25' })])).toEqual(['192.168.1.25'])
    })

    it('drops a batch containing only ghosts', () => {
        expect(ips([
            row('192.168.1.30', { mac: null, macEmpty: true }),
            row('192.168.1.31', { mac: null, macEmpty: true }),
        ])).toEqual([])
    })

    it('keeps a batch containing only the gateway', () => {
        expect(ips([
            row('192.168.1.1', { isGateway: true, mac: 'aa:bb:cc:dd:ee:01' }),
        ])).toEqual(['192.168.1.1'])
    })

    it('does not depend on safe-mode thresholds', () => {
        const rows = [
            row('192.168.1.1', { isGateway: true, mac: 'aa:bb:cc:dd:ee:01' }),
            row('192.168.1.2', { mac: 'aa:bb:cc:dd:ee:01' }),
            row('192.168.1.3', { mac: '10:20:30:40:50:60' }),
        ]
        expect(ips(rows)).toEqual(['192.168.1.1', '192.168.1.3'])
    })

    it('keeps multiple routers with distinct MACs in a mesh LAN', () => {
        expect(ips([
            row('192.168.1.1', { isGateway: true, mac: 'aa:bb:cc:dd:ee:01' }),
            row('192.168.1.2', { mac: 'aa:bb:cc:dd:ee:02' }),
            row('192.168.1.3', { mac: 'aa:bb:cc:dd:ee:03' }),
        ])).toEqual(['192.168.1.1', '192.168.1.2', '192.168.1.3'])
    })

    it('keeps an alive device when there is no gateway MAC to compare against', () => {
        expect(ips([
            row('192.168.1.20', { mac: 'aa:bb:cc:dd:ee:20' }),
        ])).toEqual(['192.168.1.20'])
    })
})
