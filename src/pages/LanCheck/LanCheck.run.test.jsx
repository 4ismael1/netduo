import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LanCheck from './LanCheck.jsx'
import bridge from '../../lib/electronBridge.js'
import { resetOperationsForTests } from '../../lib/operationRegistry.js'
import { resetPersistentSessionsForTests } from '../../lib/persistentSession.js'

const mocks = vi.hoisted(() => ({ network: { current: null } }))

vi.mock('framer-motion', () => {
    const Component = ({ children, initial, animate, exit, transition, ...rest }) => {
        void initial; void animate; void exit; void transition
        return <div {...rest}>{children}</div>
    }
    return {
        AnimatePresence: ({ children }) => <>{children}</>,
        motion: new Proxy({}, { get: () => Component }),
    }
})

vi.mock('../../lib/useNetworkStatus', () => ({
    default: () => mocks.network.current,
}))

function network(overrides = {}) {
    const context = {
        address: '192.168.50.20',
        cidr: '192.168.50.0/24',
        gateway: '192.168.50.1',
        mac: 'AA:BB:CC:DD:EE:FF',
        interfaceName: 'Wi-Fi',
    }
    return {
        gateway: context.gateway,
        localIP: context.address,
        isVpn: false,
        underlayIdentityKey: 'wifi:office',
        underlayGateway: context.gateway,
        underlay: {
            type: 'wifi',
            connected: true,
            localIp: context.address,
            gateway: context.gateway,
            context,
        },
        networkContext: context,
        networkContexts: [],
        ...overrides,
    }
}

vi.mock('../../lib/electronBridge.js', () => ({
    default: {
        configGet: vi.fn(),
        configSet: vi.fn(() => Promise.resolve(true)),
        getNetworkInterfaces: vi.fn(() => Promise.resolve([
            { family: 'IPv4', internal: false, address: '192.168.50.20' },
        ])),
        onNetworkChanged: vi.fn(() => () => {}),
        lanCheckHistoryGet: vi.fn(() => Promise.resolve([])),
        lanCheckHistoryAdd: vi.fn(() => Promise.resolve([])),
        lanScan: vi.fn(),
        lanScanCancel: vi.fn(),
        lanSecurityScanCancel: vi.fn(),
    },
}))

function deferred() {
    let resolve
    const promise = new Promise(next => { resolve = next })
    return { promise, resolve }
}

function configureManualRange(rangeEnd = 100) {
    bridge.configGet.mockImplementation(key => Promise.resolve(key === 'lancheck.settings' ? {
        profile: 'quick',
        enableDiscovery: true,
        extendedSweep: false,
        scanAllHosts: false,
        baseIP: '10.44.0',
        rangeStart: 1,
        rangeEnd,
        scopeMode: 'manual',
        selectedInterfaceAddress: '',
    } : false))
}

describe('LAN Check run ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetPersistentSessionsForTests()
        resetOperationsForTests()
        configureManualRange()
        mocks.network.current = network()
    })

    it('uses the manual subnet verbatim and performs no auto-interface refresh', async () => {
        const firstBatch = deferred()
        bridge.lanScan.mockReturnValue(firstBatch.promise)
        render(<LanCheck />)

        await screen.findByDisplayValue('10.44.0')
        fireEvent.click(screen.getByRole('button', { name: /Execute LAN Check/i }))

        await waitFor(() => expect(bridge.lanScan).toHaveBeenCalledTimes(1))
        expect(bridge.lanScan.mock.calls[0][0]).toBe('10.44.0')
        expect(bridge.getNetworkInterfaces).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: /Stop Scan/i }))
        await act(async () => { firstBatch.resolve([]); await Promise.resolve() })
    })

    it('keeps a restarted scan authoritative when the cancelled request settles late', async () => {
        const oldBatch = deferred()
        const currentBatch = deferred()
        bridge.lanScan
            .mockReturnValueOnce(oldBatch.promise)
            .mockReturnValueOnce(currentBatch.promise)

        render(<LanCheck />)
        await screen.findByDisplayValue('10.44.0')
        fireEvent.click(screen.getByRole('button', { name: /Execute LAN Check/i }))
        await waitFor(() => expect(bridge.lanScan).toHaveBeenCalledTimes(1))
        const oldScanId = bridge.lanScan.mock.calls[0][3]?.scanId

        fireEvent.click(screen.getByRole('button', { name: /Stop Scan/i }))
        fireEvent.click(await screen.findByRole('button', { name: /Execute LAN Check/i }))
        await waitFor(() => expect(bridge.lanScan).toHaveBeenCalledTimes(2))
        const currentScanId = bridge.lanScan.mock.calls[1][3]?.scanId
        expect(currentScanId).not.toBe(oldScanId)

        await act(async () => { oldBatch.resolve([]); await Promise.resolve() })

        expect(screen.getByRole('button', { name: /Stop Scan/i })).toBeInTheDocument()
        expect(bridge.lanScan.mock.calls.filter(call => call[3]?.scanId === oldScanId)).toHaveLength(1)

        fireEvent.click(screen.getByRole('button', { name: /Stop Scan/i }))
        await act(async () => { currentBatch.resolve([]); await Promise.resolve() })
    })

    it('uses the physical underlay gateway and local IP while a VPN route is active', async () => {
        const firstBatch = deferred()
        bridge.lanScan.mockReturnValue(firstBatch.promise)
        mocks.network.current = network({
            gateway: null,
            isVpn: true,
            networkEpoch: 2,
        })

        render(<LanCheck />)
        await screen.findByDisplayValue('10.44.0')
        fireEvent.click(screen.getByRole('button', { name: /Execute LAN Check/i }))

        await waitFor(() => expect(bridge.lanScan).toHaveBeenCalledTimes(1))
        expect(bridge.lanScan.mock.calls[0][3]).toMatchObject({
            gatewayIp: '192.168.50.1',
            localIp: '192.168.50.20',
        })

        fireEvent.click(screen.getByRole('button', { name: /Stop Scan/i }))
        await act(async () => { firstBatch.resolve([]); await Promise.resolve() })
    })
})
