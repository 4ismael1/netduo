/**
 * Pure helpers for interpreting OS neighbor-table rows.
 *
 * Windows keeps disconnected devices in Get-NetNeighbor as `Stale` for a
 * while. A stale MAC is useful inventory evidence, but it is not active
 * proof that the device is online right now. It is still worth one active
 * retry because Wi-Fi clients often remain Stale while connected.
 */

const BAD_NEIGHBOR_STATES = new Set(['failed', 'incomplete', 'invalid', 'unreachable'])
const ACTIVE_RETRY_STATES = new Set(['reachable', 'delay', 'probe', 'permanent', 'stale'])
const STATE_RANK = {
    reachable: 7,
    permanent: 6,
    delay: 5,
    probe: 5,
    stale: 3,
    unknown: 1,
}

const NETSH_STATE_MAP = new Map([
    ['reachable', 'reachable'],
    ['alcanzable', 'reachable'],
    ['permanent', 'permanent'],
    ['permanente', 'permanent'],
    ['delay', 'delay'],
    ['retraso', 'delay'],
    ['probe', 'probe'],
    ['sondeo', 'probe'],
    ['stale', 'stale'],
    ['obsolete', 'stale'],
    ['obsoleto', 'stale'],
    ['unreachable', 'unreachable'],
    ['inalcanzable', 'unreachable'],
    ['incomplete', 'incomplete'],
    ['incompleto', 'incomplete'],
    ['invalid', 'invalid'],
    ['no valido', 'invalid'],
])

function normalizeNeighborState(value) {
    const state = String(value || '').trim().toLowerCase()
    return state || 'unknown'
}

function normalizeNetshNeighborState(value) {
    const key = String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
    return NETSH_STATE_MAP.get(key) || normalizeNeighborState(key)
}

function isUsableNeighborState(value) {
    return !BAD_NEIGHBOR_STATES.has(normalizeNeighborState(value))
}

function shouldRetryNeighbor(value) {
    const state = normalizeNeighborState(value?.state)
    if (ACTIVE_RETRY_STATES.has(state)) return true

    // `arp -a` does not expose state. It is still a useful, small candidate
    // set after TCP preheat, unlike retrying every silent address in the /24.
    return state === 'unknown' && value?.source === 'arp'
}

function mergeNeighborEntry(current, next) {
    if (!current) return { ...next }

    const currentRank = STATE_RANK[normalizeNeighborState(current.state)] || 0
    const nextRank = STATE_RANK[normalizeNeighborState(next.state)] || 0
    if (nextRank > currentRank) return { ...current, ...next }

    // Prefer Get-NetNeighbor over arp.exe when both report the same state
    // quality, because it includes the explicit reachability state.
    if (nextRank === currentRank && next.source === 'netneighbor' && current.source !== 'netneighbor') {
        return { ...current, ...next }
    }

    return current
}

module.exports = {
    normalizeNeighborState,
    normalizeNetshNeighborState,
    isUsableNeighborState,
    shouldRetryNeighbor,
    mergeNeighborEntry,
}
