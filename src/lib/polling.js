export const DEFAULT_POLL_INTERVAL_SECONDS = 3

export const POLL_INTERVAL_OPTIONS_SECONDS = Object.freeze([1, 2, 3, 5, 10, 30])

export function normalizePollIntervalMs(rawValue) {
    const seconds = Number.parseInt(String(rawValue ?? ''), 10)
    if (!Number.isInteger(seconds)) return DEFAULT_POLL_INTERVAL_SECONDS * 1000
    return Math.max(1, Math.min(seconds, 60)) * 1000
}
