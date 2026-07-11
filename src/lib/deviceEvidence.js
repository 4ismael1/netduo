export function assessDeviceEvidence(device = {}) {
    if (device.presence === 'offline') return { state: 'offline', label: 'Historical only', confidence: 0 }
    if (device.alive && device.time != null && device.mac) return { state: 'confirmed', label: 'Confirmed online', confidence: 100 }
    if (device.alive && ['mdns', 'ssdp'].includes(device.activeSource)) return { state: 'confirmed', label: 'Confirmed responder', confidence: device.mac ? 95 : 85 }
    if (device.alive) return { state: 'confirmed', label: 'Active response', confidence: device.mac ? 95 : 75 }
    const neighborState = String(device.neighborState || '').toLowerCase()
    if (['reachable', 'delay', 'probe', 'permanent'].includes(neighborState)) {
        return { state: 'probable', label: 'Probably online', confidence: 75 }
    }
    if (neighborState === 'stale' || device.presence === 'cached' || device.seenOnly) {
        return { state: 'recent', label: 'Recently observed', confidence: 45 }
    }
    return { state: 'unknown', label: 'Unconfirmed', confidence: 20 }
}
