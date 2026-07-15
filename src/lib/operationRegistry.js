import { useSyncExternalStore } from 'react'

const listeners = new Set()
const owners = new Map()
let snapshot = Object.freeze({})

function emit(next) {
    snapshot = Object.freeze(next)
    listeners.forEach(listener => listener())
}

export function beginOperation(id, details) {
    const token = Symbol(id)
    owners.set(id, token)
    emit({
        ...snapshot,
        [id]: {
            id,
            status: 'running',
            startedAt: Date.now(),
            ...details,
        },
    })
    return token
}

export function updateOperation(id, token, details) {
    if (!snapshot[id] || owners.get(id) !== token) return false
    emit({ ...snapshot, [id]: { ...snapshot[id], ...details } })
    return true
}

export function endOperation(id, token, status = 'done', details = {}) {
    if (!snapshot[id] || owners.get(id) !== token) return false
    owners.delete(id)
    // A user-cancelled task has no remaining background work to report.
    // Remove it immediately so leaving the module cannot surface a stale
    // cancellation badge in the sidebar.
    if (status === 'cancelled') {
        const next = { ...snapshot }
        delete next[id]
        emit(next)
        return true
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
    return true
}

// Network changes and other application-wide guards intentionally revoke the
// current owner. Normal async callbacks must use endOperation with their exact
// token; only administrative coordination code should call this function.
export function invalidateOperation(id, status = 'error', details = {}) {
    const token = owners.get(id)
    if (!token) return false
    return endOperation(id, token, status, details)
}

export function removeOperation(id, token) {
    if (!snapshot[id] || owners.get(id) !== token) return false
    owners.delete(id)
    const next = { ...snapshot }
    delete next[id]
    emit(next)
    return true
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
    owners.clear()
    snapshot = Object.freeze({})
    listeners.forEach(listener => listener())
}
