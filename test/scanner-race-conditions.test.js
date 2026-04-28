// @vitest-environment node
/**
 * Audits Scanner async race guards with static source checks.
 *
 * The scan/detail flows are difficult to unit-test without exporting helpers,
 * so this file guards the high-risk await->setState regions until the logic is
 * extracted into smaller testable functions.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const scannerSource = fs.readFileSync(path.join(process.cwd(), 'src/pages/Scanner/Scanner.jsx'), 'utf8')

function sliceBetween(startNeedle, endNeedle) {
    const start = scannerSource.indexOf(startNeedle)
    const end = scannerSource.indexOf(endNeedle, start + startNeedle.length)
    return scannerSource.slice(start, end > start ? end : undefined)
}

describe('Scanner race-condition guards', () => {
    it('checks scanRunRef after each post-sweep persistence await before setting state', () => {
        const persistenceBlock = sliceBetween('await bridge.deviceSnapshotAdd', '} catch { /* tracking is best-effort */ }')
        const setStateCalls = ['setNewDeviceKeys', 'setInventory']

        for (const call of setStateCalls) {
            const callIndex = persistenceBlock.indexOf(call)
            expect(callIndex).toBeGreaterThan(-1)
            const beforeCall = persistenceBlock.slice(0, callIndex)
            expect(beforeCall).toMatch(/scanRunRef\.current\s*!==\s*scanId/)
        }
    })

    it('guards stale detail diagnostics before writing detailData', () => {
        const detailBlock = sliceBetween('async function openDetail', '/* Merge live scan')
        expect(detailBlock).toMatch(/if \(detailRunRef\.current !== runId\) return/)
        expect(detailBlock.indexOf('if (detailRunRef.current !== runId) return')).toBeLessThan(detailBlock.indexOf('setDetailData(extra)'))
    })

    it('uses the captured scan options for every LAN scan batch', () => {
        const scanBlock = sliceBetween('async function startScan', 'function stopScan')
        expect(scanBlock).toMatch(/const scanId = scanRunRef\.current \+ 1/)
        expect(scanBlock).toContain('const scanGatewayIp = net.gateway || null')
        expect(scanBlock).toContain('bridge.lanScan(safeBaseIP, s, e, { safeMode, gatewayIp: scanGatewayIp })')
        expect(scanBlock.indexOf('bridge.lanScan')).toBeGreaterThan(scanBlock.indexOf('const scanId'))
    })
})
