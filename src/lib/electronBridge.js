/**
 * electronBridge.js â€” V2
 * Unified bridge for Electron IPC and browser fallback mock
 */
function rnd(min, max) { return parseFloat((Math.random() * (max - min) + min).toFixed(1)) }
function rndInt(min, max) { return Math.floor(Math.random() * (max - min + 1) + min) }

function mockInterfaces() {
    return [
        { name: 'Ethernet', address: '192.168.1.105', netmask: '255.255.255.0', cidr: '192.168.1.105/24', mac: 'a4:83:e7:1c:22:fa', internal: false, family: 'IPv4' },
        { name: 'Ethernet', address: 'fe80::a483:e7ff:fe1c:22fa', netmask: 'ffff:ffff:ffff:ffff::', cidr: null, mac: 'a4:83:e7:1c:22:fa', internal: false, family: 'IPv6' },
        { name: 'Wi-Fi', address: '192.168.1.110', netmask: '255.255.255.0', cidr: '192.168.1.110/24', mac: 'bc:d0:74:33:11:d2', internal: false, family: 'IPv4' },
        { name: 'Loopback', address: '127.0.0.1', netmask: '255.0.0.0', cidr: '127.0.0.1/8', mac: '00:00:00:00:00:00', internal: true, family: 'IPv4' },
    ]
}

function mockPingResult(host) {
    const times = Array.from({ length: 4 }, () => rndInt(12, 80))
    return {
        host, times,
        avg: (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1),
        min: Math.min(...times).toFixed(1),
        max: Math.max(...times).toFixed(1),
        loss: 0,
        raw: times.map(t => `Reply from ${host}: bytes=32 time=${t}ms TTL=56`).join('\n'),
        success: true,
    }
}

const API = window.electronAPI
const CONFIG_CHANGE_EVENT = 'netduo:config-changed'
const DEFAULT_PUBLIC_CONFIG_KEYS = ['accentColor', 'theme', 'pollInterval', 'notifications', 'latencyThreshold', 'lancheck.settings']
const SENSITIVE_CONFIG_KEYS = new Set(['wanProbeKey', 'wanProbePool'])
const WAN_PROBE_CONFIG_KEYS = [
    'wanProbePool',
    'wanProbeUrl',
    'wanProbeKey',
    'wanProbeConnected',
    'wanProbeInfo',
    'wanProbeMode',
    'wanProbeScope',
    'wanProbeProfile',
    'wanProbeTransport',
    'wanProbeUseCustomTarget',
    'wanProbeTarget',
    'wanProbeCustomPorts',
    'wanProbeUsePortRange',
    'wanProbeRangeFrom',
    'wanProbeRangeTo',
    'wanProbeCustomUdpPorts',
    'wanProbeUseUdpPortRange',
    'wanProbeUdpRangeFrom',
    'wanProbeUdpRangeTo',
]

function emitConfigChanged(detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
    window.dispatchEvent(new CustomEvent(CONFIG_CHANGE_EVENT, { detail }))
}

function isSensitiveConfigKey(key) {
    return SENSITIVE_CONFIG_KEYS.has(String(key || '').trim())
}

function normalizeRequestedConfigKeys(keys, fallbackKeys = DEFAULT_PUBLIC_CONFIG_KEYS) {
    if (!Array.isArray(keys) || !keys.length) return fallbackKeys
    return Array.from(new Set(
        keys
            .map(key => String(key || '').trim())
            .filter(Boolean)
    ))
}

function readFallbackConfig(keys = DEFAULT_PUBLIC_CONFIG_KEYS) {
    const output = {}
    for (const key of normalizeRequestedConfigKeys(keys)) {
        const raw = localStorage.getItem(`netpulse_cfg_${key}`)
        if (raw == null) continue
        try {
            output[key] = JSON.parse(raw)
        } catch {
            output[key] = raw
        }
    }
    return output
}

function readFallbackPublicConfig(keys = DEFAULT_PUBLIC_CONFIG_KEYS) {
    return readFallbackConfig(
        normalizeRequestedConfigKeys(keys).filter(key => !isSensitiveConfigKey(key))
    )
}

