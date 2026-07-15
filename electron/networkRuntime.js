function shouldCollectWifiTelemetry(snapshot) {
    return snapshot?.underlay?.type === 'wifi' && snapshot?.wifi?.connected !== false
}

class NetworkRuntime {
    constructor({
        readCore,
        readEnrichment,
        readFingerprint,
        readTelemetry = null,
        onFingerprintChange = () => {},
        emit = () => {},
        log = () => {},
        now = () => Date.now(),
        setIntervalFn = setInterval,
        clearIntervalFn = clearInterval,
        setTimeoutFn = setTimeout,
        clearTimeoutFn = clearTimeout,
        fingerprintIntervalMs = 5000,
        refreshIntervalMs = 60000,
        telemetryIntervalMs = 10000,
        telemetryAlwaysActive = false,
        transitionRetryDelaysMs = [1500, 4000],
    }) {
        if (typeof readCore !== 'function') throw new TypeError('readCore is required')
        if (typeof readEnrichment !== 'function') throw new TypeError('readEnrichment is required')
        if (typeof readFingerprint !== 'function') throw new TypeError('readFingerprint is required')

        this.readCore = readCore
        this.readEnrichment = readEnrichment
        this.readFingerprint = readFingerprint
        this.readTelemetry = typeof readTelemetry === 'function' ? readTelemetry : null
        this.onFingerprintChange = onFingerprintChange
        this.emit = emit
        this.log = log
        this.now = now
        this.setIntervalFn = setIntervalFn
        this.clearIntervalFn = clearIntervalFn
        this.setTimeoutFn = setTimeoutFn
        this.clearTimeoutFn = clearTimeoutFn
        this.fingerprintIntervalMs = fingerprintIntervalMs
        this.refreshIntervalMs = refreshIntervalMs
        this.telemetryIntervalMs = telemetryIntervalMs
        this.telemetryAlwaysActive = telemetryAlwaysActive === true
        this.transitionRetryDelaysMs = Array.isArray(transitionRetryDelaysMs)
            ? transitionRetryDelaysMs.map(Number).filter(value => Number.isFinite(value) && value >= 0)
            : []

        this.snapshot = Object.freeze({
            revision: 0,
            generation: 0,
            networkEpoch: 0,
            pendingNetworkEpoch: null,
            coherent: false,
            transitioning: false,
            presentationStale: false,
            transitionStatus: 'idle',
            identityKey: null,
            underlayIdentityKey: null,
            phase: 'initializing',
            coreStatus: 'pending',
            enrichmentStatus: 'pending',
            linkState: 'unknown',
            updatedAt: 0,
            reason: 'initializing',
            interfaces: [],
            networkContext: null,
            networkContexts: [],
            underlay: null,
            underlayGateway: null,
            overlay: Object.freeze({ type: 'vpn', active: false, tunnel: null, authoritative: false }),
            wifi: null,
            dns: [],
            vpnStatus: null,
            sysInfo: null,
            errors: [],
        })
        this.generation = 0
        this.lifecycleEpoch = 0
        this.hasStarted = false
        this.fingerprint = null
        this.candidateCore = null
        this.candidateGeneration = 0
        this.activeTransition = null
        this.refreshPromise = null
        this.queuedRefreshReason = null
        this.fingerprintTimer = null
        this.refreshTimer = null
        this.telemetryTimer = null
        this.telemetryPromise = null
        this.transitionRetryTimer = null
        this.transitionRetryGeneration = null
        this.transitionRetryAttempt = 0
        this.telemetryActive = false
        this.stopped = true
        this.metrics = {
            coreReads: 0,
            enrichmentRuns: 0,
            deduplicatedRefreshes: 0,
            coalescedNetworkSignals: 0,
            staleResults: 0,
            enrichmentErrors: 0,
            maxConcurrentEnrichments: 0,
            activeEnrichments: 0,
            lastDurationMs: null,
            telemetryRuns: 0,
            deduplicatedTelemetryReads: 0,
            nonAuthoritativeResults: 0,
            transitionRetries: 0,
            exhaustedTransitionRetries: 0,
            detectedIdentityChanges: 0,
        }
    }

