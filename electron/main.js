const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const { exec, spawn } = require('child_process')
const os = require('os')
const dns = require('dns')
const net = require('net')
const tls = require('tls')
const dgram = require('dgram')
const https = require('https')
const http = require('http')
const WsClient = require('ws')
const database = require('./database')

const isDev = process.env.NODE_ENV !== 'production'
const appIconPath = path.join(__dirname, 'assets', 'icon.ico')

// ─── Helpers ──────────────────────────────────────────────────────────────
const PING_TIME_RE = /(?:tiempo|time|zeit|temps|tempo|tyd)[=<]\s*(\d+\.?\d*)/i

function run(cmd, timeout = 15000) {
    return new Promise(resolve => {
        exec(cmd, { timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
            resolve({ err, out: (stdout || '') + (stderr || '') })
        })
    })
}

function parseJsonSafe(text, fallback) {
    try {
        return JSON.parse(text)
    } catch {
        return fallback
    }
}

async function getWindowsAdapterHints() {
    if (process.platform !== 'win32') return {}
    const psCmd = [
        'powershell',
        '-NoProfile',
        '-Command',
        '"Get-NetAdapter | Select-Object Name, InterfaceDescription, Status, InterfaceType | ConvertTo-Json -Compress"',
    ].join(' ')

    const { err, out } = await run(psCmd, 10000)
    if (err || !out) return {}

    const parsed = parseJsonSafe(out.trim(), [])
    const rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
    const map = {}
    for (const row of rows) {
        const name = String(row?.Name || '').trim()
        if (!name) continue
        map[name] = {
            interfaceDescription: row?.InterfaceDescription || null,
            status: row?.Status || null,
            interfaceType: row?.InterfaceType || null,
        }
    }
    return map
}

const VPN_INTERFACE_RE = /(vpn|openvpn|wireguard|wintun|nordlynx|tailscale|zerotier|hamachi|ppp|ikev2|l2tp|sstp|pptp|utun\d*|tun\d*|tap\d*)/i
const CONNECTED_STATUS_RE = /^(up|connected)$/i
const IGNORED_ROUTE_PREFIX_RE = /^(127\.|169\.254\.|224\.|255\.)/

function asArray(value) {
    if (!value) return []
    return Array.isArray(value) ? value : [value]
}

function toInt(value) {
    const n = Number.parseInt(String(value), 10)
    return Number.isFinite(n) ? n : null
}

function isVpnTagged(name, description = '') {
    return VPN_INTERFACE_RE.test(`${String(name || '')} ${String(description || '')}`)
}

function isConnectedAdapterStatus(status) {
    return CONNECTED_STATUS_RE.test(String(status || '').trim())
}

function isConnectedIpState(connectionState) {
    const value = String(connectionState ?? '').trim().toLowerCase()
    return value === '1' || value === 'connected'
}

function isUsableIpv4(ip) {
    const value = String(ip || '').trim()
    if (!value) return false
    if (value === '127.0.0.1') return false
    if (value.startsWith('169.254.')) return false
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(value)
}

function isMeaningfulRoutePrefix(prefix) {
    const value = String(prefix || '').trim()
    if (!value) return false
    if (value === '0.0.0.0/0') return true
    const [ip] = value.split('/')
    if (!ip) return false
    return !IGNORED_ROUTE_PREFIX_RE.test(ip)
}

function summarizeGenericVpnStatus() {
    const now = new Date().toISOString()
    const ifaces = os.networkInterfaces()
    for (const [name, rows] of Object.entries(ifaces)) {
        for (const row of rows || []) {
            if (!row || row.internal) continue
            if (!isVpnTagged(name)) continue
            if (row.family !== 'IPv4' || !isUsableIpv4(row.address)) continue
            return {
                active: true,
                source: 'generic-interface-scan',
                checkedAt: now,
                tunnel: {
                    interfaceName: name,
                    interfaceDescription: null,
                    localIp: row.address,
                },
                details: {
                    defaultRouteViaTunnel: null,
                    routeCount: null,
                },
            }
        }
    }

    return {
        active: false,
        source: 'generic-interface-scan',
        checkedAt: now,
        tunnel: null,
        details: {
            defaultRouteViaTunnel: null,
            routeCount: 0,
        },
    }
}

async function detectWindowsVpnStatus() {
    const psCmd = [
        'powershell',
        '-NoProfile',
        '-Command',
        `"@{
adapters = Get-NetAdapter -IncludeHidden | Select-Object Name, InterfaceDescription, Status, InterfaceType, ifIndex
ipInterfaces = Get-NetIPInterface -AddressFamily IPv4 -IncludeAllCompartments | Select-Object InterfaceAlias, InterfaceIndex, ConnectionState
ipAddresses = Get-NetIPAddress -AddressFamily IPv4 | Select-Object InterfaceAlias, InterfaceIndex, IPAddress
routes = Get-NetRoute -AddressFamily IPv4 | Select-Object DestinationPrefix, NextHop, InterfaceAlias, InterfaceIndex
} | ConvertTo-Json -Compress -Depth 6"`,
    ].join(' ')

    const now = new Date().toISOString()
    const { err, out } = await run(psCmd, 12000)
    if (err || !out) {
        return {
            active: false,
            source: 'windows-netstack',
            checkedAt: now,
            error: 'powershell-unavailable',
            tunnel: null,
            details: {
                defaultRouteViaTunnel: false,
                routeCount: 0,
            },
        }
    }

    const parsed = parseJsonSafe(out.trim(), null)
    if (!parsed || typeof parsed !== 'object') {
        return {
            active: false,
            source: 'windows-netstack',
            checkedAt: now,
            error: 'invalid-netstack-json',
            tunnel: null,
            details: {
                defaultRouteViaTunnel: false,
                routeCount: 0,
            },
        }
    }

    const adapters = asArray(parsed.adapters)
    const ipIfaces = asArray(parsed.ipInterfaces)
    const ipAddresses = asArray(parsed.ipAddresses)
    const routes = asArray(parsed.routes)

    const adapterByIndex = new Map()
    for (const row of adapters) {
        const idx = toInt(row?.ifIndex)
        if (idx == null) continue
        adapterByIndex.set(idx, row)
    }

    const ifaceByIndex = new Map()
    for (const row of ipIfaces) {
        const idx = toInt(row?.InterfaceIndex)
        if (idx == null) continue
        ifaceByIndex.set(idx, row)
    }

    const addressesByIndex = new Map()
    for (const row of ipAddresses) {
        const idx = toInt(row?.InterfaceIndex)
        if (idx == null) continue
        const ip = String(row?.IPAddress || '').trim()
        if (!isUsableIpv4(ip)) continue
        if (!addressesByIndex.has(idx)) addressesByIndex.set(idx, [])
        addressesByIndex.get(idx).push(ip)
    }

    const routesByIndex = new Map()
    for (const row of routes) {
        const idx = toInt(row?.InterfaceIndex)
        if (idx == null) continue
        if (!routesByIndex.has(idx)) routesByIndex.set(idx, [])
        routesByIndex.get(idx).push(row)
    }

    const candidateIndexes = new Set()
    for (const row of adapters) {
        const idx = toInt(row?.ifIndex)
        if (idx == null) continue
        if (isVpnTagged(row?.Name, row?.InterfaceDescription)) candidateIndexes.add(idx)
    }
    for (const row of ipIfaces) {
        const idx = toInt(row?.InterfaceIndex)
        if (idx == null) continue
        if (isVpnTagged(row?.InterfaceAlias)) candidateIndexes.add(idx)
    }
    for (const row of ipAddresses) {
        const idx = toInt(row?.InterfaceIndex)
        if (idx == null) continue
        if (isVpnTagged(row?.InterfaceAlias)) candidateIndexes.add(idx)
    }
    for (const row of routes) {
        const idx = toInt(row?.InterfaceIndex)
        if (idx == null) continue
        const adapter = adapterByIndex.get(idx)
        if (isVpnTagged(row?.InterfaceAlias, adapter?.InterfaceDescription)) {
            candidateIndexes.add(idx)
        }
    }

    const candidates = []
    for (const idx of candidateIndexes) {
        const adapter = adapterByIndex.get(idx) || null
        const iface = ifaceByIndex.get(idx) || null
        const localIps = addressesByIndex.get(idx) || []
        const rawRoutes = routesByIndex.get(idx) || []
        const meaningfulRoutes = rawRoutes.filter(route => isMeaningfulRoutePrefix(route?.DestinationPrefix))
        const defaultRoute = meaningfulRoutes.some(route => String(route?.DestinationPrefix || '').trim() === '0.0.0.0/0')

        const adapterUp = isConnectedAdapterStatus(adapter?.Status)
        const ifaceConnected = isConnectedIpState(iface?.ConnectionState)
        const hasAddress = localIps.length > 0
        const hasRoute = meaningfulRoutes.length > 0

        let score = 0
        if (adapterUp) score += 3
        if (ifaceConnected) score += 2
        if (hasAddress) score += 3
        if (hasRoute) score += 2
        if (defaultRoute) score += 2

        candidates.push({
            interfaceIndex: idx,
            interfaceName: String(adapter?.Name || iface?.InterfaceAlias || '').trim() || `if-${idx}`,
            interfaceDescription: String(adapter?.InterfaceDescription || '').trim() || null,
            localIps,
            routeCount: meaningfulRoutes.length,
            defaultRoute,
            adapterUp,
            ifaceConnected,
            score,
        })
    }

    candidates.sort((a, b) => b.score - a.score)
    const best = candidates[0] || null
    const active = !!(best && (best.score >= 5 || (best.localIps.length > 0 && best.routeCount > 0)))

    return {
        active,
        source: 'windows-netstack',
        checkedAt: now,
        tunnel: active ? {
            interfaceIndex: best.interfaceIndex,
            interfaceName: best.interfaceName,
            interfaceDescription: best.interfaceDescription,
            localIp: best.localIps[0] || null,
        } : null,
        details: {
            defaultRouteViaTunnel: !!best?.defaultRoute,
            routeCount: best?.routeCount || 0,
            candidateCount: candidates.length,
        },
        candidates: candidates.slice(0, 5).map(candidate => ({
            interfaceIndex: candidate.interfaceIndex,
            interfaceName: candidate.interfaceName,
            interfaceDescription: candidate.interfaceDescription,
            localIps: candidate.localIps,
            routeCount: candidate.routeCount,
            defaultRoute: candidate.defaultRoute,
            score: candidate.score,
        })),
    }
}

let _vpnStatusCache = { value: null, ts: 0, pending: null }

async function getVpnStatus() {
    const now = Date.now()
    if (_vpnStatusCache.value && (now - _vpnStatusCache.ts) < 3500) {
        return _vpnStatusCache.value
    }
    if (_vpnStatusCache.pending) return _vpnStatusCache.pending

    _vpnStatusCache.pending = (async () => {
        try {
            const status = process.platform === 'win32'
                ? await detectWindowsVpnStatus()
                : summarizeGenericVpnStatus()
            _vpnStatusCache.value = status
            _vpnStatusCache.ts = Date.now()
            return status
        } catch (error) {
            const fallback = {
                active: false,
                source: process.platform === 'win32' ? 'windows-netstack' : 'generic-interface-scan',
                checkedAt: new Date().toISOString(),
                error: error?.message || 'vpn-detection-failed',
                tunnel: null,
                details: {
                    defaultRouteViaTunnel: false,
                    routeCount: 0,
                },
            }
            _vpnStatusCache.value = fallback
            _vpnStatusCache.ts = Date.now()
            return fallback
        } finally {
            _vpnStatusCache.pending = null
        }
    })()

    return _vpnStatusCache.pending
}

