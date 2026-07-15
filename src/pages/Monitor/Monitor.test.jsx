import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Monitor from './Monitor.jsx'
import bridge from '../../lib/electronBridge.js'
import { getSessionRef, getSessionSnapshot, resetPersistentSessionsForTests } from '../../lib/persistentSession.js'
import { resetOperationsForTests } from '../../lib/operationRegistry.js'

vi.mock('recharts', () => {
    const Component = ({ children }) => <div>{children}</div>
    return {
        LineChart: Component,
        Line: Component,
        XAxis: Component,
        YAxis: Component,
        Tooltip: Component,
        ResponsiveContainer: Component,
        CartesianGrid: Component,
        Legend: Component,
        ReferenceLine: Component,
    }
})

vi.mock('../../lib/useNetworkStatus.jsx', () => ({
    default: () => ({
        connected: true,
        isVpn: false,
        isEthernet: false,
        isWifi: true,
        ifaceName: 'Wi-Fi',
        localIP: '192.168.1.20',
        gateway: '192.168.1.1',
    }),
}))

vi.mock('../../lib/electronBridge.js', () => ({
    default: {
        configGetPublic: vi.fn(() => Promise.resolve({})),
        configGet: vi.fn(() => Promise.resolve(null)),
        configSet: vi.fn(() => Promise.resolve(true)),
        onConfigChanged: vi.fn(() => () => {}),
        pingSingle: vi.fn(),
    },
}))

function deferred() {
    let resolve
    const promise = new Promise(next => { resolve = next })
    return { promise, resolve }
}

function queueDeferredPings() {
    const pending = []
    bridge.pingSingle.mockImplementation(() => {
        const item = deferred()
        pending.push(item)
        return item.promise
    })
    return pending
}

async function resolveAll(items, value = { time: 10 }) {
    const batch = items.splice(0)
    await act(async () => {
        batch.forEach(item => item.resolve(value))
        await Promise.resolve()
        await Promise.resolve()
    })
}

describe('Monitor run ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        resetPersistentSessionsForTests()
        resetOperationsForTests()
    })

    it('does not let a stopped run schedule a second loop after restart', async () => {
        const pending = queueDeferredPings()
        render(<Monitor />)

        fireEvent.click(screen.getByRole('button', { name: /Start Monitor/i }))
        expect(bridge.pingSingle).toHaveBeenCalledTimes(2)
        fireEvent.click(screen.getByRole('button', { name: /^Stop$/i }))
        fireEvent.click(screen.getByRole('button', { name: /Start Monitor/i }))
        expect(bridge.pingSingle).toHaveBeenCalledTimes(4)

        await resolveAll(pending)
        await act(async () => { vi.advanceTimersByTime(2000) })

        expect(bridge.pingSingle).toHaveBeenCalledTimes(6)
    })

    it('restarts with the newly-added host without keeping the old loop alive', async () => {
        const pending = queueDeferredPings()
        render(<Monitor />)
        fireEvent.click(screen.getByRole('button', { name: /Start Monitor/i }))

        fireEvent.change(screen.getByPlaceholderText('Add host (IP or domain)'), { target: { value: '9.9.9.9' } })
        fireEvent.click(screen.getByRole('button', { name: /Add Host/i }))

        expect(bridge.pingSingle.mock.calls.slice(-3).map(([host]) => host)).toEqual([
            '1.1.1.1',
            '8.8.8.8',
            '9.9.9.9',
        ])

        await resolveAll(pending)
        await act(async () => { vi.advanceTimersByTime(2000) })

        expect(bridge.pingSingle).toHaveBeenCalledTimes(8)
        expect(bridge.pingSingle.mock.calls.slice(-3).map(([host]) => host)).toEqual([
            '1.1.1.1',
            '8.8.8.8',
            '9.9.9.9',
        ])
    })

    it('discards a tick from the previous network epoch and continues on the new route', async () => {
        const pending = queueDeferredPings()
        const epochRef = getSessionRef('network-runtime', 'epoch', 20)
        render(<Monitor />)
        fireEvent.click(screen.getByRole('button', { name: /Start Monitor/i }))

        epochRef.current = 21
        await resolveAll(pending, { time: 88 })
        expect(getSessionSnapshot('monitor').data).toEqual([])
        expect(getSessionSnapshot('monitor').stats).toEqual({})

        await act(async () => { vi.advanceTimersByTime(2000) })
        expect(bridge.pingSingle).toHaveBeenCalledTimes(4)
        await resolveAll(pending, { time: 12 })
        expect(getSessionSnapshot('monitor').data).toHaveLength(1)
        expect(getSessionSnapshot('monitor').data[0]['1.1.1.1']).toBe(12)
    })
})
