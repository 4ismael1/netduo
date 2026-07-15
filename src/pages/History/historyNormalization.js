function speedResultKey(item) {
    if (!item) return null
    const timestamp = item.results?.timestamp || item.timestamp
    const download = item.download ?? item.results?.download
    const upload = item.upload ?? item.results?.upload
    const latency = item.latency ?? item.results?.latency
    if (!timestamp || download == null || upload == null) return null
    return `${timestamp}|${download}|${upload}|${latency ?? ''}`
}

export function normalizeSpecializedHistory({ general, speed, lan, wan }) {
    const canonicalSpeedKeys = new Set((speed || []).map(speedResultKey).filter(Boolean))
    const rows = []
    for (const item of general || []) {
        if (item?.module === 'Speed Test' && canonicalSpeedKeys.has(speedResultKey(item))) continue
        rows.push({ ...item, id: `general-${item.id}` })
    }
    for (const item of speed || []) {
        rows.push({
            id: `speed-${item.id}`,
            timestamp: item.timestamp,
            module: 'Speed Test',
            type: 'Saved Result',
            detail: `↓${item.download ?? '-'} ↑${item.upload ?? '-'} Mbps · ${item.latency ?? '-'} ms`,
        })
    }
    for (const item of lan || []) {
        rows.push({
            id: `lan-${item.id}`,
            timestamp: item.timestamp,
            module: 'LAN Check',
            type: String(item.profile || 'standard').toUpperCase(),
            detail: `${item.scope || '-'} · risk ${item.risk_score ?? item.report?.summary?.riskScore ?? 0}`,
        })
    }
    for (const item of wan || []) {
        rows.push({
            id: `wan-${item.id}`,
            timestamp: item.timestamp,
            module: 'WAN Check',
            type: String(item.mode || item.report?.mode || 'scan').toUpperCase(),
            detail: `${item.target || item.report?.target || '-'} · risk ${item.risk_score ?? item.report?.summary?.riskScore ?? 0}`,
        })
    }
    return rows.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
}
