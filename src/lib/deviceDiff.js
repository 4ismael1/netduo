/**
 * Device snapshot diff utility.
 *
 * Compares two LAN-scan snapshots and returns the set of changes
 * between them. Devices are matched primarily by MAC address (most
 * stable identifier across DHCP lease changes). When a MAC is missing
 * on either side we fall back to matching by IP.
 *
 * A "modified" result is returned when the match keeps the same stable
 * key (MAC) but surrounding metadata changed — e.g. the IP moved, the
 * hostname was re-resolved, or a different vendor was detected. These
 * are useful signals for network admins: an IP change on a fixed MAC
 * can indicate DHCP hiccups, while a MAC change on a fixed IP is a
 * potential spoofing warning.
 *
 * Returns:
 *   {
 *     added:    [device, ...],          // appeared since previous snapshot
 *     removed:  [device, ...],          // disappeared since previous snapshot
 *     modified: [{ before, after, changes: ['ip','hostname',...] }, ...]
 *   }
 */

const TRACKED_FIELDS = ['ip', 'hostname', 'vendor', 'deviceType', 'mac']

function normalizeMac(mac) {
    if (!mac || typeof mac !== 'string') return null
    const cleaned = mac.toLowerCase().replace(/[^0-9a-f]/g, '')
    // 12 hex chars plus reject all-zero / broadcast addresses.
    if (cleaned.length !== 12) return null
    if (cleaned === '000000000000') return null
    if (cleaned === 'ffffffffffff') return null
    return cleaned
}

function stableKey(device) {
    if (!device) return null
    const m = normalizeMac(device.mac)
    return m ? `mac:${m}` : (device.ip ? `ip:${device.ip}` : null)
}

function indexByKey(devices) {
    const map = new Map()
    for (const d of devices || []) {
        const k = stableKey(d)
        if (!k) continue
        // Keep first occurrence — duplicate entries are unexpected but harmless.
        if (!map.has(k)) map.set(k, d)
    }
    return map
}

function listChangedFields(a, b) {
    const changes = []
    for (const field of TRACKED_FIELDS) {
        const va = a?.[field]
        const vb = b?.[field]
        const na = va == null ? '' : String(va)
        const nb = vb == null ? '' : String(vb)
        if (na !== nb) changes.push(field)
    }
    return changes
}

/**
 * Compare two snapshots of devices.
 *
 * @param {Array<object>|null} previous
 * @param {Array<object>}       current
 * @returns {{ added: object[], removed: object[], modified: { before, after, changes }[] }}
 */
export function diffSnapshots(previous, current) {
    const result = { added: [], removed: [], modified: [] }

    if (!Array.isArray(current)) return result
    if (!Array.isArray(previous) || previous.length === 0) {
        // First-ever snapshot of the subnet: nothing to compare against.
        return result
    }

    const prevMap = indexByKey(previous)
    const currMap = indexByKey(current)

    // Added: present in current, absent in previous.
    for (const [key, device] of currMap.entries()) {
        if (!prevMap.has(key)) result.added.push(device)
    }

    // Removed: present in previous, absent in current.
    for (const [key, device] of prevMap.entries()) {
        if (!currMap.has(key)) result.removed.push(device)
    }

    // Modified: shared key, any tracked field differs.
    for (const [key, after] of currMap.entries()) {
        const before = prevMap.get(key)
        if (!before) continue
        const changes = listChangedFields(before, after)
        if (changes.length > 0) {
            result.modified.push({ before, after, changes })
        }
    }

    return result
}

/**
 * Convenience: summarize a diff into simple counts.
 */
export function summarizeDiff(diff) {
    return {
        added: diff?.added?.length || 0,
        removed: diff?.removed?.length || 0,
        modified: diff?.modified?.length || 0,
        total: (diff?.added?.length || 0) + (diff?.removed?.length || 0) + (diff?.modified?.length || 0),
    }
}

export { TRACKED_FIELDS, normalizeMac, stableKey }
