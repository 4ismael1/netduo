const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // Network
    getNetworkInterfaces: () => ipcRenderer.invoke('get-network-interfaces'),
    getVpnStatus: () => ipcRenderer.invoke('get-vpn-status'),
    getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
    getPublicIP: () => ipcRenderer.invoke('get-public-ip'),
    getIPGeo: (ip) => ipcRenderer.invoke('get-ip-geo', ip),
    getWifiInfo: () => ipcRenderer.invoke('get-wifi-info'),
    getDnsServers: () => ipcRenderer.invoke('get-dns-servers'),
    getArpTable: () => ipcRenderer.invoke('get-arp-table'),

    // Diagnostics
    pingHost: (host, count) => ipcRenderer.invoke('ping-host', host, count),
    pingSingle: (host) => ipcRenderer.invoke('ping-single', host),
    dnsLookup: (hostname, type) => ipcRenderer.invoke('dns-lookup', hostname, type),
    checkPort: (host, port, timeout) => ipcRenderer.invoke('check-port', host, port, timeout),

    // Streaming — traceroute
    startTraceroute: (host) => ipcRenderer.send('start-traceroute', host),
    stopTraceroute: () => ipcRenderer.send('stop-traceroute'),
    onTracerouteHop: (cb) => ipcRenderer.on('traceroute:hop', (_, data) => cb(data)),
    onTracerouteDone: (cb) => ipcRenderer.once('traceroute:done', () => cb()),
    offTraceroute: () => {
        ipcRenderer.removeAllListeners('traceroute:hop')
        ipcRenderer.removeAllListeners('traceroute:done')
    },

    // Streaming — live ping
    startPingLive: (host, count) => ipcRenderer.send('start-ping-live', host, count),
    stopPingLive: () => ipcRenderer.send('stop-ping-live'),
    onPingReply: (cb) => ipcRenderer.on('ping:reply', (_, data) => cb(data)),
    onPingDone: (cb) => ipcRenderer.once('ping:done', (_, data) => cb(data)),
    offPingLive: () => {
        ipcRenderer.removeAllListeners('ping:reply')
        ipcRenderer.removeAllListeners('ping:done')
    },

    // Streaming — MTR
    startMtr: (host, interval) => ipcRenderer.send('start-mtr', host, interval),
    stopMtr: (sessionId) => ipcRenderer.send('stop-mtr', sessionId),
    onMtrSession: (cb) => ipcRenderer.once('mtr:session', (_, id) => cb(id)),
    onMtrHops: (cb) => ipcRenderer.once('mtr:hops', (_, data) => cb(data)),
    onMtrUpdate: (cb) => ipcRenderer.on('mtr:update', (_, data) => cb(data)),
    offMtr: () => {
        ipcRenderer.removeAllListeners('mtr:session')
        ipcRenderer.removeAllListeners('mtr:hops')
        ipcRenderer.removeAllListeners('mtr:update')
    },

    // Tools
    scanPorts: (host, start, end) => ipcRenderer.invoke('scan-ports', host, start, end),
    httpTest: (url, method, headers) => ipcRenderer.invoke('http-test', url, method, headers),
    lanScan: (base, start, end) => ipcRenderer.invoke('lan-scan', base, start, end),
    lanScanEnrich: (payload) => ipcRenderer.invoke('lan-scan-enrich', payload),
    lanUpnpScan: (base, start, end) => ipcRenderer.invoke('lan-upnp-scan', base, start, end),
    lanSecurityScan: (payload) => ipcRenderer.invoke('lan-security-scan', payload),
    sslCheck: (host, port) => ipcRenderer.invoke('ssl-check', host, port),
    whois: (query) => ipcRenderer.invoke('whois', query),
    wakeOnLan: (mac, broadcast, port) => ipcRenderer.invoke('wake-on-lan', mac, broadcast, port),

    // Speed Test
    speedDownload: () => ipcRenderer.invoke('speed-download'),
    speedLatency: () => ipcRenderer.invoke('speed-latency'),
    speedGetServers: () => ipcRenderer.invoke('speed-get-servers'),
    speedTestFull: (serverId) => ipcRenderer.invoke('speed-test-full', serverId),
    onSpeedProgress: (callback) => {
        const handler = (_event, data) => callback(data)
        ipcRenderer.on('speed-progress', handler)
        return () => ipcRenderer.removeListener('speed-progress', handler)
    },

    // History
    historyGet: () => ipcRenderer.invoke('history-get'),
    historyAdd: (entry) => ipcRenderer.invoke('history-add', entry),
    historyClear: () => ipcRenderer.invoke('history-clear'),

    // Speed-test history
    speedHistoryGet: () => ipcRenderer.invoke('speed-history-get'),
    speedHistoryAdd: (entry) => ipcRenderer.invoke('speed-history-add', entry),
    speedHistoryClear: () => ipcRenderer.invoke('speed-history-clear'),

    // LAN-check report history
    lanCheckHistoryGet: () => ipcRenderer.invoke('lan-check-history-get'),
    lanCheckHistoryAdd: (entry) => ipcRenderer.invoke('lan-check-history-add', entry),
    lanCheckHistoryDelete: (id) => ipcRenderer.invoke('lan-check-history-delete', id),
    lanCheckHistoryClear: () => ipcRenderer.invoke('lan-check-history-clear'),

    // Network change events
    onNetworkChanged: (cb) => {
        const handler = (_event, data) => cb(data)
        ipcRenderer.on('network:changed', handler)
        return () => ipcRenderer.removeListener('network:changed', handler)
    },
    onNetworkSignal: (cb) => {
        const handler = (_event, data) => cb(data)
        ipcRenderer.on('network:signal', handler)
        return () => ipcRenderer.removeListener('network:signal', handler)
    },
    offNetworkEvents: () => {
        ipcRenderer.removeAllListeners('network:changed')
        ipcRenderer.removeAllListeners('network:signal')
    },

    // Config (key/value persistence)
    configGet: (key) => ipcRenderer.invoke('config-get', key),
    configSet: (key, value) => ipcRenderer.invoke('config-set', key, value),
    configGetAll: (keys) => ipcRenderer.invoke('config-get-all', keys),
    configDelete: (key) => ipcRenderer.invoke('config-delete', key),
    wanProbeConfigGet: () => ipcRenderer.invoke('wan-probe-config-get'),
    wanProbeConfigSet: (payload) => ipcRenderer.invoke('wan-probe-config-set', payload),

    // WAN Probe
    wanProbeRequest: (opts) => ipcRenderer.invoke('wan-probe-request', opts),
})
