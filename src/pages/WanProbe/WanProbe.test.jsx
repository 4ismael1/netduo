import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import WanProbe from './WanProbe'
import bridge from '../../lib/electronBridge'

vi.mock('framer-motion', () => {
    function MotionDiv(props) {
        const {
            children,
            initial,
            animate,
            exit,
            transition,
            whileHover,
            whileTap,
            ...rest
        } = props
        void initial
        void animate
        void exit
        void transition
        void whileHover
        void whileTap
        return <div {...rest}>{children}</div>
    }

    return {
        AnimatePresence: ({ children }) => <>{children}</>,
        motion: new Proxy({}, { get: () => MotionDiv }),
    }
})

vi.mock('../../lib/electronBridge', () => ({
    default: {
        configGet: vi.fn(),
        configSet: vi.fn(),
        wanProbeConfigGet: vi.fn(),
        wanProbeConfigSet: vi.fn(),
        wanProbeRequest: vi.fn(),
        openExternal: vi.fn(() => Promise.resolve({ ok: true })),
    },
}))

function makeProbe(index, url) {
    return {
        id: `probe-${index + 1}`,
        name: `Probe ${index + 1}`,
        url,
        apiKey: `api-key-${index + 1}`,
        selected: true,
        connected: true,
        info: {
            observedIp: '198.51.100.9',
            udpEnabled: true,
            raw: {
                mode: { allowExternalTarget: true, requirePublicTarget: true },
                defaults: { mode: 'quick', profile: 'balanced', transport: 'auto' },
                connect: { probeUrl: url, token: 'NDUO_PROBE_V1:mock' },
                udpEnabled: true,
                quickUdpPorts: [53, 123],
                advancedUdpPorts: [53, 123, 161],
                deepUdpPorts: [53, 123, 161, 1900],
            },
            node: { region: 'Virginia', country: 'United States' },
        },
        lastCheckedAt: '2026-03-02T00:00:00.000Z',
    }
}

function makeDisconnectedProbe(index, url) {
    return {
        ...makeProbe(index, url),
        connected: false,
    }
}

function buildPortRows(ports) {
    return ports.map(port => ({
        port,
        protocol: 'tcp',
        service: port === 443 ? 'https' : 'unknown',
        state: 'closed',
        attempts: 1,
        rttMs: null,
    }))
}

function setupWanProbeMocks({
    probes,
    mode = 'quick',
    profile = 'balanced',
    transport = 'auto',
    reportRowsPerProbe = 40,
    resultFactory = null,
}) {
    const configMap = {
        wanProbePool: probes,
        wanProbeMode: mode,
        wanProbeProfile: profile,
        wanProbeTransport: transport,
        wanProbeUseCustomTarget: false,
        wanProbeTarget: '',
        wanProbeCustomPorts: '',
        wanProbeUsePortRange: false,
        wanProbeRangeFrom: '',
        wanProbeRangeTo: '',
        wanProbeCustomUdpPorts: '',
        wanProbeUseUdpPortRange: false,
        wanProbeUdpRangeFrom: '',
        wanProbeUdpRangeTo: '',
    }

    bridge.wanProbeConfigGet.mockResolvedValue(configMap)
    bridge.wanProbeConfigSet.mockResolvedValue(true)
    bridge.configGet.mockImplementation(key => Promise.resolve(configMap[key] ?? null))
    bridge.configSet.mockResolvedValue(true)

    const startPayloads = []
    const jobPayloadById = new Map()
    let jobCounter = 0

    bridge.wanProbeRequest.mockImplementation(async ({ url, method = 'GET', body }) => {
        const parsedUrl = new URL(url)
        const pathname = parsedUrl.pathname

        if (pathname === '/scan/start' && method === 'POST') {
            const payload = JSON.parse(body || '{}')
            const jobId = `job-${++jobCounter}`
            startPayloads.push(payload)
            jobPayloadById.set(jobId, payload)

            return {
                status: 202,
                data: {
                    ok: true,
                    jobId,
                    mode: payload.mode,
                    profile: payload.profile,
                },
            }
        }

        if (pathname.startsWith('/scan/') && method === 'GET') {
            const jobId = pathname.split('/').pop()
            const payload = jobPayloadById.get(jobId) || {}
            if (typeof resultFactory === 'function') {
                return {
                    status: 200,
                    data: resultFactory({ jobId, payload, mode, profile, reportRowsPerProbe }),
                }
            }

            const reportPorts = Array.isArray(payload.ports)
                ? payload.ports.slice(0, reportRowsPerProbe)
                : []
            const results = buildPortRows(reportPorts)

            return {
                status: 200,
                data: {
                    id: jobId,
                    status: 'done',
                    mode: payload.mode || mode,
                    profile: payload.profile || profile,
                    target: '198.51.100.9',
                    observedIp: '198.51.100.9',
                    durationMs: 4200,
                    ports: reportPorts,
                    results,
                    openCount: 0,
                    closedCount: results.length,
                    filteredCount: 0,
                    findings: [],
                    riskScore: 5,
                    confidenceScore: 97,
                },
            }
        }

        return { status: 404, data: { error: 'Not found' } }
    })

    return { startPayloads }
}