function runProgram(cmd, args = [], timeout = 15000) {
    return new Promise(resolve => {
        let stdout = ''
        let stderr = ''
        let finished = false

        const child = spawn(cmd, args, { shell: false, windowsHide: true })
        const done = (err) => {
            if (finished) return
            finished = true
            clearTimeout(timer)
            resolve({ err, out: stdout + stderr })
        }

        const timer = setTimeout(() => {
            try { child.kill() } catch { /* noop */ }
            done(new Error(`${cmd} timed out`))
        }, timeout)

        if (child.stdout) child.stdout.on('data', data => { stdout += data.toString() })
        if (child.stderr) child.stderr.on('data', data => { stderr += data.toString() })
        child.on('error', err => done(err))
        child.on('close', code => {
            if (code === 0) done(null)
            else done(new Error(`${cmd} exited with code ${code}`))
        })
    })
}

function parsePingTimes(output) {
    const times = []
    output.split('\n').forEach(line => {
        const m = line.match(PING_TIME_RE)
        if (m) times.push(parseFloat(m[1]))
    })
    return times
}

function parseLoss(output, hadError) {
    const m = output.match(/\((\d+)%/)
    if (m) return parseInt(m[1])
    const m2 = output.match(/(\d+)%/)
    if (m2) return parseInt(m2[1])
    return hadError ? 100 : 0
}

// ─── Window ───────────────────────────────────────────────────────────────
let mainWin = null

function createWindow() {
    const savedTheme = database.configGet('theme')
    const bootTheme = savedTheme === 'dark' ? 'dark' : 'light'
    const isDarkTheme = bootTheme === 'dark'

    const win = new BrowserWindow({
        width: 1280, height: 800,
        minWidth: 1280, minHeight: 800,
        frame: false,
        titleBarStyle: 'hidden',
        show: false,
        icon: appIconPath,
        backgroundColor: isDarkTheme ? '#050507' : '#f1f5f9',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    })

    mainWin = win

    if (isDev) {
        win.loadURL(`http://localhost:5173/?bootTheme=${bootTheme}`)
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'), { query: { bootTheme } })
    }
    win.once('ready-to-show', () => win.show())

    const onMinimize = () => {
        if (!win.isDestroyed()) win.minimize()
    }
    const onMaximize = () => {
        if (!win.isDestroyed()) {
            win.isMaximized() ? win.unmaximize() : win.maximize()
        }
    }
    const onClose = () => {
        if (win.isDestroyed()) return
        // Perceived-performance fix: hide instantly, then destroy window.
        // This avoids renderer-side unload delays feeling like a "stuck close" UX.
        try { win.hide() } catch { /* noop */ }
        setImmediate(() => {
            try {
                if (!win.isDestroyed()) win.destroy()
            } catch { /* noop */ }
        })
    }

    ipcMain.on('window-minimize', onMinimize)
    ipcMain.on('window-maximize', onMaximize)
    ipcMain.on('window-close', onClose)

    win.on('closed', () => {
        ipcMain.removeListener('window-minimize', onMinimize)
        ipcMain.removeListener('window-maximize', onMaximize)
        ipcMain.removeListener('window-close', onClose)
    })
}
function normalizeExternalUrl(rawUrl) {
    const input = String(rawUrl || '').trim()
    if (!input) return null
    try {
        const parsed = new URL(input)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
        return parsed.toString()
    } catch {
        return null
    }
}

ipcMain.handle('open-external', async (_, rawUrl) => {
    const target = normalizeExternalUrl(rawUrl)
    if (!target) return { ok: false, error: 'invalid-url' }
    try {
        await shell.openExternal(target)
        return { ok: true }
    } catch (error) {
        return { ok: false, error: error?.message || 'open-failed' }
    }
})

// -- Network Change Watcher ---------------------------------------
let _lastSSID = null
let _lastBSSID = null
let _lastSignal = null
let _lastChannel = null
let _netWatchTimer = null
let _wifiConnected = null  // true/false/null

async function getWifiSnapshot() {
    if (process.platform !== 'win32') return null
    try {
        const { out } = await run('netsh wlan show interfaces', 5000)
        if (!out) return null
        const lines = out.split('\n')
        const get = (...keys) => {
            for (const key of keys) {
                for (const l of lines) {
                    if (key.toLowerCase() === 'ssid') {
                        if (/^\s+SSID\s/i.test(l) && !/BSSID/i.test(l) && l.includes(':'))
                            return l.substring(l.indexOf(':') + 1).trim()
                    } else if (l.toLowerCase().includes(key.toLowerCase()) && l.includes(':')) {
                        return l.substring(l.indexOf(':') + 1).trim()
                    }
                }
            }
            return null
        }
        const ssid = get('SSID')
        if (!ssid) return { connected: false }
        const bssid = (get('BSSID') || '').toLowerCase()
        const channel = get('Channel', 'Canal')
        let signal = get('Signal')
        if (!signal) {
            const sigLine = lines.find(l => l.includes('%') && l.includes(':') && !/Velocidad|rate|Mbps/i.test(l))
            if (sigLine) signal = sigLine.substring(sigLine.indexOf(':') + 1).trim()
        }
        const band = get('Radio type', 'Tipo de radio')
        const rxSpeed = get('Receive rate', 'Velocidad de recepci')
        const txSpeed = get('Transmit rate', 'Velocidad de transmisi')
        const auth = get('Authentication', 'Autenticaci')
        const cipher = get('Cipher', 'Cifrado')
        const netType = get('Network type', 'Tipo de red')
        const phyAddr = get('Physical address', 'Direcci')
        const adapter = get('Description', 'Descripci')

        let wifiGen = null
        if (band) {
            const b = band.toLowerCase()
            if (b.includes('be') || b.includes('802.11be')) wifiGen = { gen: 7, label: 'Wi-Fi 7', proto: '802.11be' }
            else if (b.includes('ax') || b.includes('802.11ax')) wifiGen = { gen: 6, label: 'Wi-Fi 6', proto: '802.11ax' }
            else if (b.includes('ac') || b.includes('802.11ac')) wifiGen = { gen: 5, label: 'Wi-Fi 5', proto: '802.11ac' }
            else if (b.includes('11n') || b.includes('802.11n')) wifiGen = { gen: 4, label: 'Wi-Fi 4', proto: '802.11n' }
            else wifiGen = { gen: null, label: band, proto: band }
        }
        let freqBand = null
        const ch = parseInt(channel)
        if (ch >= 1 && ch <= 14) freqBand = '2.4 GHz'
        else if (ch >= 32 && ch <= 177) freqBand = '5 GHz'
        else if (ch >= 1 && ch <= 233) freqBand = '6 GHz'

        return { connected: true, ssid, signal, bssid, channel, band, rxSpeed, txSpeed, auth, cipher, netType, phyAddr, adapter, wifiGen, freqBand }
    } catch { return null }
}

function startNetworkWatcher() {
    _netWatchTimer = setInterval(async () => {
        if (!mainWin || mainWin.isDestroyed()) return
        const snap = await getWifiSnapshot()
        if (!snap) return

        const nowConnected = snap.connected
        const ssidChanged = snap.ssid !== _lastSSID
        const bssidChanged = snap.bssid !== _lastBSSID
        const channelChanged = snap.channel !== _lastChannel
        const disconnected = _wifiConnected === true && !nowConnected
        const reconnected = _wifiConnected === false && nowConnected

        if (disconnected) {
            mainWin.webContents.send('network:changed', { event: 'disconnected', wifi: null })
        } else if (reconnected || (_wifiConnected === null && nowConnected)) {
            mainWin.webContents.send('network:changed', { event: 'connected', wifi: snap })
        } else if (nowConnected && (ssidChanged || bssidChanged || channelChanged)) {
            mainWin.webContents.send('network:changed', { event: 'network-switch', wifi: snap })
        } else if (nowConnected && snap.signal !== _lastSignal) {
            mainWin.webContents.send('network:signal', { signal: snap.signal })
        }

        _lastSSID = snap.ssid || null
        _lastBSSID = snap.bssid || null
        _lastSignal = snap.signal || null
        _lastChannel = snap.channel || null
        _wifiConnected = nowConnected
    }, 5000)
}

function stopNetworkWatcher() {
    if (_netWatchTimer) { clearInterval(_netWatchTimer); _netWatchTimer = null }
}

app.whenReady().then(() => {
    database.init(app.getPath('userData'))
    createWindow()
    startNetworkWatcher()
})
app.on('window-all-closed', () => {
    stopNetworkWatcher()
    database.close()
    if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ═══════════════════════════════════════════════════════
//   STANDARD IPC HANDLERS (request → response)
// ═══════════════════════════════════════════════════════

ipcMain.handle('get-network-interfaces', async () => {
    const ifaces = os.networkInterfaces()
    const hints = await getWindowsAdapterHints()
    const result = []
    for (const [name, addrs] of Object.entries(ifaces)) {
        if (!addrs) continue
        const hint = hints[name] || {}
        for (const addr of addrs) {
            result.push({
                name,
                ...addr,
                interfaceDescription: hint.interfaceDescription || null,
                interfaceStatus: hint.status || null,
                interfaceType: hint.interfaceType || null,
            })
        }
    }
    return result
})

ipcMain.handle('get-vpn-status', async () => getVpnStatus())

ipcMain.handle('get-system-info', () => ({
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || '—',
    totalmem: os.totalmem(),
    freemem: os.freemem(),
}))

ipcMain.handle('get-public-ip', () => new Promise(resolve => {
    https.get('https://api.ipify.org?format=json', res => {
        let d = ''
        res.on('data', c => { d += c })
        res.on('end', () => { try { resolve(JSON.parse(d).ip) } catch { resolve('Unknown') } })
    }).on('error', () => resolve('Unavailable'))
}))

ipcMain.handle('get-ip-geo', (_, ip) => new Promise(resolve => {
    http.get(`http://ip-api.com/json/${ip}?fields=status,country,city,isp,org,lat,lon,timezone,as`, res => {
        let d = ''
        res.on('data', c => { d += c })
        res.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve({}) } })
    }).on('error', () => resolve({}))
}))

// ── WiFi Info (Windows) ───────────────────────────────
ipcMain.handle('get-wifi-info', async () => {
    const snap = await getWifiSnapshot()
    if (!snap || !snap.connected) return null
    // Return same shape, minus the 'connected' field
    const { connected: _CONNECTED, ...wifi } = snap
    return wifi
})

// ── DNS Servers ───────────────────────────────────────
ipcMain.handle('get-dns-servers', () => dns.getServers())

// ── ARP Table ─────────────────────────────────────────
ipcMain.handle('get-arp-table', async () => {
    const { out } = await run('arp -a', 5000)
    const entries = []
    out.split('\n').forEach(line => {
        // Windows: "  192.168.1.1           c4-e9-84-1c-22-fa     dynamic"
        const m = line.match(/\s*([\d.]+)\s+([0-9a-f:.-]+)\s+(\w+)/i)
        if (m && !m[1].includes('255.') && m[2] !== 'ff-ff-ff-ff-ff-ff') {
            entries.push({
                ip: m[1],
                mac: m[2].replace(/-/g, ':').toLowerCase(),
                type: m[3].toLowerCase(),
            })
        }
    })
    return entries
})

// ── Ping host ─────────────────────────────────────────
ipcMain.handle('ping-host', async (_, rawHost, count = 4) => {
    const host = sanitizeHost(rawHost)
    if (!host) return { host: rawHost, times: [], avg: null, min: null, max: null, loss: 100, raw: '', success: false }
    const isWin = process.platform === 'win32'
    const safeCount = Number.isInteger(count) ? Math.max(1, Math.min(count, 10)) : 4
    const args = isWin ? ['-4', '-n', String(safeCount), host] : ['-c', String(safeCount), host]
    const { err, out } = await runProgram('ping', args, 20000)
    const times = parsePingTimes(out)
    return {
        host, times,
        avg: times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : null,
        min: times.length ? Math.min(...times).toFixed(1) : null,
        max: times.length ? Math.max(...times).toFixed(1) : null,
        loss: parseLoss(out, !!err),
        raw: out,
        success: !err && times.length > 0,
    }
})

