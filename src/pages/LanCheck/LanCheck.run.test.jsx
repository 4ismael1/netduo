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
        firstHost: '192.168.50.1',
        lastHost: '192.168.50.254',
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
        getArpTable: vi.fn(() => Promise.resolve([])),
        lanUpnpScan: vi.fn(() => Promise.resolve({ ok: true, devices: [], summary: { ssdpResponders: 0 } })),
        lanSecurityScan: vi.fn(() => Promise.resolve({ ok: true, results: [] })),
        lanScanCancel: vi.fn(),
        lanSecurityScanCancel: vi.fn(),
    },
}))

function deferred() {
    let resolve
    const promise = new Promise(next => { resolve = next })
    return { promise, resolve }
}

function configureManualRange(rangeEnd = 100, overrides = {}) {
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
        ...overrides,
    } : false))
}

function configureAutoScope(overrides = {}) {
    bridge.configGet.mockImplementation(key => Promise.resolve(key === 'lancheck.settings' ? {
        profile: 'quick',
        enableDiscovery: true,
        extendedSweep: false,
        scanAllHosts: false,
        baseIP: '192.168.50',
        rangeStart: 1,
        rangeEnd: 254,
        scopeMode: 'auto',
        selectedInterfaceAddress: '',
        ...overrides,
    } : false))
}

async function selectManualScope(rangeEnd = 100) {
    await waitFor(() => expect(bridge.configGet).toHaveBeenCalledWith('lancheck.settings'))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    fireEvent.change(screen.getByRole('combobox', { name: /Subnet scope mode/i }), {
        target: { value: 'manual' },
    })

    const baseInput = await screen.findByRole('textbox', { name: /Manual subnet prefix/i })
    fireEvent.change(baseInput, { target: { value: '10.44.0' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: /Manual range start/i }), { target: { value: '1' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: /Manual range end/i }), { target: { value: String(rangeEnd) } })
    await waitFor(() => expect(baseInput).toHaveValue('10.44.0'))
}

