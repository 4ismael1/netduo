/**
 * Validates how LAN scan interprets OS neighbor-table states.
 *
 * Disconnected Windows devices can linger as Get-NetNeighbor=Stale. These
 * helpers decide which entries are worth an active retry and which should
 * remain cache-only evidence when they still do not answer.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const localRequire = createRequire(import.meta.url)
const {
    normalizeNeighborState,
    normalizeNetshNeighborState,
    isUsableNeighborState,
    shouldRetryNeighbor,
    mergeNeighborEntry,
} = localRequire('../electron/scanner/neighborPresence.js')

describe('scanner neighbor presence helpers', () => {
    it('normalizes neighbor states', () => {
        expect(normalizeNeighborState(' Reachable ')).toBe('reachable')
        expect(normalizeNeighborState('')).toBe('unknown')
        expect(normalizeNeighborState(null)).toBe('unknown')
    })

    it('normalizes localized netsh states', () => {
        expect(normalizeNetshNeighborState('Alcanzable')).toBe('reachable')
        expect(normalizeNetshNeighborState('Obsoleto')).toBe('stale')
        expect(normalizeNetshNeighborState('Inalcanzable')).toBe('unreachable')
        expect(normalizeNetshNeighborState('Permanente')).toBe('permanent')
    })

    it('rejects unusable terminal states', () => {
        expect(isUsableNeighborState('reachable')).toBe(true)
        expect(isUsableNeighborState('stale')).toBe(true)
        expect(isUsableNeighborState('incomplete')).toBe(false)
        expect(isUsableNeighborState('unreachable')).toBe(false)
        expect(isUsableNeighborState('invalid')).toBe(false)
        expect(isUsableNeighborState('failed')).toBe(false)
    })

    it('only retries active states and arp-only unknown entries', () => {
        expect(shouldRetryNeighbor({ state: 'reachable', source: 'netneighbor' })).toBe(true)
        expect(shouldRetryNeighbor({ state: 'delay', source: 'netneighbor' })).toBe(true)
        expect(shouldRetryNeighbor({ state: 'probe', source: 'netneighbor' })).toBe(true)
        expect(shouldRetryNeighbor({ state: 'permanent', source: 'netneighbor' })).toBe(true)
        expect(shouldRetryNeighbor({ state: 'unknown', source: 'arp' })).toBe(true)
        expect(shouldRetryNeighbor({ state: 'unknown', source: 'netsh' })).toBe(false)
        expect(shouldRetryNeighbor({ state: 'unknown', source: 'netneighbor' })).toBe(false)
        expect(shouldRetryNeighbor({ state: 'stale', source: 'netneighbor' })).toBe(true)
        expect(shouldRetryNeighbor({ state: 'stale', source: 'netsh' })).toBe(true)
        expect(shouldRetryNeighbor({ state: 'unreachable', source: 'netsh' })).toBe(false)
    })

    it('keeps the highest-quality neighbor entry', () => {
        const arp = { mac: 'aa:bb:cc:dd:ee:10', state: 'unknown', source: 'arp' }
        const stale = { mac: 'aa:bb:cc:dd:ee:10', state: 'stale', source: 'netneighbor' }
        const reachable = { mac: 'aa:bb:cc:dd:ee:10', state: 'reachable', source: 'netneighbor' }

        expect(mergeNeighborEntry(arp, stale)).toEqual(stale)
        expect(mergeNeighborEntry(stale, reachable)).toEqual(reachable)
        expect(mergeNeighborEntry(reachable, stale)).toEqual(reachable)
    })
})