ipcMain.handle('ping-single', async (_, rawHost) => {
    const host = sanitizeHost(rawHost)
    if (!host) return { host: rawHost, time: null, success: false }
    const isWin = process.platform === 'win32'
    const args = isWin ? ['-4', '-n', '1', '-w', '2000', host] : ['-c', '1', '-W', '2', host]
    const { err, out } = await runProgram('ping', args, 5000)
    if (err) return { host, time: null, success: false }
    const m = out.match(PING_TIME_RE)
    return { host, time: m ? parseFloat(m[1]) : null, success: !!m }
})

// ── DNS Lookup — fixed per record type ────────────────
ipcMain.handle('dns-lookup', (_, rawHostname, type) => new Promise(resolve => {
    const hostname = sanitizeHost(rawHostname)
    if (!hostname) return resolve({ type, addresses: [], error: 'Invalid hostname', time: 0 })
    const start = Date.now()
    const done = (err, raw) => {
        if (err) return resolve({ type, addresses: [], error: err.message, time: Date.now() - start })
        let addresses
        switch (type) {
            case 'MX': addresses = raw.map(r => `${r.exchange} (priority ${r.priority})`); break
            case 'TXT': addresses = raw.map(r => Array.isArray(r) ? r.join(' ') : String(r)); break
            case 'SRV': addresses = raw.map(r => `${r.name}:${r.port} (prio ${r.priority})`); break
            default: addresses = raw.map(String); break
        }
        resolve({ type, addresses, time: Date.now() - start })
    }
    switch (type) {
        case 'A': dns.resolve4(hostname, done); break
        case 'AAAA': dns.resolve6(hostname, done); break
        case 'MX': dns.resolveMx(hostname, done); break
        case 'TXT': dns.resolveTxt(hostname, done); break
        case 'NS': dns.resolveNs(hostname, done); break
        case 'CNAME': dns.resolveCname(hostname, done); break
        case 'SRV': dns.resolveSrv(hostname, done); break
        default: dns.resolve(hostname, type, done); break
    }
}))

// ── TCP Port Check ────────────────────────────────────
ipcMain.handle('check-port', (_, host, port, timeout = 3000) => new Promise(resolve => {
    const start = Date.now()
    const socket = new net.Socket()
    socket.setTimeout(timeout)
    socket.on('connect', () => { socket.destroy(); resolve({ host, port, open: true, time: Date.now() - start }) })
    socket.on('timeout', () => { socket.destroy(); resolve({ host, port, open: false, error: 'timeout', time: Date.now() - start }) })
    socket.on('error', err => resolve({ host, port, open: false, error: err.message, time: Date.now() - start }))
    socket.connect(port, host)
}))

// ── Port Scanner ──────────────────────────────────────
ipcMain.handle('scan-ports', async (_, host, startPort, endPort) => {
    const results = []
    const ports = []
    for (let p = startPort; p <= endPort; p++) ports.push(p)
    for (let i = 0; i < ports.length; i += 50) {
        const batch = ports.slice(i, i + 50)
        const res = await Promise.all(batch.map(port => new Promise(r => {
            const s = new net.Socket()
            s.setTimeout(800)
            s.on('connect', () => { s.destroy(); r({ port, open: true }) })
            s.on('timeout', () => { s.destroy(); r({ port, open: false }) })
            s.on('error', () => r({ port, open: false }))
            s.connect(port, host)
        })))
        results.push(...res.filter(r => r.open))
    }
    return results
})

// ── HTTP Test ─────────────────────────────────────────
ipcMain.handle('http-test', (_, url, method = 'GET', headers = {}) => new Promise(resolve => {
    const start = Date.now()
    try {
        const urlObj = new URL(url)
        const lib = urlObj.protocol === 'https:' ? https : http
        const req = lib.request(url, { method, headers, timeout: 12000 }, res => {
            let body = ''
            res.on('data', c => { if (body.length < 5000) body += c })
            res.on('end', () => resolve({
                status: res.statusCode, statusText: res.statusMessage,
                headers: res.headers, time: Date.now() - start,
                bodyPreview: body.substring(0, 2000), success: res.statusCode < 400,
            }))
        })
        req.on('error', err => resolve({ error: err.message, time: Date.now() - start, success: false }))
        req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', time: Date.now() - start, success: false }) })
        req.end()
    } catch (e) { resolve({ error: e.message, time: Date.now() - start, success: false }) }
}))

// ── LAN Scan ─────────────────────────────────────────
const { lookupVendor: ouiLookup } = require('./oui-db')
const vendorCache = new Map()
const vendorPending = new Map()

/** Run a promise with a timeout (ms). Returns fallback on timeout. */
function withTimeout(promise, ms, fallback = null) {
    return Promise.race([
        promise,
        new Promise(r => setTimeout(() => r(fallback), ms)),
    ])
}

/** Parallel map with concurrency limit */
async function parallelMap(items, fn, concurrency = 10) {
    const results = new Array(items.length)
    let idx = 0
    async function worker() {
        while (idx < items.length) {
            const i = idx++
            results[i] = await fn(items[i], i)
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
    return results
}

/** Reverse DNS lookup (PTR record) */
function reverseDNS(ip) {
    return new Promise((resolve) => {
        dns.reverse(ip, (err, hostnames) => {
            if (err || !hostnames || !hostnames.length) return resolve(null)
            resolve(hostnames[0])
        })
    })
}

/** Reverse lookup via nslookup (useful when dns.reverse fails on Windows). */
function nslookupReverse(ip) {
    return new Promise((resolve) => {
        exec(`nslookup ${ip}`, { timeout: 3200, windowsHide: true, encoding: 'utf8' }, (_err, stdout) => {
            if (!stdout) return resolve(null)
            const lines = stdout.split(/\r?\n/)
            for (const raw of lines) {
                const line = raw.trim()
                if (!line) continue
                const m1 = line.match(/^(?:name|nombre)\s*[:=]\s*(.+)$/i)
                if (m1?.[1]) return resolve(m1[1].trim())
                const m2 = line.match(/name\s*=\s*(.+)$/i)
                if (m2?.[1]) return resolve(m2[1].trim())
            }
            resolve(null)
        })
    })
}

/** lookupService name lookup (useful where reverse DNS is incomplete) */
function lookupServiceName(ip) {
    return new Promise((resolve) => {
        dns.lookupService(ip, 0, (err, hostname) => {
            if (err || !hostname) return resolve(null)
            resolve(hostname)
        })
    })
}

/** Windows hostname resolution through ping -a */
function pingResolveName(ip) {
    return new Promise((resolve) => {
        exec(`ping -a -4 -n 1 -w 1200 ${ip}`, { timeout: 3000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
            if (err && !stdout) return resolve(null)
            const escapedIp = ip.replace(/\./g, '\\.')
            const m = (stdout || '').match(new RegExp(`^[^\\r\\n]*?\\s([^\\s\\[]+)\\s*\\[${escapedIp}\\]`, 'im'))
            if (!m || !m[1]) return resolve(null)
            resolve(m[1].trim())
        })
    })
}

/** NetBIOS name lookup via nbtstat (Windows only) */
function netbiosLookup(ip) {
    return new Promise((resolve) => {
        exec(`nbtstat -A ${ip}`, { timeout: 3500, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
            if (err || !stdout) return resolve(null)
            // Parse <00> NetBIOS entries in a locale-tolerant way.
            const lines = stdout.split(/\r?\n/)
            for (const raw of lines) {
                const line = raw.trim()
                if (!line || !line.includes('<00>')) continue
                const m = line.match(/^([^\s<]+)\s+<00>\s+(.+)$/i)
                if (!m) continue
                const name = m[1].trim()
                const flags = m[2].toLowerCase()
                if (!name || name === 'WORKGROUP' || name.startsWith('IS~')) continue
                if (flags.includes('group') || flags.includes('grupo')) continue
                if (/^[0-9a-f]{12}$/i.test(name)) continue
                return resolve(name)
            }
            resolve(null)
        })
    })
}

function normalizeResolvedHost(raw) {
    if (!raw || typeof raw !== 'string') return null
    const clean = raw.trim().replace(/\.$/, '')
    if (!clean) return null
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) return null
    return clean
        .replace(/\.localdomain$/i, '')
        .replace(/\.local$/i, '')
        .replace(/\.lan$/i, '')
        .replace(/\.home$/i, '') || null
}

/** Online vendor fallback for unknown OUI prefixes (cached by prefix) */
function lookupVendorOnline(mac) {
    if (!mac || typeof mac !== 'string') return Promise.resolve(null)
    const norm = mac.replace(/-/g, ':').toUpperCase()
    const prefix = norm.substring(0, 8)
    if (!prefix || prefix.length !== 8) return Promise.resolve(null)
    if (vendorCache.has(prefix)) return Promise.resolve(vendorCache.get(prefix))
    if (vendorPending.has(prefix)) return vendorPending.get(prefix)

    const p = new Promise((resolve) => {
        const req = https.get(
            `https://api.macvendors.com/${encodeURIComponent(norm)}`,
            { headers: { 'User-Agent': 'NetDuo/1.0' } },
            (res) => {
                let body = ''
                res.on('data', c => {
                    if (body.length < 300) body += c.toString()
                })
                res.on('end', () => {
                    if (res.statusCode !== 200) return resolve(null)
                    const vendor = body.trim()
                    if (!vendor || /^error/i.test(vendor)) return resolve(null)
                    resolve(vendor.slice(0, 100))
                })
            }
        )
        req.on('error', () => resolve(null))
        req.setTimeout(2500, () => { req.destroy(); resolve(null) })
    }).then(vendor => {
        vendorCache.set(prefix, vendor || null)
        vendorPending.delete(prefix)
        return vendor || null
    })

    vendorPending.set(prefix, p)
    return p
}

async function resolveVendor(mac, skipOnline = false) {
    const localVendor = ouiLookup(mac)
    if (localVendor) return { vendor: localVendor, vendorSource: 'oui' }
    const derivedVendor = deriveVendorFromRandomized(mac)
    if (derivedVendor) return { vendor: derivedVendor, vendorSource: 'oui-derived' }
    if (!mac || skipOnline) return { vendor: null, vendorSource: 'unknown' }
    const onlineVendor = await withTimeout(lookupVendorOnline(mac), 2800, null)
    if (onlineVendor) return { vendor: onlineVendor, vendorSource: 'macvendors' }
    return { vendor: null, vendorSource: 'unknown' }
}

/** Heuristic for randomized MACs: clear local-admin bit and retry OUI lookup. */
function deriveVendorFromRandomized(mac) {
    if (!mac || typeof mac !== 'string') return null
    const norm = mac.replace(/-/g, ':').toLowerCase()
    const octets = norm.split(':')
    if (octets.length < 3) return null
    const first = parseInt(octets[0], 16)
    if (isNaN(first) || (first & 0x02) === 0) return null
    const derivedFirst = (first & 0xfd).toString(16).padStart(2, '0')
    const derivedMac = [derivedFirst, ...octets.slice(1)].join(':')
    return ouiLookup(derivedMac)
}

function decodeXmlEntities(s) {
    if (!s) return ''
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
}

function xmlTag(text, tag) {
    if (!text) return null
    const m = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
    if (!m || !m[1]) return null
    const v = decodeXmlEntities(m[1]).replace(/\s+/g, ' ').trim()
    return v || null
}

function parseSsdpHeaders(raw) {
    const headers = {}
    const lines = (raw || '').split(/\r?\n/)
    for (const line of lines) {
        const idx = line.indexOf(':')
        if (idx <= 0) continue
        const k = line.slice(0, idx).trim().toLowerCase()
        const v = line.slice(idx + 1).trim()
        if (k && v && !headers[k]) headers[k] = v
    }
    return headers
}

function ipInRange(ip, baseIP, rangeStart, rangeEnd) {
    if (!ip || !ip.startsWith(`${baseIP}.`)) return false
    const last = parseInt(ip.split('.').pop(), 10)
    return !isNaN(last) && last >= rangeStart && last <= rangeEnd
}

function httpGetText(urlStr, timeoutMs = 2200, redirects = 2) {
    return new Promise((resolve) => {
        let urlObj
        try { urlObj = new URL(urlStr) } catch { return resolve(null) }
        const lib = urlObj.protocol === 'https:' ? https : urlObj.protocol === 'http:' ? http : null
        if (!lib) return resolve(null)
        const req = lib.get(urlObj, { timeout: timeoutMs, headers: { 'User-Agent': 'NetDuo/1.0' } }, (res) => {
            const code = res.statusCode || 0
            if (code >= 300 && code < 400 && res.headers?.location && redirects > 0) {
                const next = new URL(res.headers.location, urlObj).toString()
                res.resume()
                return resolve(httpGetText(next, timeoutMs, redirects - 1))
            }
            if (code < 200 || code >= 300) {
                res.resume()
                return resolve(null)
            }
            let body = ''
            res.on('data', c => {
                if (body.length < 200000) body += c.toString()
            })
            res.on('end', () => resolve(body))
        })
        req.on('error', () => resolve(null))
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null) })
    })
}

