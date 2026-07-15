import { DEFAULT_POLL_INTERVAL_SECONDS } from '../../lib/polling.js'
import { measureProbeRound } from '../../lib/probeRound.js'

const MAX_CACHED_NETWORK_KEYS = 4
const pingCacheByEpoch = new Map()
const signalHistoryByUnderlay = new Map()
const probeRoundInFlightByKey = new Map()

let dashboardConfigCache = {
    pollMs: DEFAULT_POLL_INTERVAL_SECONDS * 1000,
    latencyThr: 150,
}
let dashboardLayoutCache = { showExtraDeviceInfo: false }

function boundedSet(map, key, value) {
    map.delete(key)
    map.set(key, value)
    while (map.size > MAX_CACHED_NETWORK_KEYS) map.delete(map.keys().next().value)
}

function emptyPingState(hosts) {
    return {
        pingData: Object.fromEntries(hosts.map(host => [host, []])),
        pingLatest: {},
        gwPing: null,
        gwPingState: 'idle',
        health: 'loading',
        lastSampledAt: 0,
        visited: false,
    }
}

export function readDashboardPingState(epoch, hosts) {
    return pingCacheByEpoch.get(epoch) || emptyPingState(hosts)
}

export function writeDashboardPingState(epoch, state) {
    boundedSet(pingCacheByEpoch, epoch, state)
}

export function readDashboardSignalHistory(identity) {
    return signalHistoryByUnderlay.get(identity) || []
}

export function writeDashboardSignalHistory(identity, history) {
    boundedSet(signalHistoryByUnderlay, identity, history)
}

export function readDashboardConfigCache() {
    return dashboardConfigCache
}

export function writeDashboardConfigCache(patch) {
    dashboardConfigCache = { ...dashboardConfigCache, ...patch }
}

export function readDashboardLayoutCache() {
    return dashboardLayoutCache
}

export function writeDashboardLayoutCache(patch) {
    dashboardLayoutCache = { ...dashboardLayoutCache, ...patch }
}

export function runSharedDashboardProbe({ epoch, externalTargets, gateway, includeGateway, ping }) {
    const key = `${epoch}|${includeGateway ? gateway || '-' : 'no-gateway'}`
    const current = probeRoundInFlightByKey.get(key)
    if (current) return current

    const pending = measureProbeRound({
        externalTargets,
        gateway,
        includeGateway,
        ping,
    }).finally(() => {
        if (probeRoundInFlightByKey.get(key) === pending) {
            probeRoundInFlightByKey.delete(key)
        }
    })
    probeRoundInFlightByKey.set(key, pending)
    return pending
}

export function resetDashboardSessionForTests() {
    pingCacheByEpoch.clear()
    signalHistoryByUnderlay.clear()
    probeRoundInFlightByKey.clear()
    dashboardConfigCache = {
        pollMs: DEFAULT_POLL_INTERVAL_SECONDS * 1000,
        latencyThr: 150,
    }
    dashboardLayoutCache = { showExtraDeviceInfo: false }
}
