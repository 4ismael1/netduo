import { act, render, screen, waitFor } from '@testing-library/react'
import useNetworkStatus, { NetworkStatusProvider } from './useNetworkStatus.jsx'

const bridgeMock = vi.hoisted(() => {
    let snapshotListener = null
    return {
        getNetworkSnapshot: vi.fn(),
        refreshNetworkSnapshot: vi.fn(),
        getPublicIP: vi.fn(() => Promise.resolve('203.0.113.10')),
        getIPGeo: vi.fn(() => Promise.resolve({ countryCode: 'US' })),
        configGetPublic: vi.fn(() => Promise.resolve({ onlineNetworkInfo: false })),
        onNetworkSnapshot: vi.fn(callback => { snapshotListener = callback; return vi.fn() }),
        onConfigChanged: vi.fn(() => vi.fn()),
        emitSnapshot: snapshot => snapshotListener?.(snapshot),
    }
})

vi.mock('./electronBridge', () => ({ default: bridgeMock }))

function Probe() {
    const network = useNetworkStatus()
    return (
        <div>
            <span data-testid="loading">{String(network.loading)}</span>
            <span data-testid="connected">{String(network.connected)}</span>
            <span data-testid="local-ip">{network.localIP || '-'}</span>
            <span data-testid="gateway">{network.gateway || '-'}</span>
            <span data-testid="dns">{network.dns[0] || '-'}</span>
            <span data-testid="epoch">{network.networkEpoch}</span>
            <span data-testid="link-type">{network.linkType}</span>
            <span data-testid="vpn">{String(network.isVpn)}</span>
            <span data-testid="wifi">{network.wifi?.ssid || '-'}</span>
            <span data-testid="tunnel-interface">{network.vpnStatus?.tunnel?.interfaceName || '-'}</span>
            <span data-testid="public-ip">{network.publicIP || '-'}</span>
        </div>
    )
}

function coreSnapshot(overrides = {}) {
    const context = {
        address: '192.168.50.20',
        interfaceName: 'Ethernet',
        gateway: null,
        source: 'os-fallback',
    }
    return {
        revision: 1,
        coreStatus: 'ready',
        enrichmentStatus: 'loading',
        linkState: 'connected',
        reason: 'startup',
        interfaces: [{ name: 'Ethernet', family: 'IPv4', internal: false, address: '192.168.50.20' }],
        networkContext: context,
        networkContexts: [context],
        wifi: null,
        dns: ['192.168.50.1'],
        vpnStatus: null,
        sysInfo: { hostname: 'TEST-PC' },
        ...overrides,
    }
}