async function fetchSsdpDescription(locationUrl) {
    const body = await httpGetText(locationUrl, 2400, 2)
    if (!body) return null
    const friendlyName = xmlTag(body, 'friendlyName')
    const manufacturer = xmlTag(body, 'manufacturer')
    const modelName = xmlTag(body, 'modelName')
    const serviceTypes = []
    const re = /<serviceType[^>]*>([\s\S]*?)<\/serviceType>/gi
    let match
    while ((match = re.exec(body)) !== null) {
        const serviceType = decodeXmlEntities(String(match[1] || '')).replace(/\s+/g, ' ').trim()
        if (serviceType) serviceTypes.push(serviceType)
    }
    if (!friendlyName && !manufacturer && !modelName && !serviceTypes.length) return null
    return {
        friendlyName,
        manufacturer,
        modelName,
        serviceTypes: [...new Set(serviceTypes)],
    }
}

function ssdpDiscover(timeoutMs = 2200) {
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4')
        const byIp = {}
        let done = false
        const finish = () => {
            if (done) return
            done = true
            try { socket.close() } catch { /* noop */ }
            resolve(byIp)
        }

        socket.on('error', finish)
        socket.on('message', (msg, rinfo) => {
            const ip = rinfo?.address
            if (!ip) return
            const h = parseSsdpHeaders(msg.toString('utf8'))
            const cur = byIp[ip] || {}
            byIp[ip] = {
                location: cur.location || h.location || null,
                server: cur.server || h.server || null,
                st: cur.st || h.st || null,
                usn: cur.usn || h.usn || null,
            }
        })

        socket.bind(0, () => {
            try { socket.setBroadcast(true) } catch { /* noop */ }
            const req = Buffer.from(
                'M-SEARCH * HTTP/1.1\r\n' +
                'HOST:239.255.255.250:1900\r\n' +
                'MAN:"ssdp:discover"\r\n' +
                'MX:1\r\n' +
                'ST:ssdp:all\r\n' +
                '\r\n'
            )
            socket.send(req, 0, req.length, 1900, '239.255.255.250', () => { })
            setTimeout(() => {
                socket.send(req, 0, req.length, 1900, '239.255.255.250', () => { })
            }, 300)
            setTimeout(finish, timeoutMs)
        })
    })
}

async function collectSsdpInfo(baseIP, rangeStart, rangeEnd) {
    const raw = await withTimeout(ssdpDiscover(2300), 2600, {})
    const inRange = {}
    for (const [ip, info] of Object.entries(raw || {})) {
        if (!ipInRange(ip, baseIP, rangeStart, rangeEnd)) continue
        inRange[ip] = { ...info }
    }
    if (Object.keys(inRange).length === 0) return {}

    const uniqueLocations = [...new Set(
        Object.values(inRange).map(v => v.location).filter(Boolean)
    )]
    const descByLocation = {}
    await parallelMap(uniqueLocations, async (loc) => {
        descByLocation[loc] = await withTimeout(fetchSsdpDescription(loc), 2600, null)
    }, 4)

    const out = {}
    for (const [ip, info] of Object.entries(inRange)) {
        const desc = info.location ? descByLocation[info.location] : null
        const friendlyName = normalizeResolvedHost(desc?.friendlyName || null)
        const manufacturer = (desc?.manufacturer || '').trim() || null
        const modelName = (desc?.modelName || '').trim() || null
        if (friendlyName || manufacturer || modelName) {
            out[ip] = { friendlyName, manufacturer, modelName }
        }
    }
    return out
}

/** Resolve hostname for a single device using multiple strategies */
async function resolveHostname(ip) {
    // 1. Reverse DNS (PTR)
    const ptr = await withTimeout(reverseDNS(ip), 1500)
    const ptrName = normalizeResolvedHost(ptr)
    if (ptrName) return { hostname: ptrName, nameSource: 'ptr' }

    // 2. nslookup reverse (Windows DNS path)
    if (process.platform === 'win32') {
        const ns = normalizeResolvedHost(await withTimeout(nslookupReverse(ip), 2200))
        if (ns) return { hostname: ns, nameSource: 'ptr' }
    }

    // 3. lookupService
    const svc = await withTimeout(lookupServiceName(ip), 1500)
    const svcName = normalizeResolvedHost(svc)
    if (svcName) return { hostname: svcName, nameSource: 'ptr' }

    // 4. ping -a for Windows DNS/LLMNR/NetBIOS-assisted resolution
    if (process.platform === 'win32') {
        const pingName = normalizeResolvedHost(await withTimeout(pingResolveName(ip), 2500))
        if (pingName) return { hostname: pingName, nameSource: 'ptr' }
    }

    // 5. NetBIOS
    if (process.platform === 'win32') {
        const nb = normalizeResolvedHost(await withTimeout(netbiosLookup(ip), 3500))
        if (nb) return { hostname: nb, nameSource: 'netbios' }
    }

    return { hostname: null, nameSource: 'unknown' }
}

/** Detect locally-administered (randomized) MACs */
function isRandomizedMAC(mac) {
    if (!mac) return false
    const firstOctet = parseInt(mac.replace(/-/g, ':').split(':')[0], 16)
    return !isNaN(firstOctet) && (firstOctet & 0x02) !== 0
}

function isEmptyMAC(mac) {
    if (!mac) return true
    const clean = mac.replace(/[:\-\s]/g, '')
    return !clean || clean === '000000000000' || clean === 'ffffffffffff'
}

function isUnicastMAC(mac) {
    if (!mac) return false
    const norm = mac.replace(/-/g, ':').toLowerCase()
    if (norm === 'ff:ff:ff:ff:ff:ff' || norm === '00:00:00:00:00:00') return false
    const firstOctet = parseInt(norm.split(':')[0], 16)
    if (isNaN(firstOctet)) return false
    // Multicast bit unset => unicast MAC.
    return (firstOctet & 0x01) === 0
}

/** Fast TCP touch: helps populate neighbor/ARP cache for hosts blocking ICMP. */
function tcpTouch(ip, port, timeoutMs = 320) {
    return new Promise((resolve) => {
        const socket = new net.Socket()
        let done = false
        const finish = (hit = false) => {
            if (done) return
            done = true
            try { socket.destroy() } catch { /* noop */ }
            resolve(hit)
        }
        socket.setTimeout(timeoutMs)
        socket.once('connect', () => finish(true))
        socket.once('timeout', () => finish(false))
        socket.once('error', () => finish(false))
        try {
            socket.connect(port, ip)
        } catch {
            finish(false)
        }
    })
}

async function preheatNeighborCache(targets) {
    if (!targets?.length) return
    const ports = [443, 80, 445, 22, 139, 53]
    await parallelMap(targets, async (ip) => {
        for (const port of ports) {
            await tcpTouch(ip, port, 280)
        }
    }, 44)
}

async function collectNeighborMap(baseIP, rangeStart, rangeEnd) {
    const map = {}

    // ARP cache
    try {
        const { out: arpOut } = await run('arp -a', 5000)
        arpOut.split('\n').forEach(line => {
            const m = line.match(/\s*([\d.]+)\s+([0-9a-f:.-]{11,})/i)
            if (!m) return
            const ip = m[1]
            const mac = m[2].replace(/-/g, ':').toLowerCase()
            if (!isUnicastMAC(mac)) return
            if (!ip.startsWith(`${baseIP}.`)) return
            const last = parseInt(ip.split('.').pop(), 10)
            if (isNaN(last) || last < rangeStart || last > rangeEnd) return
            map[ip] = mac
        })
    } catch { /* ignore */ }

    // Windows neighbor table is often richer than arp -a.
    if (process.platform === 'win32') {
        try {
            const psCmd = [
                'powershell',
                '-NoProfile',
                '-Command',
                '"Get-NetNeighbor -AddressFamily IPv4 | Select-Object IPAddress, LinkLayerAddress, State | ConvertTo-Json -Compress"',
            ].join(' ')
            const { err, out } = await run(psCmd, 6500)
            if (!err && out) {
                const parsed = parseJsonSafe(out.trim(), [])
                const rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
                for (const row of rows) {
                    const ip = String(row?.IPAddress || '').trim()
                    const state = String(row?.State || '').trim().toLowerCase()
                    const mac = String(row?.LinkLayerAddress || '').trim().replace(/-/g, ':').toLowerCase()
                    if (!ip || !ip.startsWith(`${baseIP}.`)) continue
                    const last = parseInt(ip.split('.').pop(), 10)
                    if (isNaN(last) || last < rangeStart || last > rangeEnd) continue
                    if (!isUnicastMAC(mac)) continue
                    if (/(incomplete|unreachable|invalid)/i.test(state)) continue
                    map[ip] = mac
                }
            }
        } catch { /* ignore */ }
    }

    return map
}

/** Get local machine's MAC address for the active interface */
function getLocalMAC() {
    const ifaces = os.networkInterfaces()
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
                return { ip: iface.address, mac: iface.mac.toLowerCase() }
            }
        }
    }
    return { ip: null, mac: null }
}

