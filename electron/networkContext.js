const os = require('os')

function buildWindowsNetworkContextScript() {
    return [
        '$ErrorActionPreference = "Stop"',
        '$routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" | Sort-Object @{Expression={$_.RouteMetric + $_.InterfaceMetric}}',
        '$rows = foreach ($route in $routes) {',
        '  $ip = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1',
        '  if ($ip) {',
        '    $adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -IncludeHidden -ErrorAction SilentlyContinue',
        '    [PSCustomObject]@{',
        '      IPAddress=$ip.IPAddress; PrefixLength=$ip.PrefixLength; NextHop=$route.NextHop;',
        '      InterfaceAlias=$route.InterfaceAlias; InterfaceIndex=$route.InterfaceIndex;',
        '      InterfaceDescription=$adapter.InterfaceDescription; Status=$adapter.Status; MacAddress=$adapter.MacAddress;',
        '      RouteMetric=$route.RouteMetric; InterfaceMetric=$route.InterfaceMetric',
        '    }',
        '  }',
        '}',
        '$rows | ConvertTo-Json -Compress',
    ].join('\n')
}

function ipv4ToInt(value) {
    const parts = String(value || '').trim().split('.').map(Number)
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null
    return parts.reduce((acc, part) => ((acc << 8) | part) >>> 0, 0) >>> 0
}

function intToIpv4(value) {
    const n = Number(value) >>> 0
    return [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join('.')
}

function prefixFromNetmask(netmask) {
    const value = ipv4ToInt(netmask)
    if (value == null) return null
    let prefix = 0
    let zeroSeen = false
    for (let bit = 31; bit >= 0; bit -= 1) {
        const set = ((value >>> bit) & 1) === 1
        if (set && zeroSeen) return null
        if (set) prefix += 1
        else zeroSeen = true
    }
    return prefix
}

function netmaskFromPrefix(rawPrefix) {
    const prefix = Number(rawPrefix)
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null
    if (prefix === 0) return '0.0.0.0'
    return intToIpv4((0xffffffff << (32 - prefix)) >>> 0)
}

function subnetDetails(address, rawPrefix) {
    const ip = ipv4ToInt(address)
    const prefixLength = Number(rawPrefix)
    if (ip == null || !Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) return null
    const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0
    const network = (ip & mask) >>> 0
    const broadcast = (network | (~mask >>> 0)) >>> 0
    const firstHost = prefixLength >= 31 ? network : network + 1
    const lastHost = prefixLength >= 31 ? broadcast : broadcast - 1
    return {
        address,
        prefixLength,
        netmask: intToIpv4(mask),
        networkAddress: intToIpv4(network),
        broadcastAddress: intToIpv4(broadcast),
        firstHost: intToIpv4(firstHost),
        lastHost: intToIpv4(lastHost),
        hostCount: prefixLength >= 31 ? Math.max(1, 2 ** (32 - prefixLength)) : Math.max(0, (2 ** (32 - prefixLength)) - 2),
        cidr: `${intToIpv4(network)}/${prefixLength}`,
    }
}

function normalizeMac(value) {
    const clean = String(value || '').trim().replace(/-/g, ':').toLowerCase()
    return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(clean) ? clean : null
}

function isUsableInterface(row) {
    const address = String(row?.address || row?.IPAddress || '').trim()
    return ipv4ToInt(address) != null && !address.startsWith('127.') && !address.startsWith('169.254.')
}

function buildContext(row, source = 'os') {
    const address = String(row?.address || row?.IPAddress || '').trim()
    const prefixLength = Number.isInteger(Number(row?.prefixLength ?? row?.PrefixLength))
        ? Number(row?.prefixLength ?? row?.PrefixLength)
        : prefixFromNetmask(row?.netmask)
    const subnet = subnetDetails(address, prefixLength)
    if (!subnet) return null
    const gateway = String(row?.gateway || row?.NextHop || '').trim()
    return {
        ...subnet,
        gateway: ipv4ToInt(gateway) != null && gateway !== '0.0.0.0' ? gateway : null,
        interfaceName: String(row?.interfaceName || row?.InterfaceAlias || row?.name || '').trim() || null,
        interfaceIndex: Number.isInteger(Number(row?.interfaceIndex ?? row?.InterfaceIndex))
            ? Number(row?.interfaceIndex ?? row?.InterfaceIndex)
            : null,
        interfaceDescription: String(row?.interfaceDescription || row?.InterfaceDescription || '').trim() || null,
        interfaceStatus: String(row?.interfaceStatus || row?.Status || '').trim() || null,
        mac: normalizeMac(row?.mac || row?.MacAddress),
        routeMetric: Number.isFinite(Number(row?.routeMetric ?? row?.RouteMetric)) ? Number(row?.routeMetric ?? row?.RouteMetric) : null,
        interfaceMetric: Number.isFinite(Number(row?.interfaceMetric ?? row?.InterfaceMetric)) ? Number(row?.interfaceMetric ?? row?.InterfaceMetric) : null,
        source,
    }
}

function scoreContext(context) {
    let score = 0
    if (context.gateway) score += 1000
    if (/up|connected|conectado/i.test(context.interfaceStatus || '')) score += 100
    if (!/(virtual|vmware|vethernet|hyper-v|loopback|bluetooth|wintun|tun|tap)/i.test(`${context.interfaceName || ''} ${context.interfaceDescription || ''}`)) score += 40
    const metric = (context.routeMetric ?? 9999) + (context.interfaceMetric ?? 0)
    score -= Math.min(metric, 9999) / 100
    return score
}

function normalizeContexts(rows, source = 'os') {
    return (Array.isArray(rows) ? rows : rows ? [rows] : [])
        .filter(isUsableInterface)
        .map(row => buildContext(row, source))
        .filter(Boolean)
        .sort((a, b) => scoreContext(b) - scoreContext(a))
}

function contextsFromOsInterfaces() {
    const rows = []
    for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
        for (const address of addresses || []) {
            if (address?.family !== 'IPv4' || address?.internal) continue
            rows.push({ ...address, name })
        }
    }
    return normalizeContexts(rows, 'os-fallback')
}

module.exports = {
    buildWindowsNetworkContextScript,
    ipv4ToInt,
    intToIpv4,
    prefixFromNetmask,
    netmaskFromPrefix,
    subnetDetails,
    normalizeContexts,
    contextsFromOsInterfaces,
}