    start() {
        if (!this.stopped) return this.getSnapshot()
        this.lifecycleEpoch += 1
        if (this.hasStarted) {
            this.generation += 1
            this.onFingerprintChange()
        }
        this.hasStarted = true
        this.stopped = false
        this.fingerprint = this.safeReadFingerprint()
        this.refreshCore('startup')
        this.refresh('startup')

        this.fingerprintTimer = this.setIntervalFn(() => {
            try {
                const next = this.readFingerprint()
                if (next === this.fingerprint) return
                this.beginNetworkTransition('interface-change', {
                    fingerprint: next,
                    semanticKey: null,
                })
            } catch (error) {
                this.log('fingerprint-error', { error: error?.message || String(error) })
            }
        }, this.fingerprintIntervalMs)

        this.refreshTimer = this.setIntervalFn(() => {
            this.refresh('periodic')
        }, this.refreshIntervalMs)
        if (this.telemetryAlwaysActive) this.setTelemetryActive(true)

        return this.getSnapshot()
    }

    stop() {
        this.stopped = true
        this.lifecycleEpoch += 1
        this.telemetryActive = false
        if (this.fingerprintTimer) this.clearIntervalFn(this.fingerprintTimer)
        if (this.refreshTimer) this.clearIntervalFn(this.refreshTimer)
        if (this.telemetryTimer) this.clearIntervalFn(this.telemetryTimer)
        this.clearTransitionRetry()
        this.fingerprintTimer = null
        this.refreshTimer = null
        this.telemetryTimer = null
        this.queuedRefreshReason = null
        this.activeTransition = null
    }

    getSnapshot() {
        if (!this.stopped && this.snapshot.revision === 0) this.refreshCore('on-demand')
        return this.snapshot
    }

    getMetrics() {
        return { ...this.metrics }
    }

    safeReadFingerprint() {
        try { return this.readFingerprint() } catch { return null }
    }

