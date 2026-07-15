import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    beginOperation,
    endOperation,
    getOperationSnapshot,
    invalidateOperation,
    resetOperationsForTests,
    updateOperation,
} from './operationRegistry.js'

describe('operation registry', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        resetOperationsForTests()
    })

    it('tracks typed progress for sidebar indicators', () => {
        const token = beginOperation('speed-test', {
            path: '/speedtest',
            kind: 'speed',
            label: 'Preparing speed test',
        })
        updateOperation('speed-test', token, { progress: 55, label: 'Testing download speed' })

        expect(getOperationSnapshot()['speed-test']).toMatchObject({
            status: 'running',
            path: '/speedtest',
            kind: 'speed',
            progress: 55,
        })
    })

    it('briefly retains completion before removing the indicator', () => {
        const token = beginOperation('lan-check', { path: '/lan-check', kind: 'check' })
        endOperation('lan-check', token, 'done', { progress: 100 })
        expect(getOperationSnapshot()['lan-check']).toMatchObject({ status: 'done', progress: 100 })

        vi.advanceTimersByTime(3500)
        expect(getOperationSnapshot()['lan-check']).toBeUndefined()
    })

    it('removes cancelled operations immediately', () => {
        const token = beginOperation('speed-test', { path: '/speedtest', kind: 'speed' })
        endOperation('speed-test', token, 'cancelled', { label: 'Speed test cancelled' })

        expect(getOperationSnapshot()['speed-test']).toBeUndefined()
    })

    it('rejects stale callbacks after a newer run takes ownership', () => {
        const oldToken = beginOperation('monitor', { label: 'Old run', progress: 0 })
        const currentToken = beginOperation('monitor', { label: 'Current run', progress: 1 })

        expect(updateOperation('monitor', oldToken, { label: 'Stale update', progress: 90 })).toBe(false)
        expect(endOperation('monitor', oldToken, 'done', { label: 'Stale completion' })).toBe(false)
        expect(getOperationSnapshot().monitor).toMatchObject({
            label: 'Current run',
            progress: 1,
            status: 'running',
        })

        expect(updateOperation('monitor', currentToken, { progress: 25 })).toBe(true)
        expect(endOperation('monitor', currentToken, 'done', { label: 'Current completion' })).toBe(true)
        expect(getOperationSnapshot().monitor).toMatchObject({
            label: 'Current completion',
            progress: 25,
            status: 'done',
        })
    })

    it('lets an application guard revoke the current owner explicitly', () => {
        const token = beginOperation('wan-check', { label: 'WAN check in progress' })

        expect(invalidateOperation('wan-check', 'error', { label: 'Network changed' })).toBe(true)
        expect(getOperationSnapshot()['wan-check']).toMatchObject({ status: 'error', label: 'Network changed' })
        expect(updateOperation('wan-check', token, { label: 'Late result' })).toBe(false)
        expect(endOperation('wan-check', token, 'done')).toBe(false)
    })
})