ipcMain.handle('lan-scan', async (_, baseIP, rangeStart, rangeEnd) => {
    let results = []
    const isWin = process.platform === 'win32'
    const local = getLocalMAC()
    const localHostname = os.hostname()

    // Clamp range
    rangeStart = Math.max(1, Math.min(254, parseInt(rangeStart) || 1))
    rangeEnd = Math.max(rangeStart, Math.min(254, parseInt(rangeEnd) || 254))

    // Phase 1: Ping sweep (batches of 24)
    const targets = []
    for (let i = rangeStart; i <= rangeEnd; i++) targets.push(`${baseIP}.${i}`)
    for (let i = 0; i < targets.length; i += 24) {
        const batch = targets.slice(i, i + 24)
        const res = await Promise.all(batch.map(ip => new Promise(resolve => {
            exec(isWin ? `ping -4 -n 1 -w 600 ${ip}` : `ping -c 1 -W 1 ${ip}`,
                { timeout: 3000, windowsHide: true, encoding: 'utf8' },
                (err, stdout) => {
                    const m = stdout && stdout.match(PING_TIME_RE)
                    const txt = String(stdout || '')
                    const hasReply = /(?:reply from|respuesta desde|bytes from|ttl[=\s:])/i.test(txt)
                    if ((m && !err) || hasReply) {
                        return resolve({ ip, alive: true, time: m ? parseFloat(m[1]) : null, mac: null })
                    }
                    resolve({ ip, alive: false })
                }
            )
        })))
        results.push(...res.filter(r => r.alive))
    }

    const byIp = new Map(results.map(r => [r.ip, r]))

    // Phase 2: Warm neighbor cache on silent hosts with quick TCP touches.
    const silentTargets = targets.filter(ip => !byIp.has(ip))
    await preheatNeighborCache(silentTargets)

    // Phase 3: Enrich using ARP + OS neighbor table and include silent neighbors.
    try {
        const neighborMap = await collectNeighborMap(baseIP, rangeStart, rangeEnd)
        for (const [ip, mac] of Object.entries(neighborMap)) {
            if (byIp.has(ip)) {
                byIp.get(ip).mac = mac
            } else {
                byIp.set(ip, { ip, alive: false, time: null, mac, seenOnly: true })
            }
        }
    } catch { /* neighbor enrichment failed */ }

    results = Array.from(byIp.values())
    if (results.length === 0) return results

    // Phase 4: SSDP discovery (UPnP devices often expose friendlyName/manufacturer)
    const ssdpByIp = await withTimeout(collectSsdpInfo(baseIP, rangeStart, rangeEnd), 4200, {})

    // Phase 5: Parallel name resolution + vendor lookup (concurrency = 8)
    await parallelMap(results, async (r) => {
        // Classification flags first (used by vendor and display fallbacks)
        const lastOctet = parseInt(r.ip.split('.').pop())
        r.isGateway = lastOctet === 1 || lastOctet === 254
        r.isLocal = r.ip === local.ip || (r.mac && local.mac && r.mac === local.mac)
        r.isRandomized = isRandomizedMAC(r.mac) && !r.isLocal
        r.macEmpty = isEmptyMAC(r.mac)
        r.seenOnly = !!r.seenOnly || !r.alive

        // Hostname resolution
        const ssdp = ssdpByIp[r.ip]
        let { hostname, nameSource } = await resolveHostname(r.ip)
        if (!hostname && ssdp?.friendlyName) {
            hostname = ssdp.friendlyName
            nameSource = 'ssdp'
        }
        r.hostname = hostname
        r.nameSource = nameSource

        // Vendor from local OUI DB, with online fallback for unknown non-randomized MACs
        let { vendor, vendorSource } = await resolveVendor(r.mac, r.isRandomized || r.macEmpty)
        if ((!vendor || vendorSource === 'unknown') && ssdp?.manufacturer) {
            vendor = ssdp.manufacturer
            vendorSource = 'ssdp'
        }
        r.vendor = vendor || null
        r.vendorSource = vendorSource || 'unknown'

        // Role-aware display fallback to reduce Unknown Device labels.
        if (hostname) r.displayName = hostname
        else if (vendor) r.displayName = vendor
        else if (r.isLocal) r.displayName = localHostname || 'This Device'
        else if (r.isGateway) r.displayName = 'Gateway'
        else if (r.isRandomized) r.displayName = 'Network Device'
        else if (r.mac && !r.macEmpty) r.displayName = 'Network Device'
        else r.displayName = null
    }, 8)

    results.sort((a, b) => {
        const av = parseInt((a.ip || '').split('.').pop(), 10)
        const bv = parseInt((b.ip || '').split('.').pop(), 10)
        return (isNaN(av) ? 999 : av) - (isNaN(bv) ? 999 : bv)
    })

    return results
})

ipcMain.handle('lan-upnp-scan', async (_, baseIP, rangeStart, rangeEnd) => {
    baseIP = String(baseIP || '').trim()
    rangeStart = Math.max(1, Math.min(254, parseInt(rangeStart, 10) || 1))
    rangeEnd = Math.max(rangeStart, Math.min(254, parseInt(rangeEnd, 10) || 254))

    const raw = await withTimeout(ssdpDiscover(2600), 3200, {})
    const entries = Object.entries(raw || {}).filter(([ip]) => {
        if (!baseIP) return true
        return ipInRange(ip, baseIP, rangeStart, rangeEnd)
    })

    const devices = await parallelMap(entries, async ([ip, info]) => {
        const location = info?.location || null
        const description = location ? await withTimeout(fetchSsdpDescription(location), 2800, null) : null
        const serviceTypes = Array.isArray(description?.serviceTypes) ? description.serviceTypes : []

        const probeText = [
            String(info?.st || ''),
            String(info?.usn || ''),
            ...serviceTypes,
        ].join(' ').toLowerCase()

        const isIgd = /internetgatewaydevice|wanipconnection|wanpppconnection|urn:schemas-upnp-org:device:internetgatewaydevice/i.test(probeText)
        const isRootDevice = /upnp:rootdevice/i.test(probeText)

        return {
            ip,
            location,
            server: info?.server || null,
            st: info?.st || null,
            usn: info?.usn || null,
            friendlyName: description?.friendlyName || null,
            manufacturer: description?.manufacturer || null,
            modelName: description?.modelName || null,
            serviceTypes,
            isIgd,
            isRootDevice,
        }
    }, 5)

    const gatewayLike = devices.filter(d => d.ip.endsWith('.1') || d.ip.endsWith('.254'))
    const igdDevices = devices.filter(d => d.isIgd)
    const rootDevices = devices.filter(d => d.isRootDevice)

    return {
        ok: true,
        scannedRange: { baseIP, rangeStart, rangeEnd },
        devices,
        summary: {
            ssdpResponders: devices.length,
            igdCount: igdDevices.length,
            rootDeviceCount: rootDevices.length,
            gatewayResponderCount: gatewayLike.length,
            gatewayIgdCount: gatewayLike.filter(d => d.isIgd).length,
        },
        checkedAt: new Date().toISOString(),
    }
})

// ── Speed Test ────────────────────────────────────────
ipcMain.handle('speed-latency', async () => {
    const isWin = process.platform === 'win32'
    const pings = []
    for (const t of ['1.1.1.1', '8.8.8.8', '9.9.9.9']) {
        const { out } = await run(isWin ? `ping -n 5 ${t}` : `ping -c 5 ${t}`, 15000)
        pings.push(...parsePingTimes(out))
    }
    if (!pings.length) return { latency: null, jitter: null }
    const avg = pings.reduce((a, b) => a + b, 0) / pings.length
    const jitter = Math.sqrt(pings.map(p => Math.pow(p - avg, 2)).reduce((a, b) => a + b, 0) / pings.length)
    return { latency: avg.toFixed(1), jitter: jitter.toFixed(1) }
})

ipcMain.handle('speed-download', () => new Promise(resolve => {
    const start = Date.now()
    let bytes = 0
    https.get('https://speed.cloudflare.com/__down?bytes=10000000', res => {
        res.on('data', c => { bytes += c.length })
        res.on('end', () => {
            const t = (Date.now() - start) / 1000
            resolve({ speedMbps: parseFloat(((bytes * 8) / t / 1e6).toFixed(2)), bytes, time: t })
        })
        res.on('error', () => resolve({ error: true }))
    }).on('error', () => resolve({ error: true }))
}))

/* ----------------------------------------------------------
   SPEED TEST - Adaptive multi-CDN engine
   ---------------------------------------------------------- */

const SPEED_SERVERS = [
    {
        id: 'mlab',
        name: 'M-Lab NDT7',
        location: 'Auto - nearest server',
        sponsor: 'Measurement Lab (Google)',
        ndt7: true,
    },
    {
        id: 'cloudflare',
        name: 'Cloudflare',
        location: 'Global CDN (nearest edge)',
        sponsor: 'Cloudflare, Inc.',
        getDownloadUrl: (bytes) => `https://speed.cloudflare.com/__down?bytes=${bytes}`,
        uploadUrl: 'https://speed.cloudflare.com/__up',
        pingUrl: 'https://speed.cloudflare.com/__down?bytes=1',
        variableSize: true,
    },
    {
        id: 'hetzner',
        name: 'Hetzner',
        location: 'Europe - Nuremberg, Germany',
        sponsor: 'Hetzner Online GmbH',
        getDownloadUrl: () => 'https://speed.hetzner.de/100MB.bin',
        uploadUrl: 'https://speed.cloudflare.com/__up',
        pingUrl: 'https://speed.hetzner.de/100MB.bin',
        variableSize: false,
    },
    {
        id: 'ovh',
        name: 'OVH',
        location: 'Europe - Gravelines, France',
        sponsor: 'OVH SAS',
        getDownloadUrl: () => 'https://proof.ovh.net/files/100Mb.dat',
        uploadUrl: 'https://speed.cloudflare.com/__up',
        pingUrl: 'https://proof.ovh.net/files/1Mb.dat',
        variableSize: false,
    },
]

// -- M-Lab NDT7 Protocol -----------------------------------
const NDT7_LOCATE_URL = 'https://locate.measurementlab.net/v2/nearest/ndt/ndt7'
const NDT7_TEST_DURATION = 10000 // 10 seconds per direction

/** Discover nearest M-Lab NDT7 server via Locate API v2 */
function ndt7Locate() {
    return new Promise((resolve, reject) => {
        https.get(NDT7_LOCATE_URL, { headers: { 'Accept': 'application/json' } }, res => {
            let body = ''
            res.on('data', c => { body += c })
            res.on('end', () => {
                try {
                    const data = JSON.parse(body)
                    if (!data.results?.length) return reject(new Error('No NDT7 servers'))
                    const srv = data.results[0]
                    resolve({
                        machine: srv.machine,
                        hostname: srv.hostname || srv.machine,
                        city: srv.location?.city || 'Unknown',
                        country: srv.location?.country || '',
                        downloadUrl: srv.urls['wss:///ndt/v7/download'],
                        uploadUrl: srv.urls['wss:///ndt/v7/upload'],
                    })
                } catch (e) { reject(e) }
            })
            res.on('error', reject)
        }).on('error', reject)
    })
}

/** NDT7 download test via WebSocket */
function ndt7Download(send, downloadUrl) {
    return new Promise((resolve) => {
        const start = Date.now()
        let totalBytes = 0
        let lastReport = start
        let lastBytes = 0
        const samples = []
        let serverMeasurement = null

        const ws = new WsClient(downloadUrl, 'net.measurementlab.ndt.v7', {
            handshakeTimeout: 10000,
        })

        const timeout = setTimeout(() => { ws.close() }, NDT7_TEST_DURATION + 5000)

        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                // Binary = bulk download data
                totalBytes += data.length
                const now = Date.now()
                const dt = now - lastReport
                if (dt >= 150) {
                    const chunkBits = (totalBytes - lastBytes) * 8
                    const instantMbps = parseFloat((chunkBits / (dt / 1000) / 1e6).toFixed(2))
                    samples.push(instantMbps)
                    const recent = samples.slice(-10)
                    const avgMbps = parseFloat((recent.reduce((a, b) => a + b, 0) / recent.length).toFixed(2))
                    const elapsed = (now - start) / 1000
                    const overallMbps = parseFloat(((totalBytes * 8) / Math.max(elapsed, 0.05) / 1e6).toFixed(2))
                    send('speed-progress', {
                        phase: 'downloading',
                        instantSpeed: instantMbps,
                        avgSpeed: avgMbps,
                        overallSpeed: overallMbps,
                        progress: Math.min(99, Math.round((elapsed / (NDT7_TEST_DURATION / 1000)) * 100)),
                        bytesReceived: totalBytes,
                        elapsed,
                    })
                    lastReport = now
                    lastBytes = totalBytes
                }
            } else {
                // Text = JSON measurement from server
                try { serverMeasurement = JSON.parse(data.toString()) } catch { /* noop */ }
            }
        })

        ws.on('close', () => {
            clearTimeout(timeout)
            const elapsed = Math.max((Date.now() - start) / 1000, 0.1)
            // Prefer server-side measurement if available
            let speedMbps
            if (serverMeasurement?.TCPInfo?.BytesReceived) {
                // Server reports bytes it sent - more accurate
                speedMbps = parseFloat(((totalBytes * 8) / elapsed / 1e6).toFixed(2))
            } else {
                speedMbps = parseFloat(((totalBytes * 8) / elapsed / 1e6).toFixed(2))
            }
            resolve({ speedMbps, bytes: totalBytes, time: elapsed })
        })

        ws.on('error', () => {
            clearTimeout(timeout)
            const elapsed = Math.max((Date.now() - start) / 1000, 0.1)
            if (totalBytes > 0) {
                const speedMbps = parseFloat(((totalBytes * 8) / elapsed / 1e6).toFixed(2))
                resolve({ speedMbps, bytes: totalBytes, time: elapsed })
            } else {
                resolve({ speedMbps: 0, bytes: 0, time: elapsed, error: true })
            }
        })
    })
}

