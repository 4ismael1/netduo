const PHASE_ORDER = [
    'idle',
    'init',
    'latency',
    'calibrating',
    'calibrated',
    'download-start',
    'downloading',
    'download-done',
    'upload-start',
    'uploading',
    'upload-done',
    'done',
    'error',
]

function toFiniteNumber(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
}

function round2(value) {
    return Math.round(value * 100) / 100
}

export function phaseIndex(phase) {
    return PHASE_ORDER.indexOf(phase)
}

export function isStalePhaseEvent(currentPhase, incomingPhase) {
    const cur = phaseIndex(currentPhase)
    const next = phaseIndex(incomingPhase)
    if (cur < 0 || next < 0) return false
    return next < cur
}

export function deriveProgressMbps(progressEvent) {
    if (!progressEvent) return 0

    const overall = toFiniteNumber(progressEvent.overallSpeed)
    if (overall != null && overall >= 0) return round2(overall)

    const avg = toFiniteNumber(progressEvent.avgSpeed)
    if (avg != null && avg >= 0) return round2(avg)

    const instant = toFiniteNumber(progressEvent.instantSpeed)
    if (instant != null && instant >= 0) return round2(instant)

    const elapsed = toFiniteNumber(progressEvent.elapsed)
    const bytesRx = toFiniteNumber(progressEvent.bytesReceived)
    const bytesTx = toFiniteNumber(progressEvent.bytesSent)
    const bytes = bytesRx != null ? bytesRx : bytesTx
    if (bytes != null && elapsed != null && elapsed > 0) {
        return round2((bytes * 8) / (elapsed * 1e6))
    }

    return 0
}