    semanticKeyForChange(reason, patch, explicitKey) {
        if (explicitKey != null && explicitKey !== '') return String(explicitKey)
        const wifi = patch?.wifi
        if (wifi && typeof wifi === 'object') {
            const identity = wifi.bssid || wifi.ssid || (wifi.connected === false ? 'disconnected' : 'connected')
            return `wifi:${String(identity || 'unknown').toLowerCase()}`
        }
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'wifi') && patch.wifi == null) return 'wifi:disconnected'
        return reason === 'interface-change' ? null : String(reason || 'network-change')
    }

    beginNetworkTransition(reason, { patch = null, fingerprint = undefined, semanticKey = undefined } = {}) {
        if (this.stopped) return this.snapshot
        const observedFingerprint = fingerprint === undefined ? this.safeReadFingerprint() : fingerprint
        const nextSemanticKey = this.semanticKeyForChange(reason, patch, semanticKey)
        const active = this.activeTransition
        const sameFingerprint = Boolean(active) && active.fingerprint === observedFingerprint
        const sameSemanticTransition = !active?.semanticKey || !nextSemanticKey || active.semanticKey === nextSemanticKey
        const withinObserverWindow = Boolean(active)
            && (this.now() - active.startedAt) <= (this.fingerprintIntervalMs + 1000)
        const observerPair = !active?.completed && withinObserverWindow && (
            (reason === 'interface-change' && Boolean(active.semanticKey))
            || (active.reason === 'interface-change' && Boolean(nextSemanticKey))
        )

        // The Wi-Fi observer and the interface fingerprint frequently describe
        // the same physical transition a few milliseconds apart. Attach the
        // richer semantic signal to the active epoch instead of starting a
        // second native enrichment pass.
        if (active && ((sameFingerprint && sameSemanticTransition) || observerPair)) {
            if (!active.semanticKey && nextSemanticKey) active.semanticKey = nextSemanticKey
            if (patch && typeof patch === 'object') {
                this.candidateCore = { ...(this.candidateCore || {}), ...patch }
            }
            this.fingerprint = observedFingerprint
            active.fingerprint = observedFingerprint
            this.metrics.coalescedNetworkSignals += 1
            this.log('network-signal-coalesced', { generation: this.generation, reason })
            return this.snapshot
        }

        this.generation += 1
        this.clearTransitionRetry()
        this.fingerprint = observedFingerprint
        this.activeTransition = {
            generation: this.generation,
            fingerprint: observedFingerprint,
            semanticKey: nextSemanticKey,
            reason,
            startedAt: this.now(),
        }
        this.onFingerprintChange()
        this.refreshCore(reason, patch)
        this.refresh(reason)
        return this.snapshot
    }

    notifyNetworkChange(reason = 'network-change', patch = null, options = {}) {
        return this.beginNetworkTransition(reason, {
            patch,
            fingerprint: options?.fingerprint,
            semanticKey: options?.transitionKey,
        })
    }

    clearTransitionRetry() {
        if (this.transitionRetryTimer) this.clearTimeoutFn(this.transitionRetryTimer)
        this.transitionRetryTimer = null
        this.transitionRetryGeneration = null
        this.transitionRetryAttempt = 0
    }

    scheduleTransitionRetry(generation) {
        if (this.stopped || this.transitionRetryTimer) return false
        if (this.transitionRetryGeneration !== generation) {
            this.transitionRetryGeneration = generation
            this.transitionRetryAttempt = 0
        }
        const delay = this.transitionRetryDelaysMs[this.transitionRetryAttempt]
        if (!Number.isFinite(delay)) {
            this.metrics.exhaustedTransitionRetries += 1
            return false
        }
        this.transitionRetryAttempt += 1
        this.metrics.transitionRetries += 1
        this.transitionRetryTimer = this.setTimeoutFn(() => {
            this.transitionRetryTimer = null
            if (this.stopped || this.generation !== generation) return
            this.refresh('critical-retry')
        }, delay)
        return true
    }

    setTelemetryActive(active) {
        if (!this.readTelemetry) return false
        if (active === true && this.stopped) return false
        this.telemetryActive = active === true
        if (!active) {
            if (this.telemetryTimer) this.clearIntervalFn(this.telemetryTimer)
            this.telemetryTimer = null
            return false
        }
        if (this.telemetryTimer) return true
        this.refreshTelemetry()
        this.telemetryTimer = this.setIntervalFn(() => this.refreshTelemetry(), this.telemetryIntervalMs)
        return true
    }

    refreshTelemetry() {
        if (!this.readTelemetry || !this.telemetryActive) return Promise.resolve(this.snapshot)
        if (this.telemetryPromise) {
            this.metrics.deduplicatedTelemetryReads += 1
            return this.telemetryPromise
        }
        if (this.refreshPromise) {
            this.metrics.deduplicatedTelemetryReads += 1
            return this.refreshPromise.then(() => this.refreshTelemetry())
        }
        this.metrics.telemetryRuns += 1
        const generation = this.generation
        const lifecycleEpoch = this.lifecycleEpoch
        const pending = Promise.resolve()
            .then(() => this.readTelemetry({ generation }))
            .then(patch => {
                if (this.stopped || lifecycleEpoch !== this.lifecycleEpoch || generation !== this.generation) {
                    this.metrics.staleResults += 1
                    return this.snapshot
                }
                if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) return this.snapshot
                return this.commit(patch, 'telemetry')
            })
            .catch(error => {
                this.log('telemetry-error', { error: error?.message || String(error) })
                return this.snapshot
            })
            .finally(() => {
                if (this.telemetryPromise === pending) this.telemetryPromise = null
            })
        this.telemetryPromise = pending
        return pending
    }

    refreshCore(reason, patch = null) {
        if (this.stopped) return this.snapshot
        try {
            this.metrics.coreReads += 1
            const core = this.readCore() || {}
            const interfaces = Array.isArray(core.interfaces) ? core.interfaces : []
            const hasExternalAddress = interfaces.some(item => {
                if (item?.internal) return false
                const family = String(item?.family || '')
                const address = String(item?.address || '').trim().toLowerCase()
                if (family === 'IPv4' || family === '4') return Boolean(address && !address.startsWith('169.254.'))
                if (family === 'IPv6' || family === '6') {
                    return Boolean(address && address !== '::' && address !== '::1' && !address.startsWith('fe80:'))
                }
                return false
            })
            const linkState = core.linkState || (hasExternalAddress ? 'connected' : 'disconnected')
            const candidate = {
                ...core,
                ...(patch && typeof patch === 'object' ? patch : {}),
                interfaces,
                linkState,
                coreStatus: 'ready',
            }
            this.candidateCore = candidate
            this.candidateGeneration = this.generation

            // A genuine loss of every useful external IPv4/IPv6 link is authoritative and
            // is the one transition that clears presentation data immediately.
            if (linkState === 'disconnected') {
                this.clearTransitionRetry()
                const disconnectedVpn = { active: false, source: 'no-link', tunnel: null }
                const next = this.commit({
                    ...candidate,
                    networkContext: null,
                    networkContexts: [],
                    underlay: null,
                    underlayGateway: null,
                    overlay: { type: 'vpn', active: false, tunnel: null, authoritative: true, status: disconnectedVpn },
                    wifi: null,
                    vpnStatus: disconnectedVpn,
                    dns: [],
                    coherent: true,
                    transitioning: false,
                    presentationStale: false,
                    transitionStatus: 'idle',
                    identityKey: 'disconnected',
                    underlayIdentityKey: 'disconnected',
                    pendingNetworkEpoch: null,
                    generation: this.generation,
                    networkEpoch: this.generation,
                    phase: 'ready',
                    enrichmentStatus: 'ready',
                    errors: [],
                }, reason)
                if (this.activeTransition?.generation === this.generation) this.activeTransition.completed = true
                return next
            }

            if (!this.snapshot.coherent) {
                return this.commit({
                    ...candidate,
                    coherent: false,
                    transitioning: true,
                    presentationStale: false,
                    transitionStatus: 'initializing',
                    pendingNetworkEpoch: this.generation,
                    generation: this.generation,
                    networkEpoch: this.generation,
                    phase: 'core-ready',
                    enrichmentStatus: 'loading',
                    errors: [],
                }, reason)
            }

            // Once a coherent view exists, do not replace any presentation
            // field with a fast/partial candidate. Only transition metadata is
            // published until enrichment can commit the whole epoch atomically.
            if (this.generation !== this.snapshot.networkEpoch) {
                return this.commit({
                    transitioning: true,
                    presentationStale: true,
                    transitionStatus: 'updating',
                    pendingNetworkEpoch: this.generation,
                }, reason)
            }
            return this.snapshot
        } catch (error) {
            return this.commit({
                phase: 'degraded',
                coreStatus: 'error',
                linkState: this.snapshot.coherent ? this.snapshot.linkState : 'unknown',
                errors: [{ source: 'core', code: 'read-failed', message: error?.message || String(error) }],
            }, reason)
        }
    }

    refresh(reason = 'manual') {
        if (this.stopped) return Promise.resolve(this.snapshot)
        if (this.candidateGeneration === this.generation && this.candidateCore?.linkState === 'disconnected') {
            return Promise.resolve(this.snapshot)
        }
        if (this.refreshPromise) {
            this.metrics.deduplicatedRefreshes += 1
            if (reason !== 'periodic') this.queuedRefreshReason = reason
            return this.refreshPromise
        }

        const generation = this.generation
        const lifecycleEpoch = this.lifecycleEpoch
        const candidate = this.candidateGeneration === generation ? this.candidateCore : null
        const startedAt = this.now()
        this.metrics.enrichmentRuns += 1
        this.metrics.activeEnrichments += 1
        this.metrics.maxConcurrentEnrichments = Math.max(this.metrics.maxConcurrentEnrichments, this.metrics.activeEnrichments)

        const pending = Promise.resolve()
            .then(() => this.readEnrichment({ generation, reason, core: candidate }))
            .then(result => {
                if (this.stopped || lifecycleEpoch !== this.lifecycleEpoch || generation !== this.generation) {
                    this.metrics.staleResults += 1
                    this.log('enrichment-stale', { generation, currentGeneration: this.generation, reason })
                    return this.snapshot
                }
                const patch = result && typeof result === 'object' ? result : {}
                const errors = Array.isArray(patch.errors) ? patch.errors : []
                if (
                    patch.authoritative === false
                    && this.snapshot.coherent
                    && generation !== this.snapshot.networkEpoch
                ) {
                    this.metrics.nonAuthoritativeResults += 1
                    const retryScheduled = this.scheduleTransitionRetry(generation)
                    return this.commit({
                        transitioning: true,
                        presentationStale: true,
                        transitionStatus: retryScheduled ? 'retrying' : 'degraded',
                        pendingNetworkEpoch: generation,
                        errors,
                    }, reason)
                }

                let commitGeneration = generation
                let commitReason = reason
                const identityChangedWithoutSignal = Boolean(
                    this.snapshot.coherent
                    && patch.authoritative !== false
                    && generation === this.snapshot.networkEpoch
                    && patch.identityKey
                    && this.snapshot.identityKey
                    && patch.identityKey !== this.snapshot.identityKey
                )
                if (identityChangedWithoutSignal) {
                    this.generation += 1
                    commitGeneration = this.generation
                    commitReason = 'network-identity-change'
                    this.metrics.detectedIdentityChanges += 1
                    this.onFingerprintChange()
                    this.log('network-identity-change', {
                        previousIdentity: this.snapshot.identityKey,
                        nextIdentity: patch.identityKey,
                        generation: commitGeneration,
                    })
                }

                const enrichmentStatus = errors.length ? 'partial' : 'ready'
                this.clearTransitionRetry()
                const next = this.commit({
                    ...(candidate || {}),
                    ...patch,
                    coherent: true,
                    transitioning: false,
                    presentationStale: false,
                    transitionStatus: 'idle',
                    pendingNetworkEpoch: null,
                    generation: commitGeneration,
                    networkEpoch: commitGeneration,
                    phase: enrichmentStatus === 'ready' ? 'ready' : 'degraded',
                    coreStatus: 'ready',
                    enrichmentStatus,
                    errors,
                }, commitReason)
                if (this.activeTransition?.generation === generation) this.activeTransition = null
                return next
            })
            .catch(error => {
                if (this.stopped || lifecycleEpoch !== this.lifecycleEpoch || generation !== this.generation) return this.snapshot
                this.metrics.enrichmentErrors += 1
                if (this.snapshot.coherent) {
                    if (generation !== this.snapshot.networkEpoch) {
                        this.metrics.nonAuthoritativeResults += 1
                        const retryScheduled = this.scheduleTransitionRetry(generation)
                        return this.commit({
                            transitioning: true,
                            presentationStale: true,
                            transitionStatus: retryScheduled ? 'retrying' : 'degraded',
                            pendingNetworkEpoch: generation,
                            errors: [{ source: 'enrichment', code: 'read-failed', message: error?.message || String(error) }],
                        }, reason)
                    }
                    if (this.activeTransition?.generation === generation) this.activeTransition = null
                    return this.commit({
                        transitioning: false,
                        presentationStale: true,
                        transitionStatus: 'degraded',
                        pendingNetworkEpoch: generation,
                        errors: [{ source: 'enrichment', code: 'read-failed', message: error?.message || String(error) }],
                    }, reason)
                }
                return this.commit({
                    ...(candidate || {}),
                    coherent: true,
                    transitioning: false,
                    presentationStale: false,
                    transitionStatus: 'degraded',
                    pendingNetworkEpoch: null,
                    generation,
                    networkEpoch: generation,
                    phase: 'degraded',
                    enrichmentStatus: 'error',
                    errors: [{ source: 'enrichment', code: 'read-failed', message: error?.message || String(error) }],
                }, reason)
            })
            .finally(() => {
                const durationMs = Math.max(0, this.now() - startedAt)
                this.metrics.lastDurationMs = durationMs
                this.metrics.activeEnrichments = Math.max(0, this.metrics.activeEnrichments - 1)
                this.log('enrichment-complete', {
                    durationMs,
                    generation,
                    reason,
                    status: this.snapshot.enrichmentStatus,
                })
                if (this.refreshPromise === pending) this.refreshPromise = null
                const queuedReason = this.queuedRefreshReason
                this.queuedRefreshReason = null
                if (queuedReason && !this.stopped) this.refresh(queuedReason)
            })

        this.refreshPromise = pending
        return pending
    }

    commit(patch, reason, shouldEmit = true) {
        const next = Object.freeze({
            ...this.snapshot,
            ...patch,
            revision: this.snapshot.revision + 1,
            updatedAt: this.now(),
            reason,
        })
        this.snapshot = next
        if (shouldEmit) this.emit(next)
        return next
    }
}

module.exports = { NetworkRuntime, shouldCollectWifiTelemetry }
