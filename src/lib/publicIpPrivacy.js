export const PUBLIC_IP_VISIBLE_STORAGE_KEY = 'netduo.publicIpVisible'

export function readPublicIpVisible(storage = globalThis.localStorage) {
    try {
        const saved = storage?.getItem(PUBLIC_IP_VISIBLE_STORAGE_KEY)
        return saved == null ? false : saved === 'true'
    } catch {
        return false
    }
}

export function persistPublicIpVisible(visible, storage = globalThis.localStorage) {
    const normalized = visible === true
    try {
        storage?.setItem(PUBLIC_IP_VISIBLE_STORAGE_KEY, String(normalized))
    } catch { /* best effort */ }
    return normalized
}
