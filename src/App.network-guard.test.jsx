import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationNetworkGuard } from './App.jsx'
import { beginOperation, getOperationSnapshot, resetOperationsForTests } from './lib/operationRegistry.js'
import {
    getSessionRef,
    getSessionSnapshot,
    resetPersistentSessionsForTests,
    setSessionValue,
} from './lib/persistentSession.js'
import {
    beginScannerSession,
    getScannerSessionSnapshot,
    resetScannerSessionForTests,
    setScannerDevices,
} from './lib/scannerSession.js'

const mocks = vi.hoisted(() => ({
    network: {
        loading: false,
        networkEpoch: 10,
        wifi: { bssid: 'AA:BB:CC:DD:EE:FF', signal: 75 },
    },
    bridge: {
        lanScanCancel: vi.fn(),
        lanSecurityScanCancel: vi.fn(),
        offPingLive: vi.fn(),
        offTraceroute: vi.fn(),
        stopMtr: vi.fn(),
        stopPortScan: vi.fn(),
        stopSpeedTest: vi.fn(),
    },
}))

vi.mock('./lib/useNetworkStatus.jsx', () => ({
    default: () => mocks.network,
    NetworkStatusProvider: ({ children }) => children,
}))

vi.mock('./lib/electronBridge.js', () => ({ default: mocks.bridge }))

describe('operation network epoch guard', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetOperationsForTests()
        resetPersistentSessionsForTests()
        resetScannerSessionForTests()
        mocks.network = {
            loading: false,
            networkEpoch: 10,
            wifi: { bssid: 'AA:BB:CC:DD:EE:FF', signal: 75 },
        }
    })

    it('ignores Wi-Fi telemetry churn but revokes an in-flight run on a new authoritative epoch', () => {
        const view = render(<OperationNetworkGuard />)
        const token = beginOperation('speed-test', { status: 'running' })
        getSessionRef('speed-test', 'operationToken', null).current = token
        setSessionValue('speed-test', 'phase', 'downloading')
        setSessionValue('monitor', 'running', true)
        setSessionValue('monitor', 'data', [{ t: 'old-route', '1.1.1.1': 20 }])
        setSessionValue('monitor', 'stats', { '1.1.1.1': { count: 1 } })
        setScannerDevices([{ ip: '192.168.1.20', hostname: 'Known device' }])

        mocks.network = {
            ...mocks.network,
            wifi: { ...mocks.network.wifi, signal: 61 },
        }
        view.rerender(<OperationNetworkGuard />)

        expect(mocks.bridge.stopSpeedTest).not.toHaveBeenCalled()
        expect(getOperationSnapshot()['speed-test']?.status).toBe('running')
        expect(getSessionSnapshot('monitor').data).toHaveLength(1)

        mocks.network = {
            ...mocks.network,
            networkEpoch: 11,
            isVpn: true,
        }
        view.rerender(<OperationNetworkGuard />)

        expect(mocks.bridge.stopSpeedTest).toHaveBeenCalledTimes(1)
        expect(getSessionSnapshot('speed-test')).toMatchObject({ phase: 'error', cancelling: false })
        expect(getSessionRef('speed-test', 'operationToken', null).current).toBeNull()
        expect(getOperationSnapshot()['speed-test']).toMatchObject({
            status: 'error',
            label: 'Speed test stopped because the network changed',
        })
        expect(getSessionSnapshot('monitor')).toMatchObject({ running: true, data: [], stats: {} })
        expect(mocks.bridge.lanScanCancel).not.toHaveBeenCalled()
        expect(getScannerSessionSnapshot().devices).toEqual([
            { ip: '192.168.1.20', hostname: 'Known device' },
        ])
    })

    it('stops route-bound diagnostics and DNS benchmarking with explicit epoch errors', () => {
        const view = render(<OperationNetworkGuard />)

        const tracerouteToken = beginOperation('diagnostics-traceroute', { status: 'running' })
        getSessionRef('diagnostics-traceroute', 'operationToken', null).current = tracerouteToken
        setSessionValue('diagnostics-traceroute', 'running', true)

        const pingToken = beginOperation('diagnostics-ping', { status: 'running' })
        getSessionRef('diagnostics-ping', 'operationToken', null).current = pingToken
        setSessionValue('diagnostics-ping', 'running', true)

        const portToken = beginOperation('diagnostics-ports', { status: 'running' })
        const portControl = { id: 1, cancelled: false, operationToken: portToken }
        getSessionRef('diagnostics-ports', 'scanControl', null).current = portControl
        setSessionValue('diagnostics-ports', 'loading', true)

        const mtrToken = beginOperation('diagnostics-mtr', { status: 'running' })
        getSessionRef('diagnostics-mtr', 'operationToken', null).current = mtrToken
        setSessionValue('diagnostics-mtr', 'session', 'mtr-session-1')

        const dnsToken = beginOperation('tools-dns-benchmark', { status: 'running' })
        getSessionRef('tools-dns-benchmark', 'operationToken', null).current = dnsToken
        getSessionRef('tools-dns-benchmark', 'run', 0).current = 7
        setSessionValue('tools-dns-benchmark', 'running', true)
        setSessionValue('tools-dns-benchmark', 'results', [{ label: 'Old route' }])

        mocks.network = { ...mocks.network, networkEpoch: 11 }
        view.rerender(<OperationNetworkGuard />)

        expect(mocks.bridge.offTraceroute).toHaveBeenCalledTimes(1)
        expect(mocks.bridge.offPingLive).toHaveBeenCalledTimes(1)
        expect(mocks.bridge.stopPortScan).toHaveBeenCalledTimes(1)
        expect(mocks.bridge.stopMtr).toHaveBeenCalledWith('mtr-session-1')
        expect(portControl.cancelled).toBe(true)
        expect(getSessionSnapshot('diagnostics-traceroute')).toMatchObject({ running: false, error: expect.stringMatching(/network route changed/i) })
        expect(getSessionSnapshot('diagnostics-ping')).toMatchObject({ running: false, error: expect.stringMatching(/network route changed/i) })
        expect(getSessionSnapshot('diagnostics-ports')).toMatchObject({ loading: false, error: expect.stringMatching(/network route changed/i) })
        expect(getSessionSnapshot('diagnostics-mtr')).toMatchObject({ session: null, loading: false, error: expect.stringMatching(/network route changed/i) })
        expect(getSessionRef('tools-dns-benchmark', 'run', 0).current).toBe(8)
        expect(getSessionSnapshot('tools-dns-benchmark')).toMatchObject({
            running: false,
            results: null,
            error: expect.stringMatching(/network route changed/i),
        })

        for (const operationId of [
            'diagnostics-traceroute',
            'diagnostics-ping',
            'diagnostics-ports',
            'diagnostics-mtr',
            'tools-dns-benchmark',
        ]) {
            expect(getOperationSnapshot()[operationId]?.status).toBe('error')
        }
    })

    it('stops an active LAN sweep on a route epoch without erasing the last completed list', () => {
        const view = render(<OperationNetworkGuard />)
        setScannerDevices([{ ip: '192.168.1.40', hostname: 'Printer' }])
        const scanId = beginScannerSession({ scopeLabel: '192.168.1.0/24' })

        mocks.network = { ...mocks.network, networkEpoch: 11, isVpn: true }
        view.rerender(<OperationNetworkGuard />)

        expect(mocks.bridge.lanScanCancel).toHaveBeenCalledWith(scanId)
        expect(getScannerSessionSnapshot()).toMatchObject({
            scanning: false,
            devices: [{ ip: '192.168.1.40', hostname: 'Printer' }],
        })
    })
})
