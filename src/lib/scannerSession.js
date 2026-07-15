import { useSyncExternalStore } from 'react'

const listeners = new Set()

const emptySnapshot = () => ({
    scanning: false,
    devices: [],
    runDevices: [],
    progress: 0,
    newDeviceKeys: new Set(),
    scanMeta: null,
    completedMeta: null,
    completedAt: null,
})

let snapshot = emptySnapshot()

export const scannerRunRef = { current: 0 }

function emit(next) {
    snapshot = { ...snapshot, ...next }
    listeners.forEach(listener => listener())
}

function setField(key, value) {
    const nextValue = typeof value === 'function' ? value(snapshot[key]) : value
    if (Object.is(snapshot[key], nextValue)) return
    emit({ [key]: nextValue })
}

export function getScannerSessionSnapshot() {
    return snapshot
}

export function subscribeScannerSession(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function useScannerSession() {
    return useSyncExternalStore(subscribeScannerSession, getScannerSessionSnapshot, getScannerSessionSnapshot)
}

export const setScannerDevices = value => setField('devices', value)
export const setScannerRunDevices = value => setField('runDevices', value)
export const setScannerProgress = value => setField('progress', value)
export const setScannerNewDeviceKeys = value => setField('newDeviceKeys', value)

export function beginScannerSession(meta) {
    const scanId = scannerRunRef.current + 1
    scannerRunRef.current = scanId
    emit({
        scanning: true,
        runDevices: [],
        progress: 0,
        newDeviceKeys: new Set(),
        scanMeta: meta || null,
        completedAt: null,
    })
    return scanId
}

export function finishScannerSession(scanId) {
    if (scannerRunRef.current !== scanId) return false
    emit({
        scanning: false,
        devices: snapshot.runDevices,
        runDevices: [],
        progress: 100,
        scanMeta: null,
        completedMeta: snapshot.scanMeta,
        completedAt: Date.now(),
    })
    return true
}

export function failScannerSession(scanId) {
    if (scannerRunRef.current !== scanId) return false
    // Invalidate every callback belonging to the failed sweep while keeping
    // the last completed device list visible. A retry receives a fresh id.
    scannerRunRef.current += 1
    emit({
        scanning: false,
        runDevices: [],
        progress: 0,
        scanMeta: null,
    })
    return true
}

export function abortScannerSession({ clearDevices = false } = {}) {
    const cancelledScanId = scannerRunRef.current
    scannerRunRef.current += 1
    emit({
        scanning: false,
        runDevices: [],
        progress: 0,
        scanMeta: null,
        ...(clearDevices ? { devices: [], newDeviceKeys: new Set(), completedMeta: null, completedAt: null } : {}),
    })
    return cancelledScanId
}

export function resetScannerSessionForTests() {
    scannerRunRef.current = 0
    snapshot = emptySnapshot()
    listeners.forEach(listener => listener())
}