describe('LAN Check run ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetPersistentSessionsForTests()
        resetOperationsForTests()
        configureManualRange()
        mocks.network.current = network()
        bridge.getArpTable.mockResolvedValue([])
        bridge.lanUpnpScan.mockResolvedValue({ ok: true, devices: [], summary: { ssdpResponders: 0 } })
        bridge.lanSecurityScan.mockResolvedValue({ ok: true, results: [] })
    })

    it('opens on the detected network even when the previous settings used manual scope', async () => {
        render(<LanCheck />)
        await waitFor(() => expect(bridge.configGet).toHaveBeenCalledWith('lancheck.settings'))
        await act(async () => { await Promise.resolve(); await Promise.resolve() })

        expect(screen.getByRole('combobox', { name: /Subnet scope mode/i })).toHaveValue('auto')
        expect(screen.getByRole('textbox', { name: /Detected CIDR/i })).toHaveValue('192.168.50.0/24')
        expect(screen.queryByRole('textbox', { name: /Manual subnet prefix/i })).not.toBeInTheDocument()
    })

    it('uses the manual subnet verbatim and performs no auto-interface refresh', async () => {
        const firstBatch = deferred()
        bridge.lanScan.mockReturnValue(firstBatch.promise)
        render(<LanCheck />)

        await selectManualScope()
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
        await selectManualScope()
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

    it('does not leak physical underlay hints into an unrelated manual scope', async () => {
        const firstBatch = deferred()
        bridge.lanScan.mockReturnValue(firstBatch.promise)
        mocks.network.current = network({
            gateway: null,
            isVpn: true,
            networkEpoch: 2,
        })

        render(<LanCheck />)
        await selectManualScope()
        fireEvent.click(screen.getByRole('button', { name: /Execute LAN Check/i }))

        await waitFor(() => expect(bridge.lanScan).toHaveBeenCalledTimes(1))
        expect(bridge.lanScan.mock.calls[0][3]).toMatchObject({
            gatewayIp: null,
            localIp: null,
        })

        fireEvent.click(screen.getByRole('button', { name: /Stop Scan/i }))
        await act(async () => { firstBatch.resolve([]); await Promise.resolve() })
    })

    it('uses the physical underlay gateway and local IP for detected scope while a VPN is active', async () => {
        const firstBatch = deferred()
        configureAutoScope()
        bridge.lanScan.mockReturnValue(firstBatch.promise)
        mocks.network.current = network({ gateway: null, isVpn: true, networkEpoch: 2 })

        render(<LanCheck />)
        await waitFor(() => expect(bridge.configGet).toHaveBeenCalledWith('lancheck.settings'))
        await act(async () => { await Promise.resolve(); await Promise.resolve() })
        await screen.findByDisplayValue('192.168.50.0/24')
        fireEvent.click(screen.getByRole('button', { name: /Execute LAN Check/i }))

        await waitFor(() => expect(bridge.lanScan).toHaveBeenCalledTimes(1))
        expect(bridge.lanScan.mock.calls[0][3]).toMatchObject({
            discoveryMode: 'quick',
            gatewayIp: '192.168.50.1',
            localIp: '192.168.50.20',
        })

        fireEvent.click(screen.getByRole('button', { name: /Stop Scan/i }))
        await act(async () => { firstBatch.resolve([]); await Promise.resolve() })
    })

    it.each([
        ['quick', 'quick'],
        ['standard', 'balanced'],
        ['deep', 'deep'],
    ])('maps the %s profile to %s discovery behavior', async (profile, discoveryMode) => {
        configureManualRange(1, { profile })
        bridge.lanScan.mockResolvedValue([{ ip: '10.44.0.1', alive: true, time: 2 }])
        bridge.lanSecurityScan.mockResolvedValue({
            ok: true,
            results: [{ ip: '10.44.0.1', entries: [] }],
        })

        render(<LanCheck />)
        await selectManualScope(1)
        fireEvent.click(screen.getByRole('button', { name: /Execute LAN Check/i }))

        await waitFor(() => expect(bridge.lanCheckHistoryAdd).toHaveBeenCalledTimes(1))
        expect(bridge.lanScan).toHaveBeenCalledWith(
            '10.44.0',
            1,
            1,
            expect.objectContaining({ discoveryMode })
        )
    })

    it('does not save a successful report when discovery finds no analyzable host', async () => {
        configureManualRange(1)
        bridge.lanScan.mockResolvedValue([])

        render(<LanCheck />)
        await selectManualScope(1)
        fireEvent.click(screen.getByRole('button', { name: /Execute LAN Check/i }))

        expect(await screen.findByText(/No active devices were found/i)).toBeInTheDocument()
        expect(bridge.lanSecurityScan).not.toHaveBeenCalled()
        expect(bridge.lanCheckHistoryAdd).not.toHaveBeenCalled()
    })

    it('does not guess .1 or .254 targets in focused mode without evidence', async () => {
        configureManualRange(254, { enableDiscovery: false })

        render(<LanCheck />)
        await selectManualScope(254)
        fireEvent.click(screen.getByRole('button', { name: /Execute LAN Check/i }))

        expect(await screen.findByText(/No active devices were found/i)).toBeInTheDocument()
        expect(bridge.lanScan).not.toHaveBeenCalled()
        expect(bridge.lanSecurityScan).not.toHaveBeenCalled()
        expect(bridge.lanCheckHistoryAdd).not.toHaveBeenCalled()
    })

    it('promotes an in-scope UPnP responder into the service sweep', async () => {
        configureManualRange(10)
        bridge.lanScan.mockResolvedValue([])
        bridge.lanUpnpScan.mockResolvedValue({
            ok: true,
            devices: [{
                ip: '10.44.0.7',
                friendlyName: 'Office Router',
                manufacturer: 'Example',
                isIgd: true,
                isRootDevice: true,
            }],
        })
        bridge.lanSecurityScan.mockImplementation(payload => Promise.resolve({
            ok: true,
            results: [{ ip: payload.targets[0].ip, entries: [] }],
        }))

        render(<LanCheck />)
        await selectManualScope(10)
        fireEvent.click(screen.getByRole('button', { name: /Execute LAN Check/i }))

        await waitFor(() => expect(bridge.lanCheckHistoryAdd).toHaveBeenCalledTimes(1))
        expect(bridge.lanSecurityScan).toHaveBeenCalledWith(expect.objectContaining({
            targets: [{ ip: '10.44.0.7' }],
        }))
    })

    it('renders report evidence in independent columns with one pagination mechanism', async () => {
        configureManualRange(1)
        bridge.lanScan.mockResolvedValue([{ ip: '10.44.0.1', alive: true, time: 2 }])
        bridge.lanSecurityScan.mockResolvedValue({
            ok: true,
            results: [{
                ip: '10.44.0.1',
                entries: Array.from({ length: 9 }, (_, index) => ({
                    protocol: 'tcp',
                    port: 8000 + index,
                    state: 'open',
                    rtt: index + 1,
                    service: `service-${index + 1}`,
                })),
            }],
        })

        const { container } = render(<LanCheck />)
        await selectManualScope(1)
        fireEvent.click(screen.getByRole('button', { name: /Execute LAN Check/i }))

        await screen.findByText(/LAN Check Report/i)
        expect(container.querySelectorAll('.lchk-report-column')).toHaveLength(2)
        expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
        expect(screen.queryByRole('columnheader', { name: 'Role' })).not.toBeInTheDocument()
        expect(screen.queryByRole('columnheader', { name: 'Severity' })).not.toBeInTheDocument()
        expect(screen.getByText('Page 1 / 2')).toBeInTheDocument()
        expect(container.querySelector('.lchk-finding-head .lchk-sev-chip')).toBeInTheDocument()
    })

    it('shows the full detected interface context and a one-click recovery for stale manual scope', async () => {
        const secondContext = {
            address: '10.10.0.15',
            cidr: '10.10.0.0/24',
            firstHost: '10.10.0.1',
            lastHost: '10.10.0.254',
            gateway: '10.10.0.1',
            interfaceName: 'Ethernet',
        }
        const current = network()
        mocks.network.current = {
            ...current,
            networkContexts: [current.networkContext, secondContext],
        }

        render(<LanCheck />)
        await selectManualScope()
        expect(screen.getByText(/Manual scope is outside the current network/i)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: /Use detected network/i }))

        const interfaceSelect = await screen.findByRole('combobox', { name: /Network interface/i })
        expect(interfaceSelect).toHaveAttribute('title', 'Wi-Fi · 192.168.50.20 · 192.168.50.0/24')
        expect(screen.getAllByText('192.168.50.0/24').length).toBeGreaterThan(0)
    })
})
