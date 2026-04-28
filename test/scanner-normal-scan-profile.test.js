// @vitest-environment node
/**
 * Guards the normal Scanner profile.
 *
 * The default profile should do one lightweight wake retry after neighbor
 * preheat to catch Wi-Fi power-save clients, while Safe Scan must skip that
 * traffic and stay conservative.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.join(process.cwd(), 'electron', 'main.js'), 'utf8')

describe('Scanner normal scan profile', () => {
    it('performs the icmp-wake pass only inside the non-safe preheat block', () => {
        const preheatStart = source.indexOf('if (!safeMode) {')
        const preheatEnd = source.indexOf('// Phase 2.5:', preheatStart)
        expect(preheatStart).toBeGreaterThan(-1)
        expect(preheatEnd).toBeGreaterThan(preheatStart)

        const preheatBlock = source.slice(preheatStart, preheatEnd)
        expect(preheatBlock).toContain("await preheatNeighborCache(silentTargets)")
        expect(preheatBlock).toContain("'icmp-wake'")
        expect(preheatBlock).toMatch(/parallelMap\(silentTargets[\s\S]+PING_CONCURRENCY/)
    })
})