/** NDT7 upload test via WebSocket */
function ndt7Upload(send, uploadUrl) {
    return new Promise((resolve) => {
        const start = Date.now()
        let totalSent = 0
        let lastReport = start
        let lastBytes = 0
        const samples = []
        const CHUNK = 64 * 1024 // 64 KB chunks
        const buf = Buffer.alloc(CHUNK, 0x41)

        const ws = new WsClient(uploadUrl, 'net.measurementlab.ndt.v7', {
            handshakeTimeout: 10000,
        })

        let uploading = false
        const endTime = Date.now() + NDT7_TEST_DURATION

        ws.on('open', () => {
            uploading = true
            pump()
        })

        function pump() {
            if (!uploading || Date.now() >= endTime) {
                ws.close()
                return
            }
            // Send data as fast as the socket allows
            while (uploading && ws.bufferedAmount < 7 * 1024 * 1024) {
                ws.send(buf, { binary: true }, () => {})
                totalSent += buf.length

                const now = Date.now()
                if (now >= endTime) { uploading = false; ws.close(); return }
                const dt = now - lastReport
                if (dt >= 150) {
                    const chunkBits = (totalSent - lastBytes) * 8
                    const instantMbps = parseFloat((chunkBits / (dt / 1000) / 1e6).toFixed(2))
                    samples.push(instantMbps)
                    const recent = samples.slice(-10)
                    const avgMbps = parseFloat((recent.reduce((a, b) => a + b, 0) / recent.length).toFixed(2))
                    const elapsed = (now - start) / 1000
                    const overallMbps = parseFloat(((totalSent * 8) / Math.max(elapsed, 0.05) / 1e6).toFixed(2))
                    send('speed-progress', {
                        phase: 'uploading',
                        instantSpeed: instantMbps,
                        avgSpeed: avgMbps,
                        overallSpeed: overallMbps,
                        progress: Math.min(99, Math.round((elapsed / (NDT7_TEST_DURATION / 1000)) * 100)),
                        bytesSent: totalSent,
                        elapsed,
                    })
                    lastReport = now
                    lastBytes = totalSent
                }
            }
            // If buffer is full, wait for drain
            if (uploading) setTimeout(pump, 10)
        }

        ws.on('message', () => {}) // Server sends measurements, we just track our own

        ws.on('close', () => {
            uploading = false
            const elapsed = Math.max((Date.now() - start) / 1000, 0.1)
            const speedMbps = parseFloat(((totalSent * 8) / elapsed / 1e6).toFixed(2))
            resolve({ speedMbps, bytes: totalSent, time: elapsed })
        })

        ws.on('error', () => {
            uploading = false
            const elapsed = Math.max((Date.now() - start) / 1000, 0.1)
            if (totalSent > 0) {
                const speedMbps = parseFloat(((totalSent * 8) / elapsed / 1e6).toFixed(2))
                resolve({ speedMbps, bytes: totalSent, time: elapsed })
            } else {
                resolve({ speedMbps: 0, bytes: 0, time: elapsed, error: true })
            }
        })
    })
}

/** Full NDT7 speed test flow (uses WebSocket protocol, no calibration needed) */
async function runNdt7Test(send) {
    // Discover server
    send('speed-progress', { phase: 'init', message: 'Discovering M-Lab server...' })
    let located
    try {
        located = await ndt7Locate()
    } catch (e) {
        send('speed-progress', { phase: 'error', message: 'Could not find M-Lab server' })
        return { error: 'M-Lab locate failed: ' + e.message }
    }

    const SERVER_INFO = {
        name: 'M-Lab NDT7',
        location: `${located.city}, ${located.country}`,
        host: located.machine,
        sponsor: 'Measurement Lab (Google)',
    }

    // Latency - TCP connect to port 443 on the NDT hostname
    const pings = []
    const pingTarget = located.hostname
    for (let i = 0; i < 5; i++) {
        const t0 = Date.now()
        await new Promise(r => {
            const sock = net.createConnection({ host: pingTarget, port: 443, timeout: 3000 }, () => {
                sock.destroy()
                r()
            })
            sock.on('error', () => { sock.destroy(); r() })
            sock.on('timeout', () => { sock.destroy(); r() })
        })
        const ms = Date.now() - t0
        if (ms < 3000) pings.push(ms)
    }
    const latency = pings.length ? parseFloat((pings.reduce((a, b) => a + b, 0) / pings.length).toFixed(1)) : null
    const jitter = pings.length > 1
        ? parseFloat(Math.sqrt(pings.map(p => Math.pow(p - latency, 2)).reduce((a, b) => a + b, 0) / pings.length).toFixed(1))
        : null

    send('speed-progress', { phase: 'latency', latency, jitter, server: SERVER_INFO })

    // No calibration needed for NDT7 - the protocol auto-adjusts
    send('speed-progress', { phase: 'calibrating', message: 'NDT7 protocol - adaptive' })
    send('speed-progress', { phase: 'calibrated', probeSpeed: null, dlTarget: 0, ulTarget: 0 })

    // Download via WebSocket
    send('speed-progress', { phase: 'download-start' })
    const dlResult = await ndt7Download(send, located.downloadUrl)
    if (dlResult.error) {
        send('speed-progress', { phase: 'error', message: 'NDT7 download failed' })
        return { error: 'NDT7 download failed' }
    }
    send('speed-progress', { phase: 'download-done', speed: dlResult.speedMbps })

    await new Promise(r => setTimeout(r, 600))

    // Upload via WebSocket
    send('speed-progress', { phase: 'upload-start' })
    const ulResult = await ndt7Upload(send, located.uploadUrl)
    send('speed-progress', { phase: 'upload-done', speed: ulResult.speedMbps })

    const result = {
        server: SERVER_INFO,
        latency, jitter,
        download: dlResult.speedMbps,
        upload: ulResult.speedMbps,
        dlBytes: dlResult.bytes,
        ulBytes: ulResult.bytes,
        dlTime: dlResult.time,
        ulTime: ulResult.time,
    }
    send('speed-progress', { phase: 'done', result })
    return result
}

function getSpeedServer(id) {
    return SPEED_SERVERS.find(s => s.id === id) || SPEED_SERVERS[0]
}

/** Return available servers list to renderer */
ipcMain.handle('speed-get-servers', () =>
    SPEED_SERVERS.map(s => ({ id: s.id, name: s.name, location: s.location, sponsor: s.sponsor }))
)

/** Calibration probe - downloads a small amount for ~3 s to estimate speed */
function runCalibrationProbe(server) {
    return new Promise(resolve => {
        const PROBE_BYTES = 4 * 1024 * 1024      // 4 MB probe
        const MAX_PROBE_MS = 5000                 // 5 s max
        const WARMUP_BYTES = 256 * 1024           // discard first 256 KB (TCP ramp-up)
        const url = server.variableSize
            ? server.getDownloadUrl(PROBE_BYTES)
            : server.getDownloadUrl(PROBE_BYTES)

        const start = Date.now()
        let received = 0
        let measuredBytes = 0
        let measureStart = 0                      // set after warmup
        let done = false

        const finish = () => {
            if (done) return
            done = true
            req.destroy()
            // Use only post-warmup data for speed estimate
            const elapsed = measureStart > 0
                ? Math.max((Date.now() - measureStart) / 1000, 0.05)
                : Math.max((Date.now() - start) / 1000, 0.05)
            const bytes = measureStart > 0 ? measuredBytes : received
            const speedMbps = parseFloat(((bytes * 8) / elapsed / 1e6).toFixed(2))
            resolve({ speedMbps, bytes: received, time: (Date.now() - start) / 1000 })
        }

        const req = https.get(url, res => {
            if (res.statusCode >= 300) { res.resume(); return finish() }
            res.on('data', chunk => {
                received += chunk.length
                // Start measuring after warmup period
                if (measureStart === 0 && received >= WARMUP_BYTES) {
                    measureStart = Date.now()
                    measuredBytes = 0
                } else if (measureStart > 0) {
                    measuredBytes += chunk.length
                }
                if (!server.variableSize && received >= PROBE_BYTES) finish()
            })
            res.on('end', finish)
            res.on('error', finish)
        })
        req.on('error', finish)
        req.setTimeout(MAX_PROBE_MS + 1000, finish)
        setTimeout(finish, MAX_PROBE_MS)
    })
}

/** Calculate optimal download size based on probe speed.
 *  Uses 0.6x safety factor since probe may overestimate. */
function calcDownloadBytes(probeMbps) {
    const safeMbps = probeMbps * 0.6             // conservative estimate
    const bytesPerSec = (safeMbps * 1e6) / 8
    const target = Math.round(bytesPerSec * 8)   // ~8 s of data
    return Math.max(5 * 1024 * 1024, Math.min(target, 80 * 1024 * 1024))
}

/** Calculate optimal upload size based on download speed.
 *  Upload is typically 30-50% of download. */
function calcUploadBytes(dlMbps) {
    const estUpMbps = dlMbps * 0.4               // conservative
    const bytesPerSec = (estUpMbps * 1e6) / 8
    const target = Math.round(bytesPerSec * 7)   // ~7 s of data
    return Math.max(2 * 1024 * 1024, Math.min(target, 40 * 1024 * 1024))
}

