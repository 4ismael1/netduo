import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from './Dashboard.jsx'

const mocks = vi.hoisted(() => ({
    network: { current: null },
    visibilityListeners: new Set(),
    bridge: {
        configGetPublic: vi.fn(() => Promise.resolve({ pollInterval: 3, latencyThreshold: 150, publicIpVisible: true })),
        onConfigChanged: vi.fn(() => vi.fn()),
        onWindowVisibilityChanged: vi.fn(callback => {
            mocks.visibilityListeners.add(callback)
            return () => mocks.visibilityListeners.delete(callback)
        }),
        pingSingle: vi.fn(() => Promise.resolve({ time: 12 })),
    },
}))

vi.mock('../../lib/useNetworkStatus.jsx', () => ({ default: () => mocks.network.current }))
vi.mock('../../lib/electronBridge', () => ({ default: mocks.bridge }))
vi.mock('recharts', () => ({
    AreaChart: ({ children, data = [] }) => (
        <div data-testid="area-chart" data-series={JSON.stringify(data.map(point => point.dbm ?? point.ms ?? null))}>
            {children}
        </div>
    ),
    Area: () => null,
    ResponsiveContainer: ({ children }) => <div>{children}</div>,
    Tooltip: () => null,
    YAxis: () => null,
    ReferenceLine: () => null,
}))

function network(overrides = {}) {
    return {
        loading: true,
        enrichmentStatus: 'loading',
        connected: true,
        localIP: '192.168.1.20',
        gateway: null,
        ifaceName: 'Ethernet',
        interfaces: [],
        networkContext: null,
        networkContexts: [],
        publicIP: null,
        dns: [],
        sysInfo: { hostname: 'TEST-PC' },
        wifi: null,
        linkType: 'ethernet',
        isVpn: false,
        vpnStatus: null,
        networkEpoch: 0,
        underlayIdentityKey: 'ethernet:test',
        underlay: null,
        overlay: { type: 'vpn', active: false, tunnel: null },
        ...overrides,
    }
}

