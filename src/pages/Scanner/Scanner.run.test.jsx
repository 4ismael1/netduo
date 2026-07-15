import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Scanner from './Scanner.jsx'
import bridge from '../../lib/electronBridge.js'
import { getScannerSessionSnapshot, resetScannerSessionForTests } from '../../lib/scannerSession.js'

const mocks = vi.hoisted(() => ({ network: { current: null } }))

vi.mock('../../lib/useNetworkStatus.jsx', () => ({
    default: () => mocks.network.current,
}))

function network(overrides = {}) {
    const context = {
        address: '192.168.1.20',
        cidr: '192.168.1.0/24',
        gateway: '192.168.1.1',
        mac: 'AA:BB:CC:DD:EE:FF',
        interfaceName: 'Wi-Fi',
        prefixLength: 24,
        firstHost: '192.168.1.1',
        lastHost: '192.168.1.254',
    }
    return {
        gateway: context.gateway,
        localIP: context.address,
        isVpn: false,
        networkEpoch: 1,
        underlayIdentityKey: 'wifi:office-a',
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
        checkPort: vi.fn(),
        configGet: vi.fn(() => Promise.resolve(null)),
        configSet: vi.fn(() => Promise.resolve(true)),
        deviceInventoryList: vi.fn(() => Promise.resolve([])),
        deviceInventoryMerge: vi.fn(() => Promise.resolve({ newKeys: [], updatedKeys: [] })),
        deviceInventoryPurgeGhosts: vi.fn(() => Promise.resolve([])),
        deviceSnapshotAdd: vi.fn(() => Promise.resolve([])),
        deviceSnapshotLatest: vi.fn(() => Promise.resolve(null)),
        getArpTable: vi.fn(() => Promise.resolve([])),
        getSystemInfo: vi.fn(() => Promise.resolve({})),
        historyAdd: vi.fn(() => Promise.resolve([])),
        lanScan: vi.fn(),
        lanScanCancel: vi.fn(),
        lanScanEnrich: vi.fn(() => Promise.resolve([])),
        pingHost: vi.fn(),
    },
}))

describe('Scanner run finalization', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sessionStorage.clear()
        resetScannerSessionForTests()
        mocks.network.current = network()
    })

    it('returns to an actionable terminal state when the scan IPC rejects', async () => {
        bridge.lanScan.mockRejectedValueOnce(new Error('Native scan failed'))
        render(<Scanner />)

        fireEvent.click(screen.getByRole('button', { name: /Scan network/i }))

        await screen.findByText('Native scan failed')
        await waitFor(() => expect(getScannerSessionSnapshot().scanning).toBe(false))
        expect(getScannerSessionSnapshot().runDevices).toEqual([])
        expect(screen.getByRole('button', { name: /Scan network/i })).toBeEnabled()
    })

    it('does not downgrade a completed discovery when best-effort persistence throws', async () => {
        bridge.lanScan.mockResolvedValueOnce([{ ip: '192.168.1.42', alive: true }])
        bridge.historyAdd.mockImplementationOnce(() => { throw new Error('History unavailable') })
        render(<Scanner />)

        fireEvent.click(screen.getByRole('button', { name: /Scan network/i }))

        await waitFor(() => expect(getScannerSessionSnapshot().scanning).toBe(false))
        expect(getScannerSessionSnapshot()).toMatchObject({
            progress: 100,
            devices: [{ ip: '192.168.1.42', alive: true }],
        })
        expect(screen.queryByText('History unavailable')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Scan network/i })).toBeEnabled()
    })

    it('keeps LAN inventory across a VPN route epoch but reloads it on a physical underlay change', async () => {
        bridge.getArpTable.mockImplementation(() => Promise.resolve([{
            ip: '192.168.1.1',
            mac: mocks.network.current.underlayIdentityKey === 'wifi:office-a'
                ? 'AA:AA:AA:AA:AA:AA'
                : 'BB:BB:BB:BB:BB:BB',
        }]))
        bridge.deviceInventoryList.mockImplementation(networkId => Promise.resolve([{
            networkId,
            deviceKey: networkId === 'mac:aaaaaaaaaaaa' ? 'mac:devicea' : 'mac:deviceb',
            baseIP: '192.168.1.0/24',
            ip: networkId === 'mac:aaaaaaaaaaaa' ? '192.168.1.40' : '192.168.1.41',
            hostname: networkId === 'mac:aaaaaaaaaaaa' ? 'Office printer' : 'Lab printer',
            presence: 'offline',
        }]))

        const view = render(<Scanner />)
        expect(await screen.findByText('Office printer')).toBeInTheDocument()
        expect(bridge.deviceInventoryList).toHaveBeenCalledTimes(1)

        mocks.network.current = network({
            gateway: null,
            isVpn: true,
            networkEpoch: 2,
            underlayIdentityKey: 'wifi:office-a',
        })
        view.rerender(<Scanner />)
        await act(async () => { await Promise.resolve() })

        expect(screen.getByText('Office printer')).toBeInTheDocument()
        expect(bridge.deviceInventoryList).toHaveBeenCalledTimes(1)
        expect(bridge.lanScanCancel).not.toHaveBeenCalled()

        mocks.network.current = network({
            networkEpoch: 3,
            underlayIdentityKey: 'wifi:office-b',
        })
        view.rerender(<Scanner />)

        expect(await screen.findByText('Lab printer')).toBeInTheDocument()
        expect(screen.queryByText('Office printer')).not.toBeInTheDocument()
        expect(bridge.deviceInventoryList).toHaveBeenLastCalledWith('mac:bbbbbbbbbbbb')
        expect(bridge.lanScanCancel).toHaveBeenCalledTimes(1)
    })
})
