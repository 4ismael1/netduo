function ipv4ToInt(value) {
    const parts = String(value || '').split('.').map(Number)
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null
    return parts.reduce((acc, part) => ((acc << 8) | part) >>> 0, 0) >>> 0
}

function intToIpv4(value) {
    const n = Number(value) >>> 0
    return [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join('.')
}

export function buildContextScanSegments(context, maxHosts = 4096) {
    const first = ipv4ToInt(context?.firstHost)
    const last = ipv4ToInt(context?.lastHost)
    if (first == null || last == null || last < first) return { ok: false, error: 'Active network does not expose a usable IPv4 range' }
    const hostCount = last - first + 1
    if (hostCount > maxHosts) {
        return { ok: false, error: `Detected scope contains ${hostCount} hosts. Use a manual range or a CIDR no larger than ${maxHosts} hosts.` }
    }

    const segments = []
    let cursor = first
    while (cursor <= last) {
        const ip = intToIpv4(cursor)
        const parts = ip.split('.')
        const baseIP = parts.slice(0, 3).join('.')
        const start = Number(parts[3])
        const endOfBlock = ((cursor & 0xffffff00) >>> 0) + 255
        const segmentLast = Math.min(last, endOfBlock)
        segments.push({ baseIP, start, end: Number(intToIpv4(segmentLast).split('.')[3]) })
        cursor = segmentLast + 1
    }

    return {
        ok: true,
        cidr: context?.cidr || null,
        scopeKey: context?.cidr || `${segments[0].baseIP}.${segments[0].start}-${segments.at(-1).baseIP}.${segments.at(-1).end}`,
        gatewayIp: context?.gateway || null,
        hostCount,
        segments,
    }
}
