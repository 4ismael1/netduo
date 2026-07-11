import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    beginOperation,
    endOperation,
    getOperationSnapshot,
    resetOperationsForTests,
    updateOperation,
} from './operationRegistry.js'

describe('operation registry', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        resetOperationsForTests()
    })

    it('tracks typed progress for sidebar indicators', () => {
        beginOperation('speed-test', {
            path: '/speedtest',
            kind: 'speed',
            label: 'Preparing speed test',
        })
        updateOperation('speed-test', { progress: 55, label: 'Testing download speed' })

        expect(getOperationSnapshot()['speed-test']).toMatchObject({
            status: 'running',
            path: '/speedtest',
            kind: 'speed',
            progress: 55,
        })
    })

    it('briefly retains completion before removing the indicator', () => {
        beginOperation('lan-check', { path: '/lan-check', kind: 'check' })
        endOperation('lan-check', 'done', { progress: 100 })
        expect(getOperationSnapshot()['lan-check']).toMatchObject({ status: 'done', progress: 100 })

        vi.advanceTimersByTime(3500)
        expect(getOperationSnapshot()['lan-check']).toBeUndefined()
    })

    it('removes cancelled operations immediately', () => {
        beginOperation('speed-test', { path: '/speedtest', kind: 'speed' })
        endOperation('speed-test', 'cancelled', { label: 'Speed test cancelled' })

        expect(getOperationSnapshot()['speed-test']).toBeUndefined()
    })
})
