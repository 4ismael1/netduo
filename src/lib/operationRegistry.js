import { useSyncExternalStore } from 'react'

const listeners = new Set()
let snapshot = Object.freeze({})

function emit(next) {
    snapshot = Object.freeze(next)
    listeners.forEach(listener => listener())
}

export function beginOperation(id, details) {
    emit({
        ...snapshot,
        [id]: {
            id,
            status: 'running',
            startedAt: Date.now(),
            ...details,
        },
    })
}

export function updateOperation(id, details) {
    if (!snapshot[id]) return
    emit({ ...snapshot, [id]: { ...snapshot[id], ...details } })
}

export function endOperation(id, status = 'done', details = {}) {
    if (!snapshot[id]) return
    // A user-cancelled task has no remaining background work to report.
    // Remove it immediately so leaving the module cannot surface a stale
    // cancellation badge in the sidebar.
    if (status === 'cancelled') {
        const next = { ...snapshot }
        delete next[id]
        emit(next)
        return
    }
    const finished = { ...snapshot[id], ...details, status, finishedAt: Date.now() }
    emit({ ...snapshot, [id]: finished })
    const timeout = setTimeout(() => {
        if (snapshot[id] !== finished) return
        const next = { ...snapshot }
        delete next[id]
        emit(next)
    }, status === 'done' ? 3500 : 6000)
    timeout?.unref?.()
}

export function removeOperation(id) {
    if (!snapshot[id]) return
    const next = { ...snapshot }
    delete next[id]
    emit(next)
}

export function getOperationSnapshot() {
    return snapshot
}

export function subscribeOperations(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function useOperations() {
    return useSyncExternalStore(subscribeOperations, getOperationSnapshot, getOperationSnapshot)
}

export function resetOperationsForTests() {
    snapshot = Object.freeze({})
    listeners.forEach(listener => listener())
}