/** Streaming speed test - adaptive, multi-CDN */
ipcMain.handle('speed-test-full', async (event, serverId) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return { error: 'No window' }
    const send = (ch, data) => { try { win.webContents.send(ch, data) } catch { /* noop */ } }

    const server = getSpeedServer(serverId)

    // -- NDT7 branch: entirely different protocol --
    if (server.ndt7) return runNdt7Test(send)

    const SERVER_INFO = { name: server.name, location: server.location, host: server.id, sponsor: server.sponsor }

    // Phase 0: Init & Latency
    send('speed-progress', { phase: 'init', message: 'Finding best server...' })

    const serverPings = []
    const pingUrl = server.pingUrl || server.getDownloadUrl(1)
    for (let i = 0; i < 5; i++) {
        const t0 = Date.now()
        await new Promise(r => {
            const req = https.get(pingUrl, res => { res.resume(); res.on('end', r) })
            req.on('error', r)
            req.setTimeout(3000, () => { req.destroy(); r() })
        })
        const elapsed = Date.now() - t0
        if (elapsed < 3000) serverPings.push(elapsed)
    }
    const svrLatency = serverPings.length
        ? parseFloat((serverPings.reduce((a, b) => a + b, 0) / serverPings.length).toFixed(1))
        : null
    const svrJitter = serverPings.length > 1
        ? parseFloat(Math.sqrt(serverPings.map(p => Math.pow(p - svrLatency, 2)).reduce((a, b) => a + b, 0) / serverPings.length).toFixed(1))
        : null

    send('speed-progress', { phase: 'latency', latency: svrLatency, jitter: svrJitter, server: SERVER_INFO })

    // Phase 1: Calibration probe
    send('speed-progress', { phase: 'calibrating', message: 'Calibrating...' })
    const probe = await runCalibrationProbe(server)
    const probeMbps = Math.max(probe.speedMbps, 1)

    const dlTargetBytes = calcDownloadBytes(probeMbps)
    const ulTargetBytes = calcUploadBytes(probeMbps)
    send('speed-progress', {
        phase: 'calibrated',
        probeSpeed: probeMbps,
        dlTarget: dlTargetBytes,
        ulTarget: ulTargetBytes,
    })

    // Phase 2: Download
    send('speed-progress', { phase: 'download-start' })
    const dlResult = await runDownloadTest(send, server, dlTargetBytes)
    if (dlResult.error) {
        send('speed-progress', { phase: 'error', message: 'Download test failed' })
        return { error: 'Download failed' }
    }
    send('speed-progress', { phase: 'download-done', speed: dlResult.speedMbps })

    const smartUlBytes = calcUploadBytes(dlResult.speedMbps)
    await new Promise(r => setTimeout(r, 600))

    // Phase 3: Upload
    send('speed-progress', { phase: 'upload-start' })
    const ulResult = await runUploadTest(send, server, smartUlBytes)
    send('speed-progress', { phase: 'upload-done', speed: ulResult.speedMbps })

    // Done
    const result = {
        server: SERVER_INFO,
        latency: svrLatency,
        jitter: svrJitter,
        download: dlResult.speedMbps,
        upload: ulResult.speedMbps,
        dlBytes: dlResult.bytes,
        ulBytes: ulResult.bytes,
        dlTime: dlResult.time,
        ulTime: ulResult.time,
    }
    send('speed-progress', { phase: 'done', result })
    return result
})

/** Adaptive download test with live progress */
function runDownloadTest(send, server, targetBytes) {
    return new Promise(resolve => {
        const url = server.variableSize
            ? server.getDownloadUrl(targetBytes)
            : server.getDownloadUrl(targetBytes)

        const WARMUP = 128 * 1024 // discard first 128 KB from final calc
        const start = Date.now()
        let totalBytes = 0
        let measureStart = 0
        let measuredBytes = 0
        let lastReport = start
        let lastBytes = 0
        let done = false
        const samples = []

        const finish = () => {
            if (done) return
            done = true
            req.destroy()
            // Use post-warmup measurement for accuracy
            const elapsed = measureStart > 0
                ? Math.max((Date.now() - measureStart) / 1000, 0.05)
                : Math.max((Date.now() - start) / 1000, 0.05)
            const bytes = measureStart > 0 ? measuredBytes : totalBytes
            const speedMbps = parseFloat(((bytes * 8) / elapsed / 1e6).toFixed(2))
            resolve({ speedMbps, bytes: totalBytes, time: (Date.now() - start) / 1000 })
        }

        const req = https.get(url, res => {
            if (res.statusCode >= 300) { res.resume(); return finish() }

            res.on('data', chunk => {
                totalBytes += chunk.length

                // Track warmup
                if (measureStart === 0 && totalBytes >= WARMUP) {
                    measureStart = Date.now()
                    measuredBytes = 0
                } else if (measureStart > 0) {
                    measuredBytes += chunk.length
                }

                const now = Date.now()
                const dt = now - lastReport

                if (dt >= 150) {
                    const chunkBits = (totalBytes - lastBytes) * 8
                    const instantMbps = parseFloat((chunkBits / (dt / 1000) / 1e6).toFixed(2))
                    samples.push(instantMbps)
                    const recent = samples.slice(-10)
                    const avgMbps = parseFloat((recent.reduce((a, b) => a + b, 0) / recent.length).toFixed(2))
                    const measuredElapsed = measureStart > 0
                        ? Math.max((now - measureStart) / 1000, 0.05)
                        : Math.max((now - start) / 1000, 0.05)
                    const measuredNowBytes = measureStart > 0 ? measuredBytes : totalBytes
                    const overallMbps = parseFloat(((measuredNowBytes * 8) / measuredElapsed / 1e6).toFixed(2))

                    send('speed-progress', {
                        phase: 'downloading',
                        instantSpeed: instantMbps,
                        avgSpeed: avgMbps,
                        overallSpeed: overallMbps,
                        progress: Math.min(99, Math.round((totalBytes / targetBytes) * 100)),
                        bytesReceived: totalBytes,
                        elapsed: (now - start) / 1000,
                    })
                    lastReport = now
                    lastBytes = totalBytes
                }

                if (!server.variableSize && totalBytes >= targetBytes) finish()
            })
            res.on('end', finish)
            res.on('error', () => { if (!done) resolve({ error: true }) })
        })
        req.on('error', () => { if (!done) resolve({ error: true }) })
        req.setTimeout(45000, () => { req.destroy(); if (!done) resolve({ error: true }) })
    })
}

/** Adaptive upload test with live progress */
function runUploadTest(send, server, targetBytes) {
    return new Promise(resolve => {
        const payload = Buffer.alloc(targetBytes, 0x41)
        const start = Date.now()
        let bytesSent = 0
        let lastReport = start
        let lastBytes = 0
        const samples = []

        const uploadUrl = new URL(server.uploadUrl)
        const options = {
            hostname: uploadUrl.hostname,
            path: uploadUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': targetBytes,
            },
            timeout: 45000,
        }

        const req = https.request(options, res => {
            res.resume()
            res.on('end', () => {
                const elapsed = Math.max((Date.now() - start) / 1000, 0.05)
                const speedMbps = parseFloat(((targetBytes * 8) / elapsed / 1e6).toFixed(2))
                resolve({ speedMbps, bytes: targetBytes, time: elapsed })
            })
        })
        req.on('error', () => {
            const elapsed = Math.max((Date.now() - start) / 1000, 0.05)
            if (bytesSent > targetBytes * 0.5) {
                const speedMbps = parseFloat(((bytesSent * 8) / elapsed / 1e6).toFixed(2))
                resolve({ speedMbps, bytes: bytesSent, time: elapsed })
            } else {
                resolve({ speedMbps: 0, bytes: bytesSent, time: elapsed, error: true })
            }
        })
        req.setTimeout(45000, () => { req.destroy() })

        const CHUNK = 64 * 1024
        let offset = 0

        function writeNext() {
            let ok = true
            while (ok && offset < targetBytes) {
                const end = Math.min(offset + CHUNK, targetBytes)
                const chunk = payload.slice(offset, end)
                offset = end
                bytesSent = end

                const now = Date.now()
                const dt = now - lastReport
                if (dt >= 150) {
                    const chunkBits = (bytesSent - lastBytes) * 8
                    const instantMbps = parseFloat((chunkBits / (dt / 1000) / 1e6).toFixed(2))
                    samples.push(instantMbps)
                    const recent = samples.slice(-10)
                    const avgMbps = parseFloat((recent.reduce((a, b) => a + b, 0) / recent.length).toFixed(2))
                    const elapsed = Math.max((now - start) / 1000, 0.05)
                    const overallMbps = parseFloat(((bytesSent * 8) / elapsed / 1e6).toFixed(2))

                    send('speed-progress', {
                        phase: 'uploading',
                        instantSpeed: instantMbps,
                        avgSpeed: avgMbps,
                        overallSpeed: overallMbps,
                        progress: Math.min(99, Math.round((bytesSent / targetBytes) * 100)),
                        bytesSent,
                        elapsed,
                    })
                    lastReport = now
                    lastBytes = bytesSent
                }

                if (offset >= targetBytes) {
                    req.end(chunk)
                    return
                }

                ok = req.write(chunk)
            }
            if (!ok) req.once('drain', writeNext)
        }
        writeNext()
    })
}


// ── SSL Certificate Checker ───────────────────────────
ipcMain.handle('ssl-check', (_, rawHost, port = 443) => new Promise(resolve => {
    const host = sanitizeHost(rawHost)
    if (!host) return resolve({ error: 'Invalid host' })
    const start = Date.now()
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 8000 }, () => {
        const cert = socket.getPeerCertificate(true)
        socket.destroy()
        if (!cert || !cert.subject) return resolve({ error: 'No certificate returned' })
        const now = Date.now()
        const validTo = new Date(cert.valid_to)
        const daysLeft = Math.floor((validTo - now) / 86400000)
        resolve({
            subject: cert.subject?.CN || cert.subject?.O || '—',
            issuer: cert.issuer?.O || cert.issuer?.CN || '—',
            validFrom: cert.valid_from,
            validTo: cert.valid_to,
            daysLeft,
            expired: daysLeft < 0,
            san: cert.subjectaltname || '—',
            fingerprint: cert.fingerprint || '—',
            protocol: socket.getProtocol?.() || '—',
            time: Date.now() - start,
        })
    })
    socket.on('error', err => resolve({ error: err.message, time: Date.now() - start }))
    socket.setTimeout(8000, () => { socket.destroy(); resolve({ error: 'timeout' }) })
}))

// ── Whois Lookup ──────────────────────────────────────
ipcMain.handle('whois', (_, rawQuery) => new Promise(resolve => {
    const query = sanitizeHost(rawQuery)
    if (!query) return resolve({ error: 'Invalid query' })
    const socket = new net.Socket()
    let data = ''
    socket.setTimeout(10000)
    socket.connect(43, 'whois.iana.org', () => { socket.write(query + '\r\n') })
    socket.on('data', d => { data += d.toString() })
    socket.on('end', () => {
        // If IANA refers to another whois server, follow it
        const refer = data.match(/refer:\s+(\S+)/i)
        if (refer) {
            let data2 = ''
            const s2 = new net.Socket()
            s2.setTimeout(10000)
            s2.connect(43, refer[1], () => { s2.write(query + '\r\n') })
            s2.on('data', d => { data2 += d.toString() })
            s2.on('end', () => resolve({ raw: data2, server: refer[1] }))
            s2.on('error', () => resolve({ raw: data, server: 'whois.iana.org' }))
            s2.on('timeout', () => { s2.destroy(); resolve({ raw: data + data2, server: refer[1] }) })
        } else {
            resolve({ raw: data, server: 'whois.iana.org' })
        }
    })
    socket.on('error', err => resolve({ error: err.message }))
    socket.on('timeout', () => { socket.destroy(); resolve({ error: 'timeout', raw: data }) })
}))

// ── Wake-on-LAN ───────────────────────────────────────
ipcMain.handle('wake-on-lan', (_, mac, broadcast = '255.255.255.255', wol_port = 9) => new Promise(resolve => {
    const cleanMac = mac.replace(/[:-]/g, '').toLowerCase()
    if (cleanMac.length !== 12) return resolve({ error: 'Invalid MAC address' })
    const macBytes = Buffer.from(cleanMac, 'hex')
    const magic = Buffer.alloc(102)
    // 6 bytes of 0xFF
    magic.fill(0xff, 0, 6)
    // MAC repeated 16 times
    for (let i = 0; i < 16; i++) macBytes.copy(magic, 6 + i * 6)
    const socket = dgram.createSocket('udp4')
    socket.once('listening', () => socket.setBroadcast(true))
    socket.bind(() => {
        socket.send(magic, 0, magic.length, parseInt(wol_port), broadcast, err => {
            socket.close()
            err ? resolve({ error: err.message }) : resolve({ success: true, mac, broadcast })
        })
    })
}))

// ═══════════════════════════════════════════════════════
//   STREAMING IPC HANDLERS (spawn → event.sender.send)
// ═══════════════════════════════════════════════════════

