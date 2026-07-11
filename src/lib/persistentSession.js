import { useCallback, useSyncExternalStore } from 'react'

const sessions = new Map()
const listeners = new Map()
const refs = new Map()

function ensureSession(namespace) {
    if (!sessions.has(namespace)) sessions.set(namespace, Object.freeze({}))
    return sessions.get(namespace)
}

function ensureValue(namespace, key, initialValue) {
    const current = ensureSession(namespace)
    if (Object.prototype.hasOwnProperty.call(current, key)) return current[key]
    const value = typeof initialValue === 'function' ? initialValue() : initialValue
    sessions.set(namespace, Object.freeze({ ...current, [key]: value }))
    return value
}

function subscribe(namespace, listener) {
    if (!listeners.has(namespace)) listeners.set(namespace, new Set())
    listeners.get(namespace).add(listener)
    return () => {
        const group = listeners.get(namespace)
        group?.delete(listener)
        if (group?.size === 0) listeners.delete(namespace)
    }
}

function emit(namespace) {
    listeners.get(namespace)?.forEach(listener => listener())
}

export function getSessionSnapshot(namespace) {
    return ensureSession(namespace)
}

export function setSessionValue(namespace, key, nextValue) {
    const current = ensureSession(namespace)
    const previous = current[key]
    const value = typeof nextValue === 'function' ? nextValue(previous) : nextValue
    if (Object.is(previous, value)) return value
    sessions.set(namespace, Object.freeze({ ...current, [key]: value }))
    emit(namespace)
    return value
}

export function useSessionState(namespace, key, initialValue) {
    ensureValue(namespace, key, initialValue)
    const snapshot = useSyncExternalStore(
        listener => subscribe(namespace, listener),
        () => getSessionSnapshot(namespace),
        () => getSessionSnapshot(namespace),
    )
    const setter = useCallback(value => setSessionValue(namespace, key, value), [namespace, key])
    return [snapshot[key], setter]
}

export function getSessionRef(namespace, key, initialValue) {
    const refKey = `${namespace}:${key}`
    if (!refs.has(refKey)) {
        refs.set(refKey, { current: typeof initialValue === 'function' ? initialValue() : initialValue })
    }
    return refs.get(refKey)
}

export function resetPersistentSessionsForTests() {
    sessions.clear()
    refs.clear()
    listeners.forEach(group => group.forEach(listener => listener()))
    listeners.clear()
}
