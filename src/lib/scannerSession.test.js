import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    abortScannerSession,
    beginScannerSession,
    finishScannerSession,
    getScannerSessionSnapshot,
    resetScannerSessionForTests,
    setScannerDevices,
    setScannerProgress,
    setScannerRunDevices,
    subscribeScannerSession,
} from './scannerSession'

describe('scanner session store', () => {
    beforeEach(() => resetScannerSessionForTests())

    it('keeps scan progress and results outside the Scanner route lifecycle', () => {
        const listener = vi.fn()
        const unsubscribe = subscribeScannerSession(listener)
        setScannerDevices([{ ip: '192.168.1.2', alive: true }])
        const scanId = beginScannerSession({ scopeLabel: '192.168.1.0/24', segments: [{ baseIP: '192.168.1', start: 1, end: 254 }] })
        setScannerProgress(50)
        setScannerRunDevices([{ ip: '192.168.1.1', alive: true }])

        expect(getScannerSessionSnapshot()).toMatchObject({
            scanning: true,
            progress: 50,
            scanMeta: { scopeLabel: '192.168.1.0/24' },
        })
        expect(getScannerSessionSnapshot().devices[0].ip).toBe('192.168.1.2')
        expect(getScannerSessionSnapshot().runDevices[0].ip).toBe('192.168.1.1')
        expect(finishScannerSession(scanId)).toBe(true)
        expect(getScannerSessionSnapshot().scanning).toBe(false)
        expect(getScannerSessionSnapshot().devices).toHaveLength(1)
        expect(getScannerSessionSnapshot().devices[0].ip).toBe('192.168.1.1')
        expect(getScannerSessionSnapshot().runDevices).toEqual([])
        expect(getScannerSessionSnapshot().completedMeta?.scopeLabel).toBe('192.168.1.0/24')
        expect(listener).toHaveBeenCalled()
        unsubscribe()
    })

    it('invalidates late scan work and can clear live presence on network change', () => {
        const scanId = beginScannerSession({ scopeLabel: '192.168.1.0/24' })
        setScannerRunDevices([{ ip: '192.168.1.10' }])
        expect(abortScannerSession({ clearDevices: true })).toBe(scanId)
        expect(finishScannerSession(scanId)).toBe(false)
        expect(getScannerSessionSnapshot()).toMatchObject({ scanning: false, progress: 0, devices: [] })
    })

    it('restores the last completed result when a re-scan is cancelled', () => {
        const completed = [{ ip: '192.168.1.20', alive: true }]
        setScannerDevices(completed)
        beginScannerSession({ scopeLabel: '192.168.1.0/24' })
        setScannerRunDevices([{ ip: '192.168.1.1', alive: true }])

        abortScannerSession()

        expect(getScannerSessionSnapshot().devices).toEqual(completed)
        expect(getScannerSessionSnapshot().runDevices).toEqual([])
    })
})