// ── Input sanitization helper ─────────────────────────
function sanitizeHost(raw) {
    if (raw == null) return ''

    let host = String(raw).trim()
    if (!host) return ''

    host = host.replace(/^[a-z]+:\/\//i, '')
    host = host.split(/[/?#]/)[0].trim()

    if (host.startsWith('[') && host.includes(']')) {
        host = host.slice(1, host.indexOf(']'))
    } else if (host.includes(':')) {
        const parts = host.split(':')
        if (parts.length === 2 && /^\d+$/.test(parts[1])) host = parts[0]
    }

    host = host.replace(/\.$/, '').trim()
    if (!host) return ''

    if (isValidIPv4(host) || isValidHostname(host)) return host
    return ''
}

function isValidIPv4(host) {
    const parts = String(host).split('.')
    if (parts.length !== 4) return false
    return parts.every(part => {
        if (!/^\d+$/.test(part)) return false
        const n = Number.parseInt(part, 10)
        return n >= 0 && n <= 255
    })
}

function isValidHostname(host) {
    const value = String(host)
    if (!/^[A-Za-z0-9.-]+$/.test(value)) return false
    if (value.length < 1 || value.length > 253) return false
    if (value.includes('..')) return false
    const labels = value.split('.')
    return labels.every(label =>
        label.length > 0
        && label.length <= 63
        && /^[A-Za-z0-9-]+$/.test(label)
        && !label.startsWith('-')
        && !label.endsWith('-')
    )
}

// ── Live Traceroute ───────────────────────────────────
ipcMain.on('start-traceroute', (event, rawHost) => {
    const host = sanitizeHost(rawHost)
    if (!host) { event.sender.send('traceroute:done'); return }
    const isWin = process.platform === 'win32'
    // -4 forces IPv4 so we always get dotted IPs (systems with IPv6 default to v6)
    const cmd = isWin ? 'tracert' : 'traceroute'
    const args = isWin
        ? ['-4', '-d', '-h', '30', '-w', '2000', host]
        : ['-4', '-m', '30', '-n', '-q', '1', host]
    const proc = spawn(cmd, args, { shell: false, windowsHide: true })
    let buffer = ''
    const seenHops = new Set()

    function parseHopLine(line) {
        if (!line) return null
        // Match hop lines: "  1    <1 ms    <1 ms    <1 ms  192.168.1.1"
        // Or: "  3     *        *        *     Tiempo de espera..."
        const hopMatch = line.match(/^\s*(\d{1,2})\s+(.+)/)
        if (!hopMatch) return null
        const hop = parseInt(hopMatch[1])
        if (hop < 1 || hop > 30 || seenHops.has(hop)) return null
        seenHops.add(hop)
        const rest = hopMatch[2]
        // Extract IP — IPv4 first, then IPv6 fallback
        const ipv4 = rest.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)
        const ipv6 = !ipv4 && rest.match(/([0-9a-fA-F:]{6,39})/)
        const ip = ipv4 ? ipv4[1] : ipv6 ? ipv6[1] : '*'
        // Extract times — match "<1 ms", "8 ms", "12ms", etc.
        const times = []
        const timeRe = /<?\s*(\d+)\s*ms/gi
        let tm
        while ((tm = timeRe.exec(rest)) !== null) times.push(parseInt(tm[1]))
        const avg = times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : null
        return { hop, ip, times, avg }
    }

    proc.stdout.on('data', data => {
        buffer += data.toString() // default utf8
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() // keep incomplete line
        for (const raw of lines) {
            const parsed = parseHopLine(raw.trim())
            if (parsed && !event.sender.isDestroyed()) {
                event.sender.send('traceroute:hop', parsed)
            }
        }
    })

    // Some Windows locales send output to stderr
    proc.stderr.on('data', data => {
        buffer += data.toString()
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop()
        for (const raw of lines) {
            const parsed = parseHopLine(raw.trim())
            if (parsed && !event.sender.isDestroyed()) {
                event.sender.send('traceroute:hop', parsed)
            }
        }
    })

    proc.on('close', () => {
        // Flush remaining buffer
        const parsed = parseHopLine((buffer || '').trim())
        if (parsed && !event.sender.isDestroyed()) {
            event.sender.send('traceroute:hop', parsed)
        }
        if (!event.sender.isDestroyed()) event.sender.send('traceroute:done')
    })
    proc.on('error', () => {
        if (!event.sender.isDestroyed()) event.sender.send('traceroute:done')
    })
})

// ── Live Ping (per-packet) ────────────────────────────
ipcMain.on('start-ping-live', (event, rawHost, count = 10) => {
    const host = sanitizeHost(rawHost)
    if (!host) { event.sender.send('ping:done', { seqNum: 0 }); return }
    const isWin = process.platform === 'win32'
    const cmd = isWin ? 'ping' : 'ping'
    const args = isWin
        ? ['-4', '-n', String(count), host]
        : ['-c', String(count), host]
    const proc = spawn(cmd, args, { shell: false, windowsHide: true })
    let seqNum = 0
    let buffer = ''

    proc.stdout.on('data', data => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() // keep incomplete line
        for (const line of lines) {
            const m = line.match(PING_TIME_RE)
            if (m) {
                seqNum++
                const timeoutLine = line.toLowerCase().includes('timeout') || line.includes('*')
                if (!event.sender.isDestroyed()) {
                    event.sender.send('ping:reply', {
                        seq: seqNum,
                        time: timeoutLine ? null : parseFloat(m[1]),
                        raw: line.trim(),
                        timeout: timeoutLine,
                    })
                }
            } else if (line.toLowerCase().includes('timeout') || line.includes('Tiempo de espera')) {
                seqNum++
                if (!event.sender.isDestroyed()) {
                    event.sender.send('ping:reply', { seq: seqNum, time: null, raw: line.trim(), timeout: true })
                }
            }
        }
    })

    proc.on('close', () => {
        if (!event.sender.isDestroyed()) event.sender.send('ping:done', { seqNum })
    })
    proc.on('error', () => {
        if (!event.sender.isDestroyed()) event.sender.send('ping:done', { seqNum })
    })
})

// ── MTR (live per-hop ping) ───────────────────────────
const mtrSessions = new Map()

ipcMain.on('start-mtr', (event, rawHost, intervalMs = 1000) => {
    const host = sanitizeHost(rawHost)
    if (!host) {
        if (!event.sender.isDestroyed()) event.sender.send('mtr:done')
        return
    }

    const safeIntervalMs = Number.isInteger(intervalMs) ? Math.max(500, Math.min(intervalMs, 5000)) : 1000
    const hops = new Map()
    let mtrRunning = true

    // First do a traceroute to get hops, then ping each continuously
    const isWin = process.platform === 'win32'
    runProgram(
        isWin ? 'tracert' : 'traceroute',
        isWin ? ['-4', '-d', '-h', '20', host] : ['-4', '-m', '20', '-n', host],
        30000
    ).then(({ out }) => {
        const hopIPs = []
        out.split('\n').forEach(line => {
            const winMatch = line.match(/^\s*(\d+)\s+([\s\S]+)$/)
            if (!winMatch) return
            const hop = parseInt(winMatch[1])
            if (hop < 1 || hop > 30) return
            const ipv4 = winMatch[2].match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)
            const ipv6 = !ipv4 && winMatch[2].match(/([0-9a-fA-F:]{6,39})/)
            const foundIP = ipv4 ? ipv4[1] : ipv6 ? ipv6[1] : null
            if (foundIP) hopIPs[hop - 1] = { hop, ip: foundIP }
        })

        // Add destination if not already present
        if (!hopIPs.find(h => h && h.ip === host)) hopIPs.push({ hop: hopIPs.length + 1, ip: host })

        // Initialize hop stats
        hopIPs.filter(Boolean).forEach(({ hop, ip }) => {
            hops.set(hop, { hop, ip, sent: 0, lost: 0, times: [], min: Infinity, max: 0, avg: null })
        })

        // Send initial hop list
        if (!event.sender.isDestroyed()) {
            event.sender.send('mtr:hops', [...hops.values()])
        }

        // Ping each hop continuously
            const pingHop = async () => {
                if (!mtrRunning || event.sender.isDestroyed()) return

                await Promise.all([...hops.entries()].map(async ([, hopData]) => {
                    const args = isWin
                        ? ['-4', '-n', '1', '-w', '1000', hopData.ip]
                        : ['-c', '1', '-W', '1', hopData.ip]
                    const { out } = await runProgram('ping', args, 2500)
                    const m = out.match(PING_TIME_RE)
                    const time = m ? parseFloat(m[1]) : null
                    hopData.sent++
                if (time == null) {
                    hopData.lost++
                } else {
                    hopData.times.push(time)
                    if (time < hopData.min) hopData.min = time
                    if (time > hopData.max) hopData.max = time
                    hopData.avg = (hopData.times.reduce((a, b) => a + b, 0) / hopData.times.length).toFixed(1)
                }
                hopData.loss = ((hopData.lost / hopData.sent) * 100).toFixed(0)
            }))

                if (!event.sender.isDestroyed()) {
                    event.sender.send('mtr:update', [...hops.values()])
                }

                if (mtrRunning && !event.sender.isDestroyed()) {
                    setTimeout(pingHop, safeIntervalMs)
                }
            }

        pingHop()
    })

    // Stop handler
    const sessionId = `${host}-${Date.now()}`
    mtrSessions.set(sessionId, () => { mtrRunning = false })
    if (!event.sender.isDestroyed()) event.sender.send('mtr:session', sessionId)
})

ipcMain.on('stop-mtr', (event, sessionId) => {
    const stopper = mtrSessions.get(sessionId)
    if (stopper) { stopper(); mtrSessions.delete(sessionId) }
})

// ======================================================
//   PERSISTENCE - SQLite (via electron/database.js)
// ======================================================

// General history
ipcMain.handle('history-get', () => database.historyGetAll())
ipcMain.handle('history-add', (_, entry) => database.historyAdd(entry))
ipcMain.handle('history-clear', () => database.historyClear())

// Speed-test history
ipcMain.handle('speed-history-get', () => database.speedHistoryGetAll())
ipcMain.handle('speed-history-add', (_, entry) => database.speedHistoryAdd(entry))
ipcMain.handle('speed-history-clear', () => database.speedHistoryClear())

// LAN-check report history
ipcMain.handle('lan-check-history-get', () => database.lanCheckHistoryGetAll())
ipcMain.handle('lan-check-history-add', (_, entry) => database.lanCheckHistoryAdd(entry))
ipcMain.handle('lan-check-history-delete', (_, id) => database.lanCheckHistoryDelete(id))
ipcMain.handle('lan-check-history-clear', () => database.lanCheckHistoryClear())

// Config (key/value)
ipcMain.handle('config-get', (_, key) => database.configGet(key))
ipcMain.handle('config-set', (_, key, value) => { database.configSet(key, value); return true })
ipcMain.handle('config-get-all', () => database.configGetAll())
ipcMain.handle('config-delete', (_, key) => { database.configDelete(key); return true })

// ======================================================
//   WAN PROBE - HTTP proxy for remote probe service
// ======================================================
ipcMain.handle('wan-probe-request', async (_, opts) => {
    const { url, method = 'GET', headers = {}, body = null } = opts || {}
    const isHttps = url.startsWith('https')
    const lib = isHttps ? require('https') : require('http')
    const parsed = new URL(url)

    return new Promise(resolve => {
        const reqOpts = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method,
            headers,
            timeout: 15000,
            rejectUnauthorized: false, // probe may use self-signed cert
        }
        const req = lib.request(reqOpts, res => {
            let data = ''
            res.on('data', chunk => { data += chunk })
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, statusText: res.statusMessage, data: JSON.parse(data) })
                } catch {
                    resolve({ status: res.statusCode, statusText: res.statusMessage, data })
                }
            })
        })
        req.on('error', err => resolve({ error: err.message }))
        req.on('timeout', () => { req.destroy(); resolve({ error: 'Request timed out' }) })
        if (body) req.write(body)
        req.end()
    })
})




