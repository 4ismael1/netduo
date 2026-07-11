// @vitest-environment node
/**
 * Guards the normal Scanner profile.
 *
 * Balanced/deep profiles preheat neighbors, while only Deep performs the
 * extra all-silent wake pass. Safe/quick/passive remain conservative.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.join(process.cwd(), 'electron', 'main.js'), 'utf8')

describe('Scanner normal scan profile', () => {
    it('performs the icmp-wake pass only for deep discovery inside non-safe preheat', () => {
        const preheatStart = source.indexOf("if (!safeMode && (discoveryMode === 'balanced' || discoveryMode === 'deep')) {")
        const preheatEnd = source.indexOf('// Phase 2.5:', preheatStart)
        expect(preheatStart).toBeGreaterThan(-1)
        expect(preheatEnd).toBeGreaterThan(preheatStart)

        const preheatBlock = source.slice(preheatStart, preheatEnd)
        expect(preheatBlock).toContain("await preheatNeighborCache(silentTargets)")
        expect(preheatBlock).toContain("'icmp-wake'")
        expect(preheatBlock).toContain("if (discoveryMode === 'deep' && silentTargets.length)")
        expect(preheatBlock).toMatch(/parallelMap\(silentTargets[\s\S]+PING_CONCURRENCY/)
    })
})