function writeFallbackConfigEntries(payload, keys) {
    for (const key of normalizeRequestedConfigKeys(keys, [])) {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) continue
        localStorage.setItem(`netpulse_cfg_${key}`, JSON.stringify(payload[key]))
        emitConfigChanged({ key, value: payload[key], deleted: false })
    }
}

const bridge = {
    isElectron: !!API,

    // Window
    minimize: () => API?.minimize(),
    maximize: () => API?.maximize(),
    close: () => API?.close(),
    openExternal: (url) => {
        if (API?.openExternal) return API.openExternal(url)
        try {
            window.open(url, '_blank', 'noopener,noreferrer')
            return Promise.resolve({ ok: true })
        } catch {
            return Promise.resolve({ ok: false, error: 'open-failed' })
        }
    },

    // Network info
    getNetworkInterfaces: () => API ? API.getNetworkInterfaces() : Promise.resolve(mockInterfaces()),
    getVpnStatus: () => API?.getVpnStatus
        ? API.getVpnStatus()
        : Promise.resolve({
            active: false,
            source: 'mock',
            checkedAt: new Date().toISOString(),
            tunnel: null,
            details: { defaultRouteViaTunnel: false, routeCount: 0 },
        }),
    getSystemInfo: () => API ? API.getSystemInfo() : Promise.resolve({
        hostname: 'DESKTOP-NETDUO', platform: 'win32', arch: 'x64',
        uptime: 86400 * 3 + 7200, cpus: 8, cpuModel: 'Intel Core i7-12700H',
        totalmem: 16 * 1e9, freemem: 6.2 * 1e9,
    }),
    getPublicIP: () => API ? API.getPublicIP() : Promise.resolve('203.0.113.45'),
    getIPGeo: ip => API ? API.getIPGeo(ip) : Promise.resolve({
        country: 'United States', city: 'New York', isp: 'Comcast Cable',
        org: 'AS7922 Comcast Cable Communications', lat: 40.7128, lon: -74.0060,
        timezone: 'America/New_York', status: 'success', as: 'AS7922',
    }),
    getWifiInfo: () => API ? API.getWifiInfo() : Promise.resolve({
        ssid: 'HomeNetwork_5G', signal: '78%', bssid: 'c4:e9:84:1c:22:fa',
        channel: '6', band: '802.11ac (5 GHz)', speed: '300 Mbps',
    }),
    getDnsServers: () => API ? API.getDnsServers() : Promise.resolve(['8.8.8.8', '8.8.4.4', '1.1.1.1']),
    getArpTable: () => API ? API.getArpTable() : Promise.resolve([
        { ip: '192.168.1.1', mac: 'c4:e9:84:1c:22:fa', type: 'dynamic' },
        { ip: '192.168.1.100', mac: 'a4:83:e7:1c:22:fa', type: 'dynamic' },
        { ip: '192.168.1.101', mac: 'bc:d0:74:33:11:d2', type: 'dynamic' },
        { ip: '192.168.1.200', mac: 'f4:f5:d8:ab:cd:ef', type: 'dynamic' },
    ]),

    // Network change events
    onNetworkChanged: (cb) => API?.onNetworkChanged?.(cb) || (() => {}),
    onNetworkSignal: (cb) => API?.onNetworkSignal?.(cb) || (() => {}),
    offNetworkEvents: () => API?.offNetworkEvents?.(),

    // Ping
    pingHost: (host, count = 4) =>
        API ? API.pingHost(host, count)
            : new Promise(r => setTimeout(() => r(mockPingResult(host)), 800 + Math.random() * 400)),
    pingSingle: host =>
        API ? API.pingSingle(host)
            : new Promise(r => setTimeout(() => r({ host, time: rndInt(14, 95), success: true }), 150 + Math.random() * 200)),

    // Streaming â€” traceroute (Electron uses events, browser uses mock timer)
    startTraceroute: (host, onHop, onDone) => {
        if (API) {
            API.stopTraceroute?.()
            API.offTraceroute()
            API.onTracerouteHop(onHop)
            API.onTracerouteDone(onDone)
            API.startTraceroute(host)
        } else {
            // Mock: simulate hops arriving one by one
            const mockHops = [
                { hop: 1, ip: '192.168.1.1', times: [1], avg: '1.0' },
                { hop: 2, ip: '10.0.0.1', times: [8, 9, 8], avg: '8.3' },
                { hop: 3, ip: '72.14.192.1', times: [12, 11], avg: '11.5' },
                { hop: 4, ip: '108.170.252.1', times: [14, 15], avg: '14.5' },
                { hop: 5, ip: '209.85.244.173', times: [18, 20], avg: '19.0' },
                { hop: 6, ip: '142.250.69.78', times: [20, 19], avg: '19.5' },
                { hop: 7, ip: host, times: [22, 21], avg: '21.5' },
            ]
            let i = 0
            const tick = () => {
                if (i < mockHops.length) {
                    onHop(mockHops[i++])
                    setTimeout(tick, 400 + Math.random() * 600)
                } else {
                    onDone()
                }
            }
            setTimeout(tick, 300)
        }
    },
    onConfigChanged: (callback) => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
        const handler = event => callback(event?.detail || {})
        window.addEventListener(CONFIG_CHANGE_EVENT, handler)
        return () => window.removeEventListener(CONFIG_CHANGE_EVENT, handler)
    },
    offTraceroute: () => {
        API?.stopTraceroute?.()
        API?.offTraceroute?.()
    },

    // Streaming â€” live ping
    startPingLive: (host, count, onReply, onDone) => {
        if (API) {
            API.stopPingLive?.()
            API.offPingLive()
            API.onPingReply(onReply)
            API.onPingDone(onDone)
            API.startPingLive(host, count)
        } else {
            let seq = 0
            const tick = () => {
                if (seq >= count) { onDone({ seqNum: seq }); return }
                seq++
                const timeout = Math.random() < 0.05
                const time = timeout ? null : rndInt(14, 95)
                onReply({ seq, time, raw: timeout ? 'Request timeout' : `Reply from ${host}: time=${time}ms TTL=56`, timeout })
                setTimeout(tick, 500 + Math.random() * 500)
            }
            setTimeout(tick, 200)
        }
    },
    offPingLive: () => {
        API?.stopPingLive?.()
        API?.offPingLive?.()
    },

    // Streaming â€” MTR
    startMtr: (host, interval, onHops, onUpdate, onSession) => {
        if (API) {
            API.offMtr()
            API.onMtrSession(onSession)
            API.onMtrHops(onHops)
            API.onMtrUpdate(onUpdate)
            API.startMtr(host, interval)
        } else {
            const mockHops = [
                { hop: 1, ip: '192.168.1.1', sent: 0, lost: 0, times: [], min: Infinity, max: 0, avg: null, loss: '0' },
                { hop: 2, ip: '10.0.0.1', sent: 0, lost: 0, times: [], min: Infinity, max: 0, avg: null, loss: '0' },
                { hop: 3, ip: '72.14.192.1', sent: 0, lost: 0, times: [], min: Infinity, max: 0, avg: null, loss: '0' },
                { hop: 4, ip: host, sent: 0, lost: 0, times: [], min: Infinity, max: 0, avg: null, loss: '0' },
            ]
            const sessionId = `mock-${Date.now()}`
            setTimeout(() => { onSession(sessionId); onHops([...mockHops]) }, 200)
            let running = true
            bridge._mtrStoppers = bridge._mtrStoppers || {}
            bridge._mtrStoppers[sessionId] = () => { running = false }
            const tick = () => {
                if (!running) return
                mockHops.forEach(h => {
                    const timeout = Math.random() < 0.03
                    const time = timeout ? null : rnd(h.hop * 3 + 1, h.hop * 10 + 20)
                    h.sent++
                    if (time == null) { h.lost++ } else {
                        h.times.push(time)
                        if (time < h.min) h.min = time
                        if (time > h.max) h.max = time
                        h.avg = (h.times.reduce((a, b) => a + b, 0) / h.times.length).toFixed(1)
                    }
                    h.loss = ((h.lost / h.sent) * 100).toFixed(0)
                })
                onUpdate([...mockHops])
                setTimeout(tick, interval || 1000)
            }
            setTimeout(tick, 600)
        }
    },
    stopMtr: sessionId => {
        if (API) { API.stopMtr(sessionId); API.offMtr() }
        else if (bridge._mtrStoppers?.[sessionId]) { bridge._mtrStoppers[sessionId](); delete bridge._mtrStoppers[sessionId] }
    },
    offMtr: () => API?.offMtr(),

    // DNS
    dnsLookup: (hostname, type) =>
        API ? API.dnsLookup(hostname, type)
            : new Promise(r => setTimeout(() => {
                const mock = {
                    A: { addresses: ['142.250.80.46', '142.250.80.78'], time: 28 },
                    AAAA: { addresses: ['2607:f8b0:4004:c07::6a'], time: 34 },
                    MX: { addresses: ['smtp.google.com (priority 10)', 'alt1.aspmx.l.google.com (priority 20)'], time: 42 },
                    TXT: { addresses: ['v=spf1 include:_spf.google.com ~all', 'google-site-verification=abc123'], time: 38 },
                    NS: { addresses: ['ns1.google.com', 'ns2.google.com', 'ns3.google.com', 'ns4.google.com'], time: 29 },
                    CNAME: { addresses: [], time: 25 },
                    SRV: { addresses: [], time: 25 },
                }
                r({ type, ...(mock[type] || { addresses: [], time: 30 }), error: null })
            }, 300 + Math.random() * 400)),

    // Port tools
    checkPort: (host, port, timeout) =>
        API ? API.checkPort(host, port, timeout)
            : new Promise(r => setTimeout(() => r({ host, port, open: [80, 443, 22, 53].includes(port) || Math.random() > 0.6, time: rndInt(20, 200) }), 600)),
    scanPorts: (host, start, end) =>
        API ? API.scanPorts(host, start, end)
            : new Promise(r => setTimeout(() => {
                const open = [21, 22, 25, 53, 80, 110, 143, 443, 587, 993, 995, 3306, 3389, 5432, 8080].filter(p => p >= start && p <= end)
                r(open.map(port => ({ port, open: true })))
            }, 1500 + (end - start) * 5)),
    stopPortScan: () => API?.stopPortScan?.(),

    // HTTP test
    httpTest: (url, method, headers) =>
        API ? API.httpTest(url, method, headers)
            : new Promise(r => setTimeout(() => r({
                status: 200, statusText: 'OK',
                headers: { 'content-type': 'application/json', 'server': 'nginx' },
                time: rndInt(80, 350),
                bodyPreview: '{"status":"ok","url":"' + url + '"}',
                success: true,
            }), 500 + Math.random() * 500)),

    // LAN scan
    lanScan: (base, start, end) =>
        API ? API.lanScan(base, start, end)
            : new Promise(r => setTimeout(() => {
                const devices = [
                    { ip: `${base}.1`, alive: true, time: 1, mac: 'c4:e9:84:0a:11:22', hostname: 'router.lan', displayName: 'router.lan', nameSource: 'ptr', vendor: 'TP-Link', vendorSource: 'oui', isGateway: true, isLocal: false, isRandomized: false, macEmpty: false },
                    { ip: `${base}.100`, alive: true, time: 4, mac: 'a4:83:e7:1c:22:fa', hostname: 'DESKTOP-PC', displayName: 'DESKTOP-PC', nameSource: 'netbios', vendor: null, vendorSource: 'unknown', isGateway: false, isLocal: true, isRandomized: false, macEmpty: false },
                    { ip: `${base}.101`, alive: true, time: 5, mac: 'bc:d0:74:33:11:d2', hostname: null, displayName: 'Samsung', nameSource: 'unknown', vendor: 'Samsung', vendorSource: 'oui', isGateway: false, isLocal: false, isRandomized: false, macEmpty: false },
                    { ip: `${base}.102`, alive: true, time: 7, mac: '00:12:fb:a1:b2:c3', hostname: 'printer.local', displayName: 'printer.local', nameSource: 'ptr', vendor: null, vendorSource: 'unknown', isGateway: false, isLocal: false, isRandomized: false, macEmpty: false },
                    { ip: `${base}.103`, alive: true, time: 12, mac: 'ac:de:48:00:11:22', hostname: null, displayName: 'Apple', nameSource: 'unknown', vendor: 'Apple', vendorSource: 'oui', isGateway: false, isLocal: false, isRandomized: false, macEmpty: false },
                    { ip: `${base}.200`, alive: true, time: 15, mac: 'f4:f5:d8:ab:cd:ef', hostname: 'nest-hub.local', displayName: 'nest-hub.local', nameSource: 'ptr', vendor: 'Google', vendorSource: 'oui', isGateway: false, isLocal: false, isRandomized: false, macEmpty: false },
                ].filter(d => { const l = parseInt(d.ip.split('.').pop()); return l >= start && l <= end })
                r(devices)
            }, 2000 + Math.random() * 1000)),
    lanScanEnrich: (payload) =>
        API?.lanScanEnrich
            ? API.lanScanEnrich(payload)
            : new Promise(resolve => {
                const rows = Array.isArray(payload?.devices) ? payload.devices : []
                const updates = rows
                    .filter(d => d && d.ip && (!d.hostname || !d.vendor))
                    .map(d => ({
                        ip: d.ip,
                        hostname: d.hostname || (Math.random() > 0.65 ? `host-${d.ip.split('.').pop()}` : null),
                        nameSource: d.hostname ? d.nameSource || null : 'mdns',
                        vendor: d.vendor || null,
                        vendorSource: d.vendor ? d.vendorSource || null : null,
                        displayName: d.hostname || d.vendor || null,
                    }))
                    .filter(u => u.hostname || u.vendor)
                setTimeout(() => resolve(updates), 700 + Math.random() * 600)
            }),
    lanUpnpScan: (base, start, end) =>
        API ? API.lanUpnpScan(base, start, end)
            : new Promise(r => setTimeout(() => r({
                ok: true,
                scannedRange: { baseIP: base, rangeStart: start, rangeEnd: end },
                devices: [
                    {
                        ip: `${base}.1`,
                        location: `http://${base}.1:49000/rootDesc.xml`,
                        server: 'Linux/5.10 UPnP/1.0 MiniUPnPd/2.3',
                        st: 'upnp:rootdevice',
                        usn: 'uuid:router::upnp:rootdevice',
                        friendlyName: 'Wireless Router',
                        manufacturer: 'Generic',
                        modelName: 'IGD Router',
                        serviceTypes: [
                            'urn:schemas-upnp-org:service:WANIPConnection:1',
                            'urn:schemas-upnp-org:service:Layer3Forwarding:1',
                        ],
                        isIgd: true,
                        isRootDevice: true,
                    },
                ],
                summary: {
                    ssdpResponders: 1,
                    igdCount: 1,
                    rootDeviceCount: 1,
                    gatewayResponderCount: 1,
                    gatewayIgdCount: 1,
                },
                checkedAt: new Date().toISOString(),
            }), 1200)),
    lanSecurityScan: (payload) =>
        API?.lanSecurityScan
            ? API.lanSecurityScan(payload)
            : new Promise(resolve => {
                const targets = Array.isArray(payload?.targets) ? payload.targets : []
                const tcpPorts = Array.isArray(payload?.tcpPorts) ? payload.tcpPorts : []
                const udpPorts = Array.isArray(payload?.udpPorts) ? payload.udpPorts : []
                const results = targets.map(target => {
                    const tcpEntries = tcpPorts
                        .filter(port => [22, 23, 80, 443, 445, 3389, 7547, 8080].includes(port) || Math.random() > 0.96)
                        .map(port => ({
                            protocol: 'tcp',
                            port,
                            state: 'open',
                            rtt: rndInt(8, 170),
                            service: null,
                            detail: null,
                        }))
                    const udpEntries = udpPorts
                        .filter(port => [53, 123, 161, 1900].includes(port) && Math.random() > 0.35)
                        .map(port => ({
                            protocol: 'udp',
                            port,
                            state: port === 161 ? 'open' : 'filtered',
                            rtt: rndInt(12, 220),
                            service: null,
                            detail: null,
                        }))
                    return { ip: target?.ip, entries: [...tcpEntries, ...udpEntries] }
                })
                setTimeout(() => resolve({ ok: true, results, durationMs: rndInt(500, 1700) }), 700 + Math.random() * 500)
            }),

    // SSL Check
    sslCheck: (host, port = 443) =>
        API ? API.sslCheck(host, port)
            : new Promise(r => setTimeout(() => r({
                subject: host, issuer: 'DigiCert Inc',
                validFrom: 'Jan 15 00:00:00 2024 GMT',
                validTo: 'Jan 15 23:59:59 2025 GMT',
                daysLeft: 90, expired: false,
                fingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD',
                san: `DNS:${host}, DNS:www.${host}`,
                protocol: 'TLSv1.3', time: rndInt(200, 600),
            }), 800 + Math.random() * 400)),

    // Whois
    whois: query =>
        API ? API.whois(query)
            : new Promise(r => setTimeout(() => r({
                raw: `Domain Name: ${query.toUpperCase()}\nRegistrar: Example Registrar, Inc.\nCreation Date: 1997-09-15\nExpires: 2028-09-14\nName Server: ns1.google.com\nDNSSEC: unsigned`,
                server: 'whois.iana.org',
            }), 1000 + Math.random() * 1000)),

    // Wake-on-LAN
    wakeOnLan: (mac, broadcast, port) =>
        API ? API.wakeOnLan(mac, broadcast, port)
            : new Promise(r => setTimeout(() => r({ success: true, mac, broadcast: broadcast || '255.255.255.255' }), 400)),

    // Speed
    speedDownload: () =>
        API ? API.speedDownload()
            : new Promise(r => setTimeout(() => r({ speedMbps: rnd(45, 180), bytes: 10000000, time: rnd(0.5, 2) }), 4000 + Math.random() * 3000)),
    speedLatency: () =>
        API ? API.speedLatency()
            : new Promise(r => setTimeout(() => r({ latency: rnd(12, 55), jitter: rnd(1, 8) }), 2500)),
    speedGetServers: () =>
        API ? API.speedGetServers()
            : Promise.resolve([
                { id: 'mlab', name: 'M-Lab NDT7', location: 'Auto - nearest server', sponsor: 'Measurement Lab (Google)' },
                { id: 'cloudflare', name: 'Cloudflare', location: 'Global CDN (nearest edge)', sponsor: 'Cloudflare, Inc.' },
                { id: 'hetzner', name: 'Hetzner', location: 'Europe - Nuremberg, Germany', sponsor: 'Hetzner Online GmbH' },
                { id: 'ovh', name: 'OVH', location: 'Europe - Gravelines, France', sponsor: 'OVH SAS' },
            ]),
    speedTestFull: (serverId) =>
        API ? API.speedTestFull(serverId)
            : new Promise(r => setTimeout(() => r({
                server: { name: 'Mock Server', location: 'Local', host: 'mock.test', sponsor: 'Mock' },
                latency: rnd(12, 55), jitter: rnd(1, 8),
                download: rnd(45, 180), upload: rnd(15, 80),
                dlBytes: 25000000, ulBytes: 10000000, dlTime: rnd(1, 4), ulTime: rnd(1, 5),
            }), 8000)),
    stopSpeedTest: () => API?.stopSpeedTest?.(),
    onSpeedProgress: (callback) => {
        if (API?.onSpeedProgress) return API.onSpeedProgress(callback)
        // Mock: simulate live progress events
        let cancelled = false
        const server = { name: 'Mock Server', location: 'Local', host: 'mock.test', sponsor: 'Mock' }
        setTimeout(() => { if (!cancelled) callback({ phase: 'init', message: 'Finding best server...' }) }, 200)
        setTimeout(() => { if (!cancelled) callback({ phase: 'latency', latency: rnd(15, 40), jitter: rnd(1, 5), server }) }, 800)
        setTimeout(() => { if (!cancelled) callback({ phase: 'calibrating', message: 'Calibrating...' }) }, 1000)
        setTimeout(() => { if (!cancelled) callback({ phase: 'calibrated', probeSpeed: rnd(30, 120), dlTarget: 25000000, ulTarget: 10000000 }) }, 1800)
        setTimeout(() => { if (!cancelled) callback({ phase: 'download-start' }) }, 2000)
        for (let i = 1; i <= 20; i++) {
            setTimeout(() => { if (!cancelled) callback({ phase: 'downloading', instantSpeed: rnd(30, 150), avgSpeed: rnd(50, 130), progress: i * 5, bytesReceived: i * 1250000, elapsed: i * 0.2 }) }, 1200 + i * 200)
        }
        setTimeout(() => { if (!cancelled) callback({ phase: 'download-done', speed: rnd(60, 150) }) }, 5400)
        setTimeout(() => { if (!cancelled) callback({ phase: 'upload-start' }) }, 6200)
        for (let i = 1; i <= 15; i++) {
            setTimeout(() => { if (!cancelled) callback({ phase: 'uploading', instantSpeed: rnd(10, 60), avgSpeed: rnd(20, 50), progress: Math.min(99, i * 7), bytesSent: i * 660000, elapsed: i * 0.25 }) }, 6200 + i * 250)
        }
        setTimeout(() => { if (!cancelled) callback({ phase: 'upload-done', speed: rnd(20, 60) }) }, 10200)
        setTimeout(() => { if (!cancelled) callback({ phase: 'done', result: { download: rnd(60, 150), upload: rnd(20, 60), latency: rnd(15, 40), jitter: rnd(1, 5), server } }) }, 10500)
        return () => { cancelled = true }
    },

    // History
    historyGet: () =>
        API ? API.historyGet()
            : Promise.resolve(JSON.parse(localStorage.getItem('netduo_history') || '[]')),
    historyAdd: entry => {
        if (API) return API.historyAdd(entry)
        const h = JSON.parse(localStorage.getItem('netduo_history') || '[]')
        const updated = [{ ...entry, id: Date.now(), timestamp: new Date().toISOString() }, ...h].slice(0, 200)
        localStorage.setItem('netduo_history', JSON.stringify(updated))
        return Promise.resolve(updated)
    },
    historyClear: () => {
        if (API) return API.historyClear()
        localStorage.removeItem('netduo_history')
        localStorage.removeItem('netpulse_history')
        return Promise.resolve([])
    },

    // Speed-test dedicated history (persists to disk)
    speedHistoryGet: () =>
        API?.speedHistoryGet
            ? API.speedHistoryGet()
            : Promise.resolve(JSON.parse(localStorage.getItem('netpulse_speed_history') || '[]')),
    speedHistoryAdd: entry => {
        if (API?.speedHistoryAdd) return API.speedHistoryAdd(entry)
        const h = JSON.parse(localStorage.getItem('netpulse_speed_history') || '[]')
        const updated = [{ ...entry, id: Date.now(), timestamp: new Date().toISOString() }, ...h].slice(0, 100)
        localStorage.setItem('netpulse_speed_history', JSON.stringify(updated))
        return Promise.resolve(updated)
    },
    speedHistoryClear: () => {
        if (API?.speedHistoryClear) return API.speedHistoryClear()
        localStorage.removeItem('netpulse_speed_history')
        return Promise.resolve([])
    },
    lanCheckHistoryGet: () =>
        API?.lanCheckHistoryGet
            ? API.lanCheckHistoryGet()
            : Promise.resolve(JSON.parse(localStorage.getItem('netduo_lancheck_history') || '[]')),
    lanCheckHistoryAdd: entry => {
        if (API?.lanCheckHistoryAdd) return API.lanCheckHistoryAdd(entry)
        const h = JSON.parse(localStorage.getItem('netduo_lancheck_history') || '[]')
        const payload = entry && typeof entry === 'object' ? (entry.report || entry) : null
        if (!payload || typeof payload !== 'object') return Promise.resolve(h)
        const updated = [{
            id: Date.now(),
            report: payload,
            profile: payload.profile || null,
            scope: payload.range || null,
            risk_score: Number.isFinite(payload?.summary?.riskScore) ? Number(payload.summary.riskScore) : null,
            findings: Array.isArray(payload.findings) ? payload.findings.length : null,
            open_ports: Array.isArray(payload.openPorts) ? payload.openPorts.length : null,
            timestamp: new Date().toISOString(),
        }, ...h].slice(0, 120)
        localStorage.setItem('netduo_lancheck_history', JSON.stringify(updated))
        return Promise.resolve(updated)
    },
    lanCheckHistoryDelete: id => {
        if (API?.lanCheckHistoryDelete) return API.lanCheckHistoryDelete(id)
        const safeId = Number.parseInt(String(id), 10)
        const h = JSON.parse(localStorage.getItem('netduo_lancheck_history') || '[]')
        if (!Number.isInteger(safeId)) return Promise.resolve(h)
        const updated = h.filter(item => Number.parseInt(String(item.id), 10) !== safeId)
        localStorage.setItem('netduo_lancheck_history', JSON.stringify(updated))
        return Promise.resolve(updated)
    },
    lanCheckHistoryClear: () => {
        if (API?.lanCheckHistoryClear) return API.lanCheckHistoryClear()
        localStorage.removeItem('netduo_lancheck_history')
        return Promise.resolve([])
    },

    // Config (key/value persistence â€” SQLite backed)
    configGet: key => {
        if (isSensitiveConfigKey(key)) return Promise.resolve(null)
        return API?.configGet ? API.configGet(key)
            : Promise.resolve(JSON.parse(localStorage.getItem(`netpulse_cfg_${key}`) || 'null'))
    },
    configSet: (key, value) => {
        if (isSensitiveConfigKey(key)) return Promise.resolve(false)
        if (API?.configSet) {
            return Promise.resolve(API.configSet(key, value)).then(result => {
                emitConfigChanged({ key, value, deleted: false })
                return result
            })
        }
        localStorage.setItem(`netpulse_cfg_${key}`, JSON.stringify(value))
        emitConfigChanged({ key, value, deleted: false })
        return Promise.resolve(true)
    },
    configGetAll: keys =>
        API?.configGetAll ? API.configGetAll(keys)
            : Promise.resolve(readFallbackPublicConfig(keys)),
    configGetPublic: keys =>
        API?.configGetAll ? API.configGetAll(keys)
            : Promise.resolve(readFallbackPublicConfig(keys)),
    configDelete: key => {
        if (isSensitiveConfigKey(key)) return Promise.resolve(false)
        if (API?.configDelete) {
            return Promise.resolve(API.configDelete(key)).then(result => {
                emitConfigChanged({ key, value: null, deleted: true })
                return result
            })
        }
        localStorage.removeItem(`netpulse_cfg_${key}`)
        emitConfigChanged({ key, value: null, deleted: true })
        return Promise.resolve(true)
    },
    wanProbeConfigGet: () => {
        if (API?.wanProbeConfigGet) return API.wanProbeConfigGet()
        return Promise.resolve(readFallbackConfig(WAN_PROBE_CONFIG_KEYS))
    },
    wanProbeConfigSet: payload => {
        if (API?.wanProbeConfigSet) return API.wanProbeConfigSet(payload)
        writeFallbackConfigEntries(payload || {}, WAN_PROBE_CONFIG_KEYS)
        return Promise.resolve(true)
    },

    // WAN Probe â€” HTTP request proxy
    wanProbeRequest: opts => {
        if (API?.wanProbeRequest) return API.wanProbeRequest(opts)
        // Browser mock â€” simulate a successful health check
        const path = new URL(opts.url).pathname
        if (path === '/health') return Promise.resolve({ status: 200, data: { status: 'ok', version: '0.1.0-mock' } })
        if (path === '/whoami') return Promise.resolve({ status: 200, data: { yourIp: '203.0.113.45', version: '0.1.0-mock' } })
        if (path.startsWith('/scan/start')) return Promise.resolve({ status: 200, data: { jobId: 'mock-job-001' } })
        if (path.startsWith('/scan/')) return Promise.resolve({ status: 200, data: {
            status: 'done', target: '203.0.113.45', observedIp: '203.0.113.45',
            riskScore: 35, durationMs: 8400, openCount: 2, closedCount: 4, filteredCount: 1,
            ports: [
                { port: 80, service: 'HTTP', state: 'open', rttMs: 12, attempts: 1 },
                { port: 443, service: 'HTTPS', state: 'open', rttMs: 14, attempts: 1 },
                { port: 22, service: 'SSH', state: 'closed', rttMs: null, attempts: 3 },
                { port: 23, service: 'Telnet', state: 'closed', rttMs: null, attempts: 3 },
                { port: 3389, service: 'RDP', state: 'closed', rttMs: null, attempts: 3 },
                { port: 8080, service: 'HTTP-Alt', state: 'filtered', rttMs: null, attempts: 3 },
                { port: 21, service: 'FTP', state: 'closed', rttMs: null, attempts: 3 },
            ],
            findings: [
                { severity: 'medium', title: 'HTTP port 80 open', description: 'Port 80 is reachable from the internet.', recommendation: 'Close port 80 if not needed or redirect to HTTPS.' },
                { severity: 'low', title: 'HTTPS port 443 open', description: 'Port 443 is reachable from the internet.', recommendation: 'Ensure a valid TLS certificate is configured.' },
            ],
        } })
        return Promise.resolve({ status: 404, data: { error: 'Not found' } })
    },
}

export default bridge
