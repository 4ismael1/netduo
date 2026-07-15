function usefulAddress(row) {
    if (!row || row.internal) return null
    const family = String(row.family || '')
    const address = String(row.address || '').trim().toLowerCase().split('%')[0]
    if (family === 'IPv4' || family === '4') {
        if (!address || address.startsWith('169.254.')) return null
        return { family: '4', address }
    }
    if (family === 'IPv6' || family === '6') {
        if (!address || address === '::' || address === '::1' || address.startsWith('fe80:')) return null
        return { family: '6', address }
    }
    return null
}

function fingerprintNetworkInterfaces(interfaces = {}, dnsServers = null) {
    const rows = []
    for (const [name, addresses] of Object.entries(interfaces || {})) {
        for (const row of addresses || []) {
            const useful = usefulAddress(row)
            if (!useful) continue
            rows.push([
                useful.family,
                String(name || '').trim().toLowerCase(),
                useful.address,
                String(row.netmask || row.cidr || '').trim().toLowerCase(),
                String(row.mac || '').trim().toLowerCase(),
            ].join('|'))
        }
    }
    const interfaceFingerprint = rows.sort().join(';')
    if (!Array.isArray(dnsServers)) return interfaceFingerprint
    const dnsFingerprint = [...new Set(dnsServers
        .map(server => String(server || '').trim().toLowerCase().split('%')[0])
        .filter(Boolean))]
        .sort()
        .join(',')
    return `${interfaceFingerprint}#dns:${dnsFingerprint}`
}

module.exports = { fingerprintNetworkInterfaces, usefulAddress }
