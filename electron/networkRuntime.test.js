const { NetworkRuntime, shouldCollectWifiTelemetry } = require('./networkRuntime')

function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

function connectedCore() {
    return {
        interfaces: [{ name: 'Ethernet', family: 'IPv4', internal: false, address: '192.168.1.20' }],
        networkContext: { address: '192.168.1.20', gateway: null },
    }
}

describe('NetworkRuntime', () => {
    it('runs Wi-Fi telemetry only for a Wi-Fi underlay, including VPN over Wi-Fi', () => {
        expect(shouldCollectWifiTelemetry({
            underlay: { type: 'ethernet' },
            wifi: null,
            overlay: { active: false },
        })).toBe(false)
        expect(shouldCollectWifiTelemetry({
            underlay: { type: 'wifi' },
            wifi: { connected: true, ssid: 'Office' },
            overlay: { active: true },
        })).toBe(true)
    })

    it('publishes fast core data without waiting for native enrichment', () => {
        const native = deferred()
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment: () => native.promise,
            readFingerprint: () => 'ethernet|192.168.1.20',
            setIntervalFn: vi.fn(() => 1),
            clearIntervalFn: vi.fn(),
        })

        const snapshot = runtime.start()
        expect(snapshot.coreStatus).toBe('ready')
        expect(snapshot.linkState).toBe('connected')
        expect(snapshot.interfaces[0].address).toBe('192.168.1.20')
        expect(snapshot.enrichmentStatus).toBe('loading')
    })

    it('keeps a valid connected core state when enrichment fails', async () => {
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment: () => Promise.reject(new Error('native timeout')),
            readFingerprint: () => 'ethernet|192.168.1.20',
        })

        runtime.start()
        await runtime.refreshPromise
        const snapshot = runtime.getSnapshot()
        expect(snapshot.linkState).toBe('connected')
        expect(snapshot.coreStatus).toBe('ready')
        expect(snapshot.enrichmentStatus).toBe('error')
    })

    it('deduplicates concurrent refreshes', async () => {
        const native = deferred()
        const readEnrichment = vi.fn(() => native.promise)
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment,
            readFingerprint: () => 'ethernet|192.168.1.20',
        })

        runtime.start()
        const first = runtime.refreshPromise
        const second = runtime.refresh('periodic')
        expect(second).toBe(first)
        await Promise.resolve()
        expect(readEnrichment).toHaveBeenCalledTimes(1)
        native.resolve({ dns: ['192.168.1.1'] })
        await first
        expect(runtime.getMetrics()).toEqual(expect.objectContaining({
            enrichmentRuns: 1,
            deduplicatedRefreshes: 1,
            maxConcurrentEnrichments: 1,
        }))
    })

    it('discards stale enrichment and queues one refresh after a network change', async () => {
        const first = deferred()
        const second = deferred()
        const readEnrichment = vi.fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise)
        let fingerprint = 'ethernet|192.168.1.20'
        let fingerprintTick
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment,
            readFingerprint: () => fingerprint,
            onFingerprintChange: vi.fn(),
            setIntervalFn: vi.fn((callback) => { if (!fingerprintTick) fingerprintTick = callback; return 1 }),
            clearIntervalFn: vi.fn(),
        })

        runtime.start()
        await Promise.resolve()
        fingerprint = 'wifi|10.0.0.5'
        fingerprintTick()
        first.resolve({ networkContext: { address: 'stale', gateway: 'stale' } })
        await runtime.refreshPromise
        await Promise.resolve()
        expect(readEnrichment).toHaveBeenCalledTimes(2)
        expect(runtime.getSnapshot().networkContext?.address).not.toBe('stale')
        second.resolve({ networkContext: { address: '10.0.0.5', gateway: '10.0.0.1' } })
        await runtime.refreshPromise
        expect(runtime.getSnapshot().networkContext.address).toBe('10.0.0.5')
    })

    it('keeps one global Wi-Fi observer active for every app surface', async () => {
        const intervals = []
        const readTelemetry = vi.fn(() => Promise.resolve({ wifi: { ssid: 'Office', signal: '80%' } }))
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment: () => Promise.resolve({}),
            readTelemetry,
            readFingerprint: () => 'ethernet|192.168.1.20',
            telemetryAlwaysActive: true,
            setIntervalFn: vi.fn((callback, delay) => { intervals.push({ callback, delay }); return intervals.length }),
            clearIntervalFn: vi.fn(),
        })

        runtime.start()
        await runtime.refreshPromise
        await Promise.resolve()
        if (runtime.telemetryPromise) await runtime.telemetryPromise
        expect(readTelemetry).toHaveBeenCalledTimes(1)
        expect(intervals.filter(item => item.delay === 10000)).toHaveLength(1)
        runtime.stop()
        expect(runtime.telemetryTimer).toBeNull()
    })

    it('pauses visible-window telemetry and resumes with one immediate, non-duplicated observer', async () => {
        const intervals = []
        const cleared = []
        const readTelemetry = vi.fn(() => Promise.resolve({ wifi: { ssid: 'Office', signal: '80%' } }))
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment: () => Promise.resolve({}),
            readTelemetry,
            readFingerprint: () => 'wifi|192.168.1.20',
            setIntervalFn: vi.fn((callback, delay) => {
                intervals.push({ callback, delay })
                return intervals.length
            }),
            clearIntervalFn: vi.fn(timer => cleared.push(timer)),
        })

        runtime.start()
        await runtime.refreshPromise
        expect(readTelemetry).not.toHaveBeenCalled()

        runtime.setTelemetryActive(true)
        runtime.setTelemetryActive(true)
        if (runtime.telemetryPromise) await runtime.telemetryPromise
        expect(readTelemetry).toHaveBeenCalledTimes(1)
        expect(intervals.filter(item => item.delay === 10000)).toHaveLength(1)

        const firstTelemetryTimer = runtime.telemetryTimer
        runtime.setTelemetryActive(false)
        expect(cleared).toContain(firstTelemetryTimer)
        expect(runtime.telemetryTimer).toBeNull()

        runtime.setTelemetryActive(true)
        if (runtime.telemetryPromise) await runtime.telemetryPromise
        expect(readTelemetry).toHaveBeenCalledTimes(2)
        expect(intervals.filter(item => item.delay === 10000)).toHaveLength(2)
    })

    it('does not overlap telemetry with the heavier enrichment pass', async () => {
        const native = deferred()
        const readTelemetry = vi.fn(() => Promise.resolve({ wifi: { signal: '75%' } }))
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment: () => native.promise,
            readTelemetry,
            readFingerprint: () => 'ethernet|192.168.1.20',
            setIntervalFn: vi.fn(() => 1),
            clearIntervalFn: vi.fn(),
        })

        runtime.start()
        runtime.setTelemetryActive(true)
        const telemetry = runtime.refreshTelemetry()
        await Promise.resolve()
        expect(readTelemetry).not.toHaveBeenCalled()
        native.resolve({})
        await telemetry
        expect(readTelemetry).toHaveBeenCalledTimes(1)
    })

    it('publishes Wi-Fi to VPN to Wi-Fi as coherent epochs without partial nulls', async () => {
        const vpnConnect = deferred()
        const vpnDisconnect = deferred()
        let enrichmentCall = 0
        const readEnrichment = vi.fn(() => {
            enrichmentCall += 1
            if (enrichmentCall === 1) return Promise.resolve({
                wifi: { connected: true, ssid: 'Office', bssid: 'aa:aa', signal: '80%' },
                underlay: { type: 'wifi', connected: true, localIp: '192.168.1.20', wifi: { connected: true, ssid: 'Office', bssid: 'aa:aa', signal: '80%' } },
                overlay: { type: 'vpn', active: false, tunnel: null },
                vpnStatus: { active: false, tunnel: null },
            })
            if (enrichmentCall === 2) return vpnConnect.promise
            return vpnDisconnect.promise
        })
        const emitted = []
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment,
            readFingerprint: () => 'wifi|192.168.1.20',
            emit: snapshot => emitted.push(snapshot),
            setIntervalFn: vi.fn(() => 1),
            clearIntervalFn: vi.fn(),
        })

        runtime.start()
        await runtime.refreshPromise
        expect(runtime.getSnapshot()).toEqual(expect.objectContaining({
            networkEpoch: 0,
            wifi: expect.objectContaining({ ssid: 'Office' }),
            overlay: expect.objectContaining({ active: false }),
        }))

        runtime.notifyNetworkChange('vpn-connected', null, { transitionKey: 'vpn:on' })
        await Promise.resolve()
        const whileConnecting = runtime.getSnapshot()
        expect(whileConnecting.networkEpoch).toBe(0)
        expect(whileConnecting.transitioning).toBe(true)
        expect(whileConnecting.wifi.ssid).toBe('Office')
        expect(whileConnecting.vpnStatus.active).toBe(false)

        vpnConnect.resolve({
            wifi: { connected: true, ssid: 'Office', bssid: 'aa:aa', signal: '79%' },
            underlay: { type: 'wifi', connected: true, localIp: '192.168.1.20', wifi: { connected: true, ssid: 'Office', bssid: 'aa:aa', signal: '79%' } },
            overlay: { type: 'vpn', active: true, tunnel: { interfaceName: 'WireGuard', localIp: '10.8.0.2' } },
            vpnStatus: { active: true, tunnel: { interfaceName: 'WireGuard', localIp: '10.8.0.2' } },
        })
        await runtime.refreshPromise
        expect(runtime.getSnapshot()).toEqual(expect.objectContaining({
            networkEpoch: 1,
            wifi: expect.objectContaining({ ssid: 'Office' }),
            overlay: expect.objectContaining({ active: true, tunnel: expect.objectContaining({ interfaceName: 'WireGuard' }) }),
        }))

        runtime.notifyNetworkChange('vpn-disconnected', null, { transitionKey: 'vpn:off' })
        await Promise.resolve()
        const whileDisconnecting = runtime.getSnapshot()
        expect(whileDisconnecting.networkEpoch).toBe(1)
        expect(whileDisconnecting.wifi.ssid).toBe('Office')
        expect(whileDisconnecting.overlay.active).toBe(true)

        vpnDisconnect.resolve({
            wifi: { connected: true, ssid: 'Office', bssid: 'aa:aa', signal: '81%' },
            underlay: { type: 'wifi', connected: true, localIp: '192.168.1.20', wifi: { connected: true, ssid: 'Office', bssid: 'aa:aa', signal: '81%' } },
            overlay: { type: 'vpn', active: false, tunnel: null },
            vpnStatus: { active: false, tunnel: null },
        })
        await runtime.refreshPromise
        expect(runtime.getSnapshot()).toEqual(expect.objectContaining({
            networkEpoch: 2,
            wifi: expect.objectContaining({ ssid: 'Office' }),
            overlay: expect.objectContaining({ active: false, tunnel: null }),
        }))
        expect(emitted.some(snapshot => snapshot.networkEpoch > 0 && snapshot.wifi == null)).toBe(false)
    })

    it('coalesces observer and fingerprint signals into one enrichment for a transition', async () => {
        const transition = deferred()
        let fingerprint = 'wifi|192.168.1.20'
        let fingerprintTick
        const readEnrichment = vi.fn()
            .mockResolvedValueOnce({ wifi: { connected: true, ssid: 'Office', bssid: 'aa:aa' } })
            .mockReturnValueOnce(transition.promise)
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment,
            readFingerprint: () => fingerprint,
            setIntervalFn: vi.fn((callback, delay) => {
                if (delay === 5000) fingerprintTick = callback
                return delay
            }),
            clearIntervalFn: vi.fn(),
        })

        runtime.start()
        await runtime.refreshPromise
        fingerprint = 'wifi|10.0.0.5'
        fingerprintTick()
        runtime.notifyNetworkChange(
            'network-switch',
            { wifi: { connected: true, ssid: 'Guest', bssid: 'bb:bb' } },
            { transitionKey: 'wifi:bb:bb' },
        )
        await Promise.resolve()

        expect(runtime.generation).toBe(1)
        expect(readEnrichment).toHaveBeenCalledTimes(2)
        expect(runtime.getMetrics().coalescedNetworkSignals).toBe(1)
        transition.resolve({ wifi: { connected: true, ssid: 'Guest', bssid: 'bb:bb' } })
        await runtime.refreshPromise
    })

    it('coalesces a delayed fingerprint that follows the semantic Wi-Fi event', async () => {
        const transition = deferred()
        let fingerprint = 'wifi|192.168.1.20'
        let fingerprintTick
        const readEnrichment = vi.fn()
            .mockResolvedValueOnce({ wifi: { connected: true, ssid: 'Office', bssid: 'aa:aa' } })
            .mockReturnValueOnce(transition.promise)
        let now = 1000
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment,
            readFingerprint: () => fingerprint,
            now: () => now,
            setIntervalFn: vi.fn((callback, delay) => {
                if (delay === 5000) fingerprintTick = callback
                return delay
            }),
            clearIntervalFn: vi.fn(),
        })
        runtime.start()
        await runtime.refreshPromise

        runtime.notifyNetworkChange(
            'network-switch',
            { wifi: { connected: true, ssid: 'Guest', bssid: 'bb:bb' } },
            { transitionKey: 'wifi:bb:bb' },
        )
        await Promise.resolve()
        now += 4000
        fingerprint = 'wifi|10.0.0.5'
        fingerprintTick()

        expect(runtime.generation).toBe(1)
        expect(readEnrichment).toHaveBeenCalledTimes(2)
        expect(runtime.getMetrics().coalescedNetworkSignals).toBe(1)
        transition.resolve({ wifi: { connected: true, ssid: 'Guest', bssid: 'bb:bb' } })
        await runtime.refreshPromise
    })

    it('keeps the prior epoch visible and retries a non-authoritative transition with bounded single-flight work', async () => {
        const retries = []
        const readEnrichment = vi.fn()
            .mockResolvedValueOnce({
                identityKey: 'wifi|vpn:off',
                authoritative: true,
                wifi: { connected: true, ssid: 'Office' },
                overlay: { type: 'vpn', active: false, tunnel: null },
            })
            .mockResolvedValueOnce({
                identityKey: 'wifi|vpn:off',
                authoritative: false,
                errors: [{ source: 'vpn', code: 'read-unavailable' }],
                wifi: { connected: true, ssid: 'Office' },
                overlay: { type: 'vpn', active: false, tunnel: null },
            })
            .mockResolvedValueOnce({
                identityKey: 'wifi|vpn:on',
                authoritative: true,
                wifi: { connected: true, ssid: 'Office' },
                overlay: { type: 'vpn', active: true, tunnel: { interfaceName: 'WireGuard', localIp: '10.8.0.2' } },
            })
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment,
            readFingerprint: () => 'persistent-adapter',
            setIntervalFn: vi.fn(() => 1),
            clearIntervalFn: vi.fn(),
            setTimeoutFn: vi.fn((callback, delay) => {
                const timer = { callback, delay }
                retries.push(timer)
                return timer
            }),
            clearTimeoutFn: vi.fn(),
            transitionRetryDelaysMs: [1500, 4000],
        })

        runtime.start()
        await runtime.refreshPromise
        runtime.notifyNetworkChange('interface-change')
        await runtime.refreshPromise

        expect(runtime.getSnapshot()).toEqual(expect.objectContaining({
            networkEpoch: 0,
            transitioning: true,
            presentationStale: true,
            identityKey: 'wifi|vpn:off',
            overlay: expect.objectContaining({ active: false }),
        }))
        expect(retries).toHaveLength(1)
        expect(retries[0].delay).toBe(1500)

        retries[0].callback()
        await Promise.resolve()
        await runtime.refreshPromise
        expect(runtime.getSnapshot()).toEqual(expect.objectContaining({
            networkEpoch: 1,
            transitioning: false,
            presentationStale: false,
            identityKey: 'wifi|vpn:on',
            overlay: expect.objectContaining({ active: true }),
        }))
        expect(readEnrichment).toHaveBeenCalledTimes(3)
        expect(runtime.getMetrics()).toEqual(expect.objectContaining({
            transitionRetries: 1,
            nonAuthoritativeResults: 1,
            maxConcurrentEnrichments: 1,
        }))
    })

    it('marks an exhausted non-authoritative transition as degraded without publishing mixed fields', async () => {
        const readEnrichment = vi.fn()
            .mockResolvedValueOnce({ identityKey: 'vpn:off', authoritative: true, overlay: { active: false, tunnel: null } })
            .mockResolvedValueOnce({ identityKey: 'vpn:off', authoritative: false, overlay: { active: true, tunnel: { interfaceName: 'stale' } } })
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment,
            readFingerprint: () => 'persistent-adapter',
            setIntervalFn: vi.fn(() => 1),
            clearIntervalFn: vi.fn(),
            transitionRetryDelaysMs: [],
        })
        runtime.start()
        await runtime.refreshPromise
        runtime.notifyNetworkChange('interface-change')
        await runtime.refreshPromise

        expect(runtime.getSnapshot()).toEqual(expect.objectContaining({
            networkEpoch: 0,
            transitioning: true,
            presentationStale: true,
            transitionStatus: 'degraded',
            identityKey: 'vpn:off',
            overlay: expect.objectContaining({ active: false, tunnel: null }),
        }))
        expect(runtime.getMetrics().exhaustedTransitionRetries).toBe(1)
    })

    it('promotes a complete periodic route identity change without repeating enrichment', async () => {
        const onFingerprintChange = vi.fn()
        const readEnrichment = vi.fn()
            .mockResolvedValueOnce({
                identityKey: 'wifi|vpn:off',
                authoritative: true,
                overlay: { type: 'vpn', active: false, tunnel: null },
            })
            .mockResolvedValueOnce({
                identityKey: 'wifi|vpn:on|wintun|10.8.0.2',
                authoritative: true,
                overlay: { type: 'vpn', active: true, tunnel: { interfaceName: 'Wintun', localIp: '10.8.0.2' } },
            })
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment,
            readFingerprint: () => 'persistent-adapter-fingerprint',
            onFingerprintChange,
            setIntervalFn: vi.fn(() => 1),
            clearIntervalFn: vi.fn(),
        })
        runtime.start()
        await runtime.refreshPromise

        await runtime.refresh('periodic')
        expect(runtime.getSnapshot()).toEqual(expect.objectContaining({
            networkEpoch: 1,
            reason: 'network-identity-change',
            identityKey: 'wifi|vpn:on|wintun|10.8.0.2',
            overlay: expect.objectContaining({ active: true }),
        }))
        expect(readEnrichment).toHaveBeenCalledTimes(2)
        expect(onFingerprintChange).toHaveBeenCalledTimes(1)
        expect(runtime.getMetrics().detectedIdentityChanges).toBe(1)
    })

    it('clears every network layer atomically on a hard disconnect without native enrichment', async () => {
        let connected = true
        const readCore = () => connected ? connectedCore() : { interfaces: [], networkContext: null, networkContexts: [] }
        const readEnrichment = vi.fn(() => Promise.resolve({
            wifi: { connected: true, ssid: 'Office' },
            underlay: { type: 'wifi', connected: true, wifi: { connected: true, ssid: 'Office' } },
            overlay: { type: 'vpn', active: true, tunnel: { interfaceName: 'Tunnel', localIp: '10.0.0.2' } },
            vpnStatus: { active: true, tunnel: { interfaceName: 'Tunnel', localIp: '10.0.0.2' } },
        }))
        const runtime = new NetworkRuntime({
            readCore,
            readEnrichment,
            readFingerprint: () => connected ? 'wifi|192.168.1.20' : '',
            setIntervalFn: vi.fn(() => 1),
            clearIntervalFn: vi.fn(),
        })
        runtime.start()
        await runtime.refreshPromise
        connected = false
        runtime.notifyNetworkChange('disconnected', { wifi: null }, { transitionKey: 'wifi:disconnected' })
        runtime.notifyNetworkChange('disconnected', { wifi: null }, { transitionKey: 'wifi:disconnected' })

        expect(runtime.getSnapshot()).toEqual(expect.objectContaining({
            networkEpoch: 1,
            linkState: 'disconnected',
            wifi: null,
            underlay: null,
            overlay: expect.objectContaining({ active: false, tunnel: null }),
            vpnStatus: expect.objectContaining({ active: false, tunnel: null }),
        }))
        expect(runtime.generation).toBe(1)
        expect(readEnrichment).toHaveBeenCalledTimes(1)
    })

    it('does not misclassify an IPv6-only routed link as a hard disconnect', async () => {
        const enrichment = deferred()
        const runtime = new NetworkRuntime({
            readCore: () => ({
                interfaces: [{ name: 'Ethernet', family: 'IPv6', internal: false, address: '2001:db8::20' }],
                networkContext: null,
                networkContexts: [],
            }),
            readEnrichment: () => enrichment.promise,
            readFingerprint: () => 'ethernet|2001:db8::20',
            setIntervalFn: vi.fn(() => 1),
            clearIntervalFn: vi.fn(),
        })

        const snapshot = runtime.start()
        expect(snapshot.linkState).toBe('connected')
        expect(snapshot.enrichmentStatus).toBe('loading')
        enrichment.resolve({
            interfaces: [{ name: 'Ethernet', family: 'IPv6', internal: false, address: '2001:db8::20' }],
        })
        await runtime.refreshPromise
        expect(runtime.getSnapshot().linkState).toBe('connected')
    })

    it('invalidates deferred work across stop and start and commits only the new lifecycle', async () => {
        const oldRead = deferred()
        const newRead = deferred()
        const readEnrichment = vi.fn()
            .mockReturnValueOnce(oldRead.promise)
            .mockReturnValueOnce(newRead.promise)
        const runtime = new NetworkRuntime({
            readCore: connectedCore,
            readEnrichment,
            readFingerprint: () => 'ethernet|192.168.1.20',
            setIntervalFn: vi.fn(() => 1),
            clearIntervalFn: vi.fn(),
        })

        runtime.start()
        await Promise.resolve()
        runtime.stop()
        runtime.notifyNetworkChange('ignored-while-stopped')
        runtime.refresh('ignored-while-stopped')
        expect(runtime.generation).toBe(0)

        runtime.start()
        oldRead.resolve({ networkContext: { address: 'stale', gateway: 'stale' } })
        await runtime.refreshPromise
        await Promise.resolve()
        expect(readEnrichment).toHaveBeenCalledTimes(2)
        expect(runtime.getSnapshot().networkContext?.address).not.toBe('stale')

        newRead.resolve({ networkContext: { address: '192.168.1.20', gateway: '192.168.1.1' } })
        await runtime.refreshPromise
        expect(runtime.getSnapshot()).toEqual(expect.objectContaining({
            networkEpoch: 1,
            networkContext: expect.objectContaining({ gateway: '192.168.1.1' }),
        }))
    })
})