describe('NetworkStatusProvider snapshot flow', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        bridgeMock.getNetworkSnapshot.mockResolvedValue(coreSnapshot())
        bridgeMock.refreshNetworkSnapshot.mockResolvedValue(coreSnapshot())
        bridgeMock.getPublicIP.mockResolvedValue('203.0.113.10')
        bridgeMock.getIPGeo.mockResolvedValue({ countryCode: 'US' })
        bridgeMock.configGetPublic.mockResolvedValue({ onlineNetworkInfo: false })
    })

    afterEach(() => vi.useRealTimers())

    it('keeps presentation loading while only the fast core snapshot is ready', async () => {
        render(<NetworkStatusProvider minimumSkeletonMs={0}><Probe /></NetworkStatusProvider>)

        await waitFor(() => expect(screen.getByTestId('connected')).toHaveTextContent('true'))
        expect(screen.getByTestId('loading')).toHaveTextContent('true')
        expect(screen.getByTestId('connected')).toHaveTextContent('true')
        expect(screen.getByTestId('local-ip')).toHaveTextContent('192.168.50.20')
        expect(screen.getByTestId('gateway')).toHaveTextContent('-')
        expect(screen.getByTestId('dns')).toHaveTextContent('192.168.50.1')
    })

    it('reveals only after one terminal enriched snapshot without replacing connected state', async () => {
        render(<NetworkStatusProvider minimumSkeletonMs={0}><Probe /></NetworkStatusProvider>)
        await waitFor(() => expect(screen.getByTestId('connected')).toHaveTextContent('true'))
        expect(screen.getByTestId('loading')).toHaveTextContent('true')

        await act(async () => {
            bridgeMock.emitSnapshot(coreSnapshot({
                revision: 2,
                enrichmentStatus: 'ready',
                reason: 'startup',
                networkContext: { ...coreSnapshot().networkContext, gateway: '192.168.50.1' },
                dns: ['1.1.1.1'],
            }))
        })

        await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
        expect(screen.getByTestId('connected')).toHaveTextContent('true')
        expect(screen.getByTestId('gateway')).toHaveTextContent('192.168.50.1')
        expect(screen.getByTestId('dns')).toHaveTextContent('1.1.1.1')
    })

    it('waits for initial public identity before revealing a complete dashboard', async () => {
        let resolvePublicIp
        bridgeMock.getNetworkSnapshot.mockResolvedValue(coreSnapshot({ enrichmentStatus: 'ready' }))
        bridgeMock.getPublicIP.mockReturnValue(new Promise(resolve => { resolvePublicIp = resolve }))
        render(<NetworkStatusProvider minimumSkeletonMs={0}><Probe /></NetworkStatusProvider>)

        await waitFor(() => expect(bridgeMock.getPublicIP).toHaveBeenCalled())
        expect(screen.getByTestId('loading')).toHaveTextContent('true')
        await act(async () => resolvePublicIp('203.0.113.20'))
        await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    })

    it('keeps the skeleton visible for the minimum presentation window on warm starts', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-07-15T00:00:00Z'))
        bridgeMock.getNetworkSnapshot.mockResolvedValue(coreSnapshot({ enrichmentStatus: 'ready' }))
        render(<NetworkStatusProvider minimumSkeletonMs={500}><Probe /></NetworkStatusProvider>)

        await act(async () => { await Promise.resolve(); await Promise.resolve() })
        expect(screen.getByTestId('loading')).toHaveTextContent('true')
        await act(async () => vi.advanceTimersByTime(499))
        expect(screen.getByTestId('loading')).toHaveTextContent('true')
        await act(async () => vi.advanceTimersByTime(1))
        expect(screen.getByTestId('loading')).toHaveTextContent('false')
    })

    it('does not lose the optional geo request when public-IP loading is already in flight', async () => {
        bridgeMock.configGetPublic.mockResolvedValue({ onlineNetworkInfo: true })
        render(<NetworkStatusProvider minimumSkeletonMs={0}><Probe /></NetworkStatusProvider>)

        await waitFor(() => expect(bridgeMock.getIPGeo).toHaveBeenCalledWith('203.0.113.10'))
    })

    it('keeps the Wi-Fi underlay stable across VPN connect and disconnect epochs', async () => {
        const wifi = { connected: true, ssid: 'Office', bssid: 'aa:bb', signal: '80%' }
        const underlay = {
            type: 'wifi',
            connected: true,
            interfaceName: 'Wi-Fi',
            localIp: '192.168.50.20',
            gateway: '192.168.50.1',
            context: { address: '192.168.50.20', interfaceName: 'Wi-Fi', gateway: '192.168.50.1' },
            wifi,
        }
        bridgeMock.getNetworkSnapshot.mockResolvedValue(coreSnapshot({
            networkEpoch: 0,
            enrichmentStatus: 'ready',
            wifi,
            underlay,
            overlay: { type: 'vpn', active: false, tunnel: null, status: { active: false, tunnel: null } },
            vpnStatus: { active: false, tunnel: null },
        }))
        render(<NetworkStatusProvider minimumSkeletonMs={0}><Probe /></NetworkStatusProvider>)
        await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

        await act(async () => bridgeMock.emitSnapshot(coreSnapshot({
            revision: 2,
            networkEpoch: 0,
            enrichmentStatus: 'ready',
            transitioning: true,
            wifi,
            underlay,
            overlay: { type: 'vpn', active: false, tunnel: null, status: { active: false, tunnel: null } },
            vpnStatus: { active: false, tunnel: null },
        })))
        expect(screen.getByTestId('wifi')).toHaveTextContent('Office')
        expect(screen.getByTestId('vpn')).toHaveTextContent('false')

        await act(async () => bridgeMock.emitSnapshot(coreSnapshot({
            revision: 3,
            networkEpoch: 1,
            enrichmentStatus: 'ready',
            wifi,
            underlay,
            overlay: {
                type: 'vpn',
                active: true,
                tunnel: { interfaceName: 'WireGuard', localIp: '10.8.0.2' },
                status: { active: true, tunnel: { interfaceName: 'WireGuard', localIp: '10.8.0.2' } },
            },
            vpnStatus: { active: true, tunnel: { interfaceName: 'WireGuard', localIp: '10.8.0.2' } },
        })))
        expect(screen.getByTestId('epoch')).toHaveTextContent('1')
        expect(screen.getByTestId('link-type')).toHaveTextContent('wifi')
        expect(screen.getByTestId('wifi')).toHaveTextContent('Office')
        expect(screen.getByTestId('vpn')).toHaveTextContent('true')
        expect(screen.getByTestId('tunnel-interface')).toHaveTextContent('WireGuard')
        expect(screen.getByTestId('local-ip')).toHaveTextContent('192.168.50.20')
        expect(screen.getByTestId('gateway')).toHaveTextContent('-')

        await act(async () => bridgeMock.emitSnapshot(coreSnapshot({
            revision: 4,
            networkEpoch: 2,
            enrichmentStatus: 'ready',
            wifi,
            underlay,
            overlay: { type: 'vpn', active: false, tunnel: null, status: { active: false, tunnel: null } },
            vpnStatus: { active: false, tunnel: null },
        })))
        expect(screen.getByTestId('epoch')).toHaveTextContent('2')
        expect(screen.getByTestId('wifi')).toHaveTextContent('Office')
        expect(screen.getByTestId('vpn')).toHaveTextContent('false')
        expect(screen.getByTestId('gateway')).toHaveTextContent('192.168.50.1')
    })

    it('discards an old public identity and queues exactly one refresh for the new epoch', async () => {
        let resolveOld
        let resolveCurrent
        bridgeMock.getNetworkSnapshot.mockResolvedValue(coreSnapshot({ networkEpoch: 0, enrichmentStatus: 'ready' }))
        bridgeMock.getPublicIP
            .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
            .mockReturnValueOnce(new Promise(resolve => { resolveCurrent = resolve }))
        render(<NetworkStatusProvider minimumSkeletonMs={0}><Probe /></NetworkStatusProvider>)
        await waitFor(() => expect(bridgeMock.getPublicIP).toHaveBeenCalledTimes(1))

        const nextEpoch = coreSnapshot({
            revision: 2,
            networkEpoch: 1,
            enrichmentStatus: 'ready',
            networkContext: { ...coreSnapshot().networkContext, address: '10.0.0.20', gateway: '192.168.50.1' },
            interfaces: [{ name: 'Ethernet', family: 'IPv4', internal: false, address: '10.0.0.20' }],
        })
        await act(async () => {
            bridgeMock.emitSnapshot(nextEpoch)
            bridgeMock.emitSnapshot({ ...nextEpoch, revision: 3, reason: 'periodic' })
        })
        await act(async () => resolveOld('198.51.100.10'))
        await waitFor(() => expect(bridgeMock.getPublicIP).toHaveBeenCalledTimes(2))
        expect(screen.getByTestId('public-ip')).toHaveTextContent('-')

        await act(async () => resolveCurrent('203.0.113.25'))
        await waitFor(() => expect(screen.getByTestId('public-ip')).toHaveTextContent('203.0.113.25'))
        expect(screen.getByTestId('epoch')).toHaveTextContent('1')
        expect(bridgeMock.getPublicIP).toHaveBeenCalledTimes(2)
    })

    it('uses a five-minute foreground fallback poll while epoch changes still refresh immediately', async () => {
        vi.useFakeTimers()
        bridgeMock.getNetworkSnapshot.mockResolvedValue(coreSnapshot({ networkEpoch: 0, enrichmentStatus: 'ready' }))
        render(<NetworkStatusProvider minimumSkeletonMs={0}><Probe /></NetworkStatusProvider>)
        await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
        expect(bridgeMock.getPublicIP).toHaveBeenCalledTimes(1)

        await act(async () => vi.advanceTimersByTime((5 * 60 * 1000) - 1))
        expect(bridgeMock.getPublicIP).toHaveBeenCalledTimes(1)
        await act(async () => {
            vi.advanceTimersByTime(1)
            await Promise.resolve()
            await Promise.resolve()
        })
        expect(bridgeMock.getPublicIP).toHaveBeenCalledTimes(2)

        Object.defineProperty(document, 'hidden', { configurable: true, value: true })
        act(() => document.dispatchEvent(new Event('visibilitychange')))
        await act(async () => vi.advanceTimersByTime(5 * 60 * 1000))
        expect(bridgeMock.getPublicIP).toHaveBeenCalledTimes(2)
        Object.defineProperty(document, 'hidden', { configurable: true, value: false })
        act(() => document.dispatchEvent(new Event('visibilitychange')))
    })
})