describe('Dashboard startup presentation', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.visibilityListeners.clear()
        mocks.network.current = network()
    })

    it('keeps the synchronized sampler active after the Strict Mode effect cycle', async () => {
        mocks.network.current = network({
            loading: false,
            enrichmentStatus: 'ready',
            gateway: '192.168.1.1',
            publicIP: '203.0.113.10',
            dns: ['192.168.1.1'],
        })

        const view = render(
            <StrictMode>
                <MemoryRouter><Dashboard /></MemoryRouter>
            </StrictMode>
        )

        await waitFor(() => {
            const values = Array.from(view.container.querySelectorAll('.chart-ms'), node => node.textContent.trim())
            expect(values).toEqual(['12 ms', '12 ms', '12 ms'])
        })
        expect(new Set(mocks.bridge.pingSingle.mock.calls.map(([target]) => target))).toEqual(
            new Set(['1.1.1.1', '8.8.8.8', 'google.com', '192.168.1.1'])
        )
        expect(mocks.bridge.pingSingle).toHaveBeenCalledTimes(4)
    })

    it('stops every visual probe while the native window is minimized and resumes immediately', async () => {
        mocks.network.current = network({
            loading: false,
            enrichmentStatus: 'ready',
            gateway: '192.168.1.1',
            publicIP: '203.0.113.10',
            dns: ['192.168.1.1'],
        })

        const view = render(<MemoryRouter><Dashboard /></MemoryRouter>)
        await waitFor(() => expect(mocks.bridge.pingSingle).toHaveBeenCalledTimes(4))

        act(() => mocks.visibilityListeners.forEach(listener => listener({ visible: false })))
        await new Promise(resolve => setTimeout(resolve, 3300))
        expect(mocks.bridge.pingSingle).toHaveBeenCalledTimes(4)

        act(() => mocks.visibilityListeners.forEach(listener => listener({ visible: true })))
        await waitFor(() => expect(mocks.bridge.pingSingle).toHaveBeenCalledTimes(8))
        view.unmount()
    }, 10000)

    it('shows only the full skeleton until the coherent presentation snapshot is ready', async () => {
        const view = render(<MemoryRouter><Dashboard /></MemoryRouter>)

        expect(view.container.querySelector('.dash-skeleton')).toBeInTheDocument()
        expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()

        mocks.network.current = network({
            loading: false,
            enrichmentStatus: 'ready',
            gateway: '192.168.1.1',
            publicIP: '203.0.113.10',
            dns: ['192.168.1.1'],
        })
        view.rerender(<MemoryRouter><Dashboard /></MemoryRouter>)

        await waitFor(() => expect(view.container.querySelector('.dash-skeleton')).not.toBeInTheDocument())
        expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
        expect(screen.getAllByText('192.168.1.1').length).toBeGreaterThan(0)
        expect(screen.getByText('203.0.113.10')).toBeInTheDocument()
    })

    it('discards an old synchronized round when the epoch changes even with the same gateway', async () => {
        const oldResolvers = []
        mocks.bridge.pingSingle.mockImplementation(() => {
            if (oldResolvers.length < 4) {
                return new Promise(resolve => oldResolvers.push(resolve))
            }
            return Promise.resolve({ time: 22 })
        })
        mocks.network.current = network({
            loading: false,
            enrichmentStatus: 'ready',
            networkEpoch: 100,
            gateway: '192.168.1.1',
            publicIP: '203.0.113.10',
            dns: ['192.168.1.1'],
        })
        const view = render(<MemoryRouter><Dashboard /></MemoryRouter>)
        await waitFor(() => expect(mocks.bridge.pingSingle).toHaveBeenCalledTimes(4))

        mocks.network.current = network({
            loading: false,
            enrichmentStatus: 'ready',
            networkEpoch: 101,
            gateway: '192.168.1.1',
            localIP: '192.168.1.30',
            publicIP: '203.0.113.20',
            dns: ['192.168.1.1'],
        })
        view.rerender(<MemoryRouter><Dashboard /></MemoryRouter>)
        await waitFor(() => expect(mocks.bridge.pingSingle).toHaveBeenCalledTimes(8))
        await waitFor(() => {
            const values = Array.from(view.container.querySelectorAll('.chart-ms'), node => node.textContent.trim())
            expect(values).toEqual(['22 ms', '22 ms', '22 ms'])
        })

        await act(async () => oldResolvers.forEach(resolve => resolve({ time: 99 })))
        const values = Array.from(view.container.querySelectorAll('.chart-ms'), node => node.textContent.trim())
        expect(values).toEqual(['22 ms', '22 ms', '22 ms'])
    })

    it('keeps Wi-Fi badges while marking transitional VPN data as non-authoritative', async () => {
        mocks.network.current = network({
            loading: false,
            enrichmentStatus: 'ready',
            networkEpoch: 200,
            underlayIdentityKey: 'wifi:office',
            linkType: 'wifi',
            ifaceName: 'Wi-Fi',
            localIP: '192.168.1.20',
            wifi: { ssid: 'Office', signal: '80%', wifiGen: { gen: 6, label: 'Wi-Fi 6' } },
            isVpn: true,
            vpnStatus: { active: true, tunnel: null },
            overlay: { type: 'vpn', active: true, tunnel: null, authoritative: false },
            transitioning: true,
            presentationStale: true,
            transitionStatus: 'retrying',
            publicIP: '203.0.113.10',
        })
        render(<MemoryRouter><Dashboard /></MemoryRouter>)

        expect((await screen.findAllByText('Updating network...')).length).toBeGreaterThan(0)
        expect(screen.getByText('Updating...')).toBeInTheDocument()
        expect(screen.getByText('Tunnel IP').nextSibling).toHaveTextContent('-')
        expect(screen.getByText('Wi-Fi 6')).toBeInTheDocument()
        expect(screen.queryByText('192.168.1.20', { selector: '.link-status-row strong' })).not.toBeInTheDocument()
    })

    it('keys Wi-Fi signal history by physical underlay while latency remains route-epoch scoped', async () => {
        const wifi = (signal, overrides = {}) => network({
            loading: false,
            enrichmentStatus: 'ready',
            networkEpoch: 300,
            underlayIdentityKey: 'wifi:office',
            linkType: 'wifi',
            ifaceName: 'Wi-Fi',
            localIP: '192.168.1.20',
            gateway: '192.168.1.1',
            wifi: { ssid: 'Office', signal },
            publicIP: '203.0.113.10',
            ...overrides,
        })

        mocks.network.current = wifi('80%')
        const view = render(<MemoryRouter><Dashboard /></MemoryRouter>)
        const signalSeries = () => JSON.parse(
            view.container.querySelector('.dash-card-signal [data-testid="area-chart"]')?.dataset.series || '[]'
        )
        await waitFor(() => expect(signalSeries()).toEqual([-60, -60]))

        mocks.network.current = wifi('80%', {
            networkEpoch: 301,
            gateway: null,
            isVpn: true,
            vpnStatus: { active: true, tunnel: { interfaceName: 'WireGuard', localIp: '10.8.0.2' } },
            overlay: { type: 'vpn', active: true, tunnel: { interfaceName: 'WireGuard', localIp: '10.8.0.2' } },
        })
        view.rerender(<MemoryRouter><Dashboard /></MemoryRouter>)
        expect(screen.getByText('VPN Tunnel')).toBeInTheDocument()

        mocks.network.current = wifi('60%', { networkEpoch: 302 })
        view.rerender(<MemoryRouter><Dashboard /></MemoryRouter>)
        await waitFor(() => expect(signalSeries()).toEqual([-60, -60, -70]))

        mocks.network.current = wifi('90%', {
            networkEpoch: 303,
            underlayIdentityKey: 'wifi:lab',
            wifi: { ssid: 'Lab', signal: '90%' },
        })
        view.rerender(<MemoryRouter><Dashboard /></MemoryRouter>)
        await waitFor(() => expect(signalSeries()).toEqual([-55, -55]))
    })
})
