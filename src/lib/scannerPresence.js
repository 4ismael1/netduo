function ipParts(value) {
    const parts = String(value || '').split('.')
    if (parts.length !== 4) return null
    const numbers = parts.map(Number)
    if (numbers.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null
    return { baseIP: parts.slice(0, 3).join('.'), host: numbers[3] }
}

export function ipIsInsideScanSegments(ip, segments) {
    const parsed = ipParts(ip)
    if (!parsed || !Array.isArray(segments)) return false
    return segments.some(segment => (
        segment?.baseIP === parsed.baseIP
        && parsed.host >= Number(segment.start)
        && parsed.host <= Number(segment.end)
    ))
}

function inventoryAsDevice(item) {
    return {
        deviceKey: item?.deviceKey || null,
        ip: item?.ip || null,
        mac: item?.mac || null,
        hostname: item?.hostname || null,
        vendor: item?.vendor || null,
        deviceType: item?.type || 'Unknown',
        lastSeen: item?.lastSeen || null,
    }
}

/** Keep known devices neutral until the current scan verifies them. */
export function buildScanPresenceInput(completedDevices, runDevices, inventory, segments) {
    const current = Array.isArray(runDevices) ? runDevices : []
    const currentIps = new Set(current.map(device => device?.ip).filter(Boolean))
    const candidates = new Map()

    for (const item of inventory || []) {
        if (item?.ip) candidates.set(item.ip, inventoryAsDevice(item))
    }
    for (const device of completedDevices || []) {
        if (device?.ip) candidates.set(device.ip, device)
    }

    const pending = []
    for (const [ip, device] of candidates) {
        if (currentIps.has(ip)) continue
        const checking = ipIsInsideScanSegments(ip, segments)
        pending.push({
            ...device,
            alive: false,
            seenOnly: false,
            time: null,
            presenceHint: checking ? 'checking' : 'not-checked',
        })
    }

    return [...current, ...pending]
}

/** After a partial scan, only devices inside its range may become offline. */
export function buildCompletedPresenceInput(completedDevices, inventory, segments) {
    const completed = Array.isArray(completedDevices) ? completedDevices : []
    if (!Array.isArray(segments) || !segments.length) return completed
    const completedIps = new Set(completed.map(device => device?.ip).filter(Boolean))
    const outside = []

    for (const item of inventory || []) {
        if (!item?.ip || completedIps.has(item.ip) || ipIsInsideScanSegments(item.ip, segments)) continue
        outside.push({
            ...inventoryAsDevice(item),
            alive: false,
            seenOnly: false,
            time: null,
            presenceHint: 'not-checked',
        })
    }
    return [...completed, ...outside]
}