describe('WanProbe scan flow', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('sends identical deep port scope to every selected probe', async () => {
        const probes = [
            makeProbe(0, 'http://129.153.20.145:9443'),
            makeProbe(1, 'http://138.197.16.41:9443'),
        ]
        const { startPayloads } = setupWanProbeMocks({
            probes,
            mode: 'deep',
            profile: 'balanced',
            reportRowsPerProbe: 20,
        })

        render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('2 shown / 2 total')).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))

        await waitFor(() => expect(startPayloads).toHaveLength(2))

        expect(startPayloads[0].mode).toBe('deep')
        expect(startPayloads[1].mode).toBe('deep')
        expect(startPayloads[0].ports.length).toBeGreaterThan(2000)
        expect(startPayloads[0].ports).toEqual(startPayloads[1].ports)
    })

    it('respects selected analysis mode and profile in scan payload', async () => {
        const probes = [
            makeProbe(0, 'http://129.153.20.145:9443'),
            makeProbe(1, 'http://138.197.16.41:9443'),
        ]
        const { startPayloads } = setupWanProbeMocks({
            probes,
            mode: 'quick',
            profile: 'balanced',
            reportRowsPerProbe: 20,
        })

        render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('2 shown / 2 total')).toBeInTheDocument())

        fireEvent.click(screen.getByText('Advanced').closest('button'))
        fireEvent.click(screen.getByText('Aggressive').closest('button'))
        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))

        await waitFor(() => expect(startPayloads).toHaveLength(2))

        expect(startPayloads[0].mode).toBe('advanced')
        expect(startPayloads[0].profile).toBe('aggressive')
        expect(startPayloads[1].mode).toBe('advanced')
        expect(startPayloads[1].profile).toBe('aggressive')
        expect(startPayloads[0].ports).toEqual(startPayloads[1].ports)
        expect(startPayloads[0].ports.length).toBeGreaterThan(100)
    })

    it('keeps deep auto scans in TCP runtime mode', async () => {
        const probes = [
            makeProbe(0, 'http://129.153.20.145:9443'),
            makeProbe(1, 'http://138.197.16.41:9443'),
        ]
        const { startPayloads } = setupWanProbeMocks({
            probes,
            mode: 'deep',
            profile: 'balanced',
            transport: 'auto',
            reportRowsPerProbe: 20,
        })

        render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('2 shown / 2 total')).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))
        await waitFor(() => expect(startPayloads).toHaveLength(2))

        expect(startPayloads[0].transport).toBe('auto')
        expect(startPayloads[0].ports.length).toBeGreaterThan(1200)
        expect(startPayloads[0].udpPorts).toBeUndefined()
        expect(startPayloads[1].udpPorts).toBeUndefined()
    })

    it('sends transport=udp when UDP-only is selected', async () => {
        const probes = [makeProbe(0, 'http://129.153.20.145:9443')]
        const { startPayloads } = setupWanProbeMocks({
            probes,
            mode: 'advanced',
            profile: 'balanced',
            transport: 'auto',
            reportRowsPerProbe: 20,
        })

        render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('1 shown / 1 total')).toBeInTheDocument())

        fireEvent.click(screen.getByText('Custom scope').closest('button'))

        const customAreas = screen.getAllByPlaceholderText('22,80,443,8080')
        fireEvent.change(customAreas[0], { target: { value: '53,67,123,1900' } })

        fireEvent.click(screen.getByText('UDP only').closest('button'))
        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))

        await waitFor(() => expect(startPayloads).toHaveLength(1))
        expect(startPayloads[0].transport).toBe('udp')
        expect(startPayloads[0].mode).toBe('quick')
        expect(Array.isArray(startPayloads[0].ports)).toBe(true)
    })

    it('updates preset port counts when transport selection changes', async () => {
        const probes = [makeProbe(0, 'http://129.153.20.145:9443')]
        setupWanProbeMocks({
            probes,
            mode: 'advanced',
            profile: 'balanced',
            transport: 'auto',
            reportRowsPerProbe: 20,
        })

        render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('1 shown / 1 total')).toBeInTheDocument())

        const findAdvancedModeCard = () => (
            screen
                .getAllByText('Advanced')
                .map(node => node.closest('button'))
                .find(button => button?.classList?.contains('wp2-mode-card'))
        )

        let advancedCard = findAdvancedModeCard()
        expect(advancedCard).toBeTruthy()
        expect(advancedCard).toHaveTextContent('149 TCP ports')

        fireEvent.click(screen.getByText('UDP only').closest('button'))
        await waitFor(() => {
            advancedCard = findAdvancedModeCard()
            expect(advancedCard).toBeTruthy()
            expect(advancedCard).toHaveTextContent('37 UDP ports')
        })

        const bothTransportButton = screen
            .getAllByText('TCP + UDP')
            .map(node => node.closest('button'))
            .find(Boolean)
        expect(bothTransportButton).toBeTruthy()
        fireEvent.click(bothTransportButton)

        await waitFor(() => {
            advancedCard = findAdvancedModeCard()
            expect(advancedCard).toBeTruthy()
            expect(advancedCard).toHaveTextContent('186 checks')
        })
    })

    it('sends transport=tcp when TCP-only is selected with custom scope', async () => {
        const probes = [makeProbe(0, 'http://129.153.20.145:9443')]
        const { startPayloads } = setupWanProbeMocks({
            probes,
            mode: 'advanced',
            profile: 'balanced',
            transport: 'auto',
            reportRowsPerProbe: 20,
        })

        render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('1 shown / 1 total')).toBeInTheDocument())

        fireEvent.click(screen.getByText('Custom scope').closest('button'))
        fireEvent.change(screen.getAllByPlaceholderText('22,80,443,8080')[0], { target: { value: '80,443,8443' } })
        fireEvent.click(screen.getByText('TCP only').closest('button'))
        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))

        await waitFor(() => expect(startPayloads).toHaveLength(1))
        expect(startPayloads[0].transport).toBe('tcp')
        expect(startPayloads[0].ports).toEqual([80, 443, 8443])
        expect(startPayloads[0].udpPorts).toBeUndefined()
    })

    it('sends both tcp and udp scopes when TCP+UDP is selected with UDP override', async () => {
        const probes = [makeProbe(0, 'http://129.153.20.145:9443')]
        const { startPayloads } = setupWanProbeMocks({
            probes,
            mode: 'advanced',
            profile: 'balanced',
            transport: 'both',
            reportRowsPerProbe: 20,
        })

        render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('1 shown / 1 total')).toBeInTheDocument())

        fireEvent.click(screen.getByText('Custom scope').closest('button'))
        fireEvent.change(screen.getAllByPlaceholderText('22,80,443,8080')[0], { target: { value: '80,443' } })
        const bothTransportButton = screen
            .getAllByText('TCP + UDP')
            .map(node => node.closest('button'))
            .find(Boolean)
        expect(bothTransportButton).toBeTruthy()
        fireEvent.click(bothTransportButton)
        fireEvent.change(screen.getByPlaceholderText('53,67,68,123,161,1900'), { target: { value: '53,123' } })
        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))

        await waitFor(() => expect(startPayloads).toHaveLength(1))
        expect(startPayloads[0].transport).toBe('both')
        expect(startPayloads[0].ports).toEqual([80, 443])
        expect(startPayloads[0].udpPorts).toEqual([53, 123])
    })

    it('blocks UDP scan when selected probe reports UDP disabled', async () => {
        const probe = makeProbe(0, 'http://129.153.20.145:9443')
        probe.info.udpEnabled = false
        probe.info.raw = {
            mode: { allowExternalTarget: true, requirePublicTarget: true },
            udpEnabled: false,
            quickUdpPorts: [],
            advancedUdpPorts: [],
            deepUdpPorts: [],
        }
        setupWanProbeMocks({
            probes: [probe],
            mode: 'advanced',
            profile: 'balanced',
            transport: 'udp',
            reportRowsPerProbe: 20,
        })

        render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('1 shown / 1 total')).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))

        expect(await screen.findByText(/UDP scan is disabled on probe\(s\): Probe 1\./i)).toBeInTheDocument()
        expect(bridge.wanProbeRequest).not.toHaveBeenCalled()
    })

    it('blocks UDP scan when probe capabilities are unknown and asks to refresh', async () => {
        const probe = makeProbe(0, 'http://129.153.20.145:9443')
        delete probe.info.raw
        probe.lastCheckedAt = null
        setupWanProbeMocks({
            probes: [probe],
            mode: 'advanced',
            profile: 'balanced',
            transport: 'udp',
            reportRowsPerProbe: 20,
        })

        render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('1 shown / 1 total')).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))

        expect(await screen.findByText(/Cannot verify UDP capability for probe\(s\): Probe 1\./i)).toBeInTheDocument()
        expect(bridge.wanProbeRequest).not.toHaveBeenCalled()
    })

    it('allows UDP scan after app restart when cached capability was previously verified', async () => {
        const probe = makeProbe(0, 'http://129.153.20.145:9443')
        delete probe.info.raw
        probe.info.capabilityVerified = true

        const { startPayloads } = setupWanProbeMocks({
            probes: [probe],
            mode: 'advanced',
            profile: 'balanced',
            transport: 'udp',
            reportRowsPerProbe: 20,
        })

        render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('1 shown / 1 total')).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))
        await waitFor(() => expect(startPayloads).toHaveLength(1))

        expect(screen.queryByText(/Cannot verify UDP capability/i)).not.toBeInTheDocument()
        expect(startPayloads[0].transport).toBe('udp')
    })

    it('paginates probe report rows in groups of 10', async () => {
        const probes = [makeProbe(0, 'http://129.153.20.145:9443')]
        setupWanProbeMocks({
            probes,
            mode: 'advanced',
            profile: 'balanced',
            reportRowsPerProbe: 40,
        })

        const { container } = render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('1 shown / 1 total')).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))

        await waitFor(() => expect(screen.getByText('Page 1 / 4')).toBeInTheDocument())

        const pageOneRows = container.querySelectorAll('.np-table tbody tr')
        expect(pageOneRows).toHaveLength(10)
        const firstPortPageOne = pageOneRows[0]?.querySelector('td')?.textContent

        fireEvent.click(screen.getByRole('button', { name: 'Next' }))
        await waitFor(() => expect(screen.getByText('Page 2 / 4')).toBeInTheDocument())

        const pageTwoRows = container.querySelectorAll('.np-table tbody tr')
        expect(pageTwoRows).toHaveLength(10)
        const firstPortPageTwo = pageTwoRows[0]?.querySelector('td')?.textContent
        expect(firstPortPageTwo).not.toBe(firstPortPageOne)

        fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
        await waitFor(() => expect(screen.getByText('Page 1 / 4')).toBeInTheDocument())
    })

    it('aggregates unique open ports across multiple probes instead of summing duplicates', async () => {
        const probes = [
            makeProbe(0, 'http://129.153.20.145:9443'),
            makeProbe(1, 'http://138.197.16.41:9443'),
            makeProbe(2, 'http://170.64.185.192:9443'),
        ]

        setupWanProbeMocks({
            probes,
            mode: 'advanced',
            profile: 'balanced',
            resultFactory: ({ jobId, payload }) => {
                const openPorts = [22, 80, 443]
                const renderedPorts = [22, 80, 443, 8080, 8443]
                const results = renderedPorts.map(port => ({
                    port,
                    protocol: 'tcp',
                    service: port === 443 ? 'https' : 'unknown',
                    state: openPorts.includes(port) ? 'open' : 'closed',
                    attempts: 1,
                    rttMs: openPorts.includes(port) ? 12 : null,
                }))

                return {
                    id: jobId,
                    status: 'done',
                    mode: payload.mode || 'advanced',
                    profile: payload.profile || 'balanced',
                    target: '198.51.100.9',
                    observedIp: '198.51.100.9',
                    durationMs: 5200,
                    ports: Array.isArray(payload.ports) ? payload.ports : renderedPorts,
                    results,
                    openCount: 3,
                    closedCount: 2,
                    filteredCount: 0,
                    findings: [{
                        id: 'remote-admin-surface',
                        severity: 'high',
                        category: 'remote-admin',
                        title: 'Remote admin surface visible',
                        evidence: 'Admin ports open on WAN.',
                        recommendation: 'Restrict access.',
                        confidence: 0.9,
                        impact: 'Attack surface increase.',
                        ports: openPorts,
                    }],
                    riskScore: 32,
                    confidenceScore: 94,
                }
            },
        })

        const { container } = render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('3 shown / 3 total')).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))
        await waitFor(() => expect(screen.getByText('Probe Reports')).toBeInTheDocument())

        const openCount = container.querySelector('.wp2-stat-item.tone-danger .wp2-stat-val')?.textContent
        const findingsCount = container.querySelector('.wp2-stat-item.tone-accent .wp2-stat-val')?.textContent
        expect(openCount).toBe('3')
        expect(findingsCount).toBe('1')
    })

    it('filters report rows by protocol', async () => {
        const probes = [makeProbe(0, 'http://129.153.20.145:9443')]
        setupWanProbeMocks({
            probes,
            mode: 'advanced',
            profile: 'balanced',
            resultFactory: ({ jobId, payload }) => ({
                id: jobId,
                status: 'done',
                mode: payload.mode || 'advanced',
                profile: payload.profile || 'balanced',
                transport: 'both',
                target: '198.51.100.9',
                observedIp: '198.51.100.9',
                durationMs: 3900,
                ports: [53, 80, 443],
                udpPorts: [53],
                results: [
                    { port: 53, protocol: 'udp', service: 'dns', state: 'open', attempts: 1, rttMs: 9 },
                    { port: 80, protocol: 'tcp', service: 'http', state: 'closed', attempts: 1, rttMs: null },
                    { port: 443, protocol: 'tcp', service: 'https', state: 'open', attempts: 1, rttMs: 12 },
                ],
                openCount: 2,
                closedCount: 1,
                filteredCount: 0,
                findings: [],
                riskScore: 18,
                confidenceScore: 96,
            }),
        })

        const { container } = render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('1 shown / 1 total')).toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))
        await waitFor(() => expect(screen.getByText('Probe Reports')).toBeInTheDocument())

        const allRows = container.querySelectorAll('.np-table tbody tr')
        expect(allRows).toHaveLength(3)

        fireEvent.click(screen.getByRole('button', { name: 'udp' }))
        const udpRows = container.querySelectorAll('.np-table tbody tr')
        expect(udpRows).toHaveLength(1)
        expect(udpRows[0]?.textContent).toContain('UDP')
    })

    it('blocks scan when selected probes are disconnected', async () => {
        const probes = [
            makeDisconnectedProbe(0, 'http://129.153.20.145:9443'),
            makeDisconnectedProbe(1, 'http://138.197.16.41:9443'),
        ]
        setupWanProbeMocks({
            probes,
            mode: 'advanced',
            profile: 'balanced',
        })

        render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('2 shown / 2 total')).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))

        expect(await screen.findByText('No selected probe is connected.')).toBeInTheDocument()
        expect(bridge.wanProbeRequest).not.toHaveBeenCalled()
    })

    it('reset results returns to setup and clears report state', async () => {
        const probes = [makeProbe(0, 'http://129.153.20.145:9443')]
        setupWanProbeMocks({
            probes,
            mode: 'advanced',
            profile: 'balanced',
            reportRowsPerProbe: 30,
        })

        render(<WanProbe />)
        await waitFor(() => expect(screen.getByText('1 shown / 1 total')).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: /Start Multi-Probe Scan/i }))
        await waitFor(() => expect(screen.getByText('Probe Reports')).toBeInTheDocument())

        const resetButton = screen.getByRole('button', { name: /Reset Results/i })
        fireEvent.click(resetButton)

        await waitFor(() => expect(screen.getByText('Scan Profile')).toBeInTheDocument())
        expect(screen.queryByText('Probe Reports')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Reset Results/i })).toBeDisabled()
    })
})
