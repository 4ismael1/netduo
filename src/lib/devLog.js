export function logBridgeWarning(scope, error) {
    if (!import.meta.env?.DEV) return
    console.warn(`[NetDuo] ${scope}`, error)
}
