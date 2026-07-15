import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SpeedTest from './SpeedTest.jsx'
import bridge from '../../lib/electronBridge.js'
import { resetOperationsForTests } from '../../lib/operationRegistry.js'
import { resetPersistentSessionsForTests } from '../../lib/persistentSession.js'

vi.mock('../../lib/useSmoothValue.js', () => ({
    useSmoothValue: value => Number(value) || 0,
}))

vi.mock('../../lib/electronBridge.js', () => ({
    default: {
        speedHistoryGet: vi.fn(() => Promise.resolve([])),
        speedGetServers: vi.fn(() => Promise.resolve([{ id: 'mlab', name: 'M-Lab' }])),
        onSpeedProgress: vi.fn(),
        speedTestFull: vi.fn(),
        speedHistoryAdd: vi.fn(() => Promise.resolve([])),
        historyAdd: vi.fn(() => Promise.resolve([])),
        stopSpeedTest: vi.fn(),
    },
}))

function deferred() {
    let resolve
    const promise = new Promise(next => { resolve = next })
    return { promise, resolve }
}

describe('Speed Test run ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetOperationsForTests()
        resetPersistentSessionsForTests()
    })

    it('persists the specialized result once when done progress precedes the IPC result', async () => {
        const result = {
            download: 500,
            upload: 100,
            latency: 8,
            jitter: 2,
            server: { id: 'mlab', name: 'M-Lab' },
        }
        const completion = deferred()
        let progressHandler
        bridge.onSpeedProgress.mockImplementation(handler => {
            progressHandler = handler
            return vi.fn()
        })
        bridge.speedTestFull.mockReturnValue(completion.promise)

        render(<SpeedTest />)
        fireEvent.click(screen.getByRole('button', { name: /Start Test/i }))

        act(() => { progressHandler({ phase: 'done', result }) })
        expect(screen.getByRole('button', { name: /Test Again/i })).toBeEnabled()

        await act(async () => {
            completion.resolve(result)
            await completion.promise
        })

        await waitFor(() => expect(bridge.speedHistoryAdd).toHaveBeenCalledTimes(1))
        expect(bridge.historyAdd).not.toHaveBeenCalled()
    })

    it('returns to idle when cancellation is reported only by the IPC result and ignores late progress', async () => {
        const completion = deferred()
        let progressHandler
        bridge.onSpeedProgress.mockImplementation(handler => {
            progressHandler = handler
            return vi.fn()
        })
        bridge.speedTestFull.mockReturnValue(completion.promise)

        render(<SpeedTest />)
        fireEvent.click(screen.getByRole('button', { name: /Start Test/i }))
        fireEvent.click(screen.getByTitle('Cancel test'))
        expect(bridge.stopSpeedTest).toHaveBeenCalledTimes(1)

        await act(async () => {
            completion.resolve({ error: 'cancelled' })
            await completion.promise
        })

        expect(screen.getByRole('button', { name: /Start Test/i })).toBeEnabled()
        act(() => { progressHandler({ phase: 'downloading', avgSpeed: 99, progress: 50 }) })
        expect(screen.getByRole('button', { name: /Start Test/i })).toBeEnabled()
        expect(bridge.speedHistoryAdd).not.toHaveBeenCalled()
    })
})
