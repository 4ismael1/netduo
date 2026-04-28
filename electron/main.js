const { app, BrowserWindow, ipcMain, nativeTheme, session, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { exec, execFile, spawn } = require('child_process')
const validators = require('./validators')
const { filterGhosts } = require('./scanner/ghostFilter')
const { PING_TIME_RE, isPingReply } = require('./scanner/pingOutput')
const {
    normalizeNeighborState,
    normalizeNetshNeighborState,
    isUsableNeighborState,
    shouldRetryNeighbor,
    mergeNeighborEntry,
} = require('./scanner/neighborPresence')
const os = require('os')
const dns = require('dns')
const net = require('net')
const tls = require('tls')
const dgram = require('dgram')
const https = require('https')
const http = require('http')
const WsClient = require('ws')
const database = require('./database')
const reports = require('./reports')

// Use Electron packaging state instead of NODE_ENV.
// In installed builds NODE_ENV is often undefined, and relying on it can
// incorrectly force dev-mode URL loading (localhost:5173).
const isDev = !app.isPackaged
const appIconPath = path.join(__dirname, 'assets', 'icon.ico')
const startupLogName = 'netduo-startup.log'

// Stability fallback for GPUs/drivers that can cause blank renderer windows.
app.disableHardwareAcceleration()

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function appendStartupLog(message) {
    try {
        const line = `[${new Date().toISOString()}] ${message}\n`
        const userDataPath = app.getPath('userData')
        fs.appendFileSync(path.join(userDataPath, startupLogName), line, 'utf8')
    } catch {
        // keep silent, logging must never crash startup
    }
}

function renderBootErrorHtml(title, details = '') {
    const safeTitle = escapeHtml(title || 'NetDuo startup error')
    const safeDetails = escapeHtml(details).replace(/\n/g, '<br>')
    return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>NetDuo Startup Error</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #050507;
      color: #e2e8f0;
      font-family: "Segoe UI", Roboto, Arial, sans-serif;
    }
    .card {
      width: min(760px, 92vw);
      border: 1px solid #334155;
      border-radius: 14px;
      padding: 22px;
      background: #0b1220;
      box-shadow: 0 10px 30px rgba(0,0,0,.35);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 20px;
      color: #f8fafc;
    }
    p { margin: 0 0 8px; color: #94a3b8; line-height: 1.55; }
    .detail {
      margin-top: 12px;
      border: 1px solid #1e293b;
      border-radius: 10px;
      background: #020617;
      padding: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: #f8fafc;
      font-size: 12px;
      line-height: 1.45;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <section class="card">
    <h1>${safeTitle}</h1>
    <p>NetDuo could not load the renderer correctly.</p>
    <p>Check the startup log in your user profile for details.</p>
    <div class="detail">${safeDetails || 'No additional details.'}</div>
  </section>
</body>
</html>`
}

function showBootErrorPage(win, title, details) {
    if (!win || win.isDestroyed()) return
    const html = renderBootErrorHtml(title, details)
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    win.loadURL(dataUrl).catch((error) => {
        appendStartupLog(`Failed to show boot error page: ${error?.message || String(error)}`)
    })
    if (!win.isVisible()) win.show()
}
// ─── Helpers ──────────────────────────────────────────────────────────────
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

function replaceDisallowedAscii(text) {
    let output = ''
    for (const char of String(text || '')) {
        const code = char.charCodeAt(0)
        const allowed = code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)
        output += allowed ? char : ' '
    }
    return output
}

function stripControlChars(text) {
    let output = ''
    for (const char of String(text || '')) {
        const code = char.charCodeAt(0)
        if (code === 127 || code < 32) continue
        output += char
    }
    return output
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
    // Pick the BrowserWindow's native backgroundColor to match the
    // theme the renderer is about to paint. The window's bg is what
    // Chromium shows BEFORE the HTML has parsed — any mismatch with
    // the boot-theme inline <style> in index.html produces a visible
    // flicker (e.g. Nothing theme used to open with a light grey
    // canvas because we only mapped dark/light here, then snap to
    // black once the boot script ran).
    //
    // The mapping must mirror:
    //   - the bg constants in index.html boot script
    //   - the --bg-app values per theme in design-system.css
    const VALID_THEMES = new Set(['light', 'dark', 'nothing'])
    const savedTheme = database.configGet('theme')
    // Order of preference: explicit user choice → OS dark-mode hint
    // → light. Without the OS check we'd open in light by default
    // and the renderer's `prefers-color-scheme: dark` query in the
    // boot script would flip to dark, producing a flash for users
    // who never set a theme but use dark mode at the system level.
    const bootTheme = VALID_THEMES.has(savedTheme)
        ? savedTheme
        : (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    const themeBg = bootTheme === 'nothing' ? '#000000'
        : bootTheme === 'dark' ? '#050507'
        : '#f1f5f9'

    const win = new BrowserWindow({
        width: 1280, height: 800,
        minWidth: 1280, minHeight: 800,
        frame: false,
        titleBarStyle: 'hidden',
        show: false,
        icon: appIconPath,
        backgroundColor: themeBg,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            webviewTag: false,
        },
    })

    mainWin = win
    appendStartupLog(`createWindow() bootTheme=${bootTheme} dev=${isDev ? 'yes' : 'no'}`)

    win.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
        if (!isMainFrame) return
        const detail = `did-fail-load code=${code} description=${description || 'unknown'} url=${validatedURL || 'n/a'}`
        appendStartupLog(detail)
        showBootErrorPage(
            win,
            'NetDuo failed to load UI',
            `${detail}\nLog file: ${startupLogName}`
        )
    })

    win.webContents.on('render-process-gone', (_event, details) => {
        const reason = details?.reason || 'unknown'
        const exitCode = details?.exitCode
        const detail = `render-process-gone reason=${reason} exitCode=${exitCode}`
        appendStartupLog(detail)
        showBootErrorPage(
            win,
            'NetDuo renderer crashed',
            `${detail}\nLog file: ${startupLogName}`
        )
    })

    win.webContents.on('preload-error', (_event, preloadPath, error) => {
        const detail = `preload-error path=${preloadPath || 'n/a'} error=${error?.message || error || 'unknown'}`
        appendStartupLog(detail)
        showBootErrorPage(
            win,
            'NetDuo preload failed',
            `${detail}\nLog file: ${startupLogName}`
        )
    })

    // SECURITY: lock the window to its trusted origin. Any navigation
    // attempt (malicious link, compromised script, accidental `<a
    // href>`) to a foreign URL is cancelled and, if it was an intended
    // external link, opened in the user's default browser instead. This
    // prevents an attacker from replacing the renderer's origin to slip
    // past contextIsolation boundaries.
    const isTrustedInternalURL = (rawUrl) => {
        if (!rawUrl) return false
        try {
            const u = new URL(rawUrl)
            if (u.protocol === 'file:') return true
            if (isDev && u.protocol === 'http:' && u.hostname === 'localhost') return true
            return false
        } catch {
            return false
        }
    }
    win.webContents.on('will-navigate', (event, targetUrl) => {
        if (isTrustedInternalURL(targetUrl)) return
        event.preventDefault()
        // Forward the click to the OS default browser (validators +
        // shell.openExternal already filter dangerous schemes elsewhere).
        try {
            if (/^https?:\/\//i.test(targetUrl)) shell.openExternal(targetUrl)
        } catch { /* drop silently */ }
    })
    win.webContents.setWindowOpenHandler(({ url }) => {
        // No window.open from the renderer. Links requesting a new
        // window are redirected to the OS browser.
        try {
            if (/^https?:\/\//i.test(url)) shell.openExternal(url)
        } catch { /* drop silently */ }
        return { action: 'deny' }
    })

    if (isDev) {
        win.loadURL(`http://localhost:5173/?bootTheme=${bootTheme}`)
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'), { query: { bootTheme } })
    }
    win.once('ready-to-show', () => {
        appendStartupLog('ready-to-show')
        win.show()
    })
    win.webContents.on('did-finish-load', () => {
        appendStartupLog('did-finish-load')
        if (!win.isVisible()) win.show()
    })

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
            // Pass 1: exact label match (text before ':' must equal key exactly)
            // This prevents e.g. "Cifrado del grupo" from shadowing "Cifrado"
            for (const key of keys) {
                for (const l of lines) {
                    if (key.toLowerCase() === 'ssid') {
                        if (/^\s+SSID\s/i.test(l) && !/BSSID/i.test(l) && l.includes(':'))
                            return l.substring(l.indexOf(':') + 1).trim()
                    } else if (l.includes(':')) {
                        const label = l.substring(0, l.indexOf(':')).trim()
                        if (label.toLowerCase() === key.toLowerCase()) {
                            return l.substring(l.indexOf(':') + 1).trim()
                        }
                    }
                }
            }
            // Pass 2: prefix match on label (for truncated Spanish keys like 'Velocidad de recepci')
            for (const key of keys) {
                if (key.toLowerCase() === 'ssid') continue // already handled
                for (const l of lines) {
                    if (l.includes(':')) {
                        const label = l.substring(0, l.indexOf(':')).trim()
                        if (label.toLowerCase().startsWith(key.toLowerCase())) {
                            return l.substring(l.indexOf(':') + 1).trim()
                        }
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

/**
 * Apply Content-Security-Policy via HTTP response header for the
 * default session. Header-based CSP supersedes any meta-tag CSP and
 * lets us swap policies between dev (Vite needs `unsafe-inline` +
 * `localhost` + websocket for HMR) and production (no localhost, no
 * websocket — only `'self'` with the inline-style allowance that
 * Recharts / Framer Motion legitimately require for animation
 * keyframes injected at runtime).
 *
 * Notes:
 *   - `'unsafe-inline'` for `style-src` is intentional: removing it
 *     would break Recharts (inline SVG styles) and the boot-theme
 *     <style> block in index.html. Removing it would need every chart
 *     to migrate to CSS-in-JS with hashed selectors.
 *   - `'unsafe-inline'` for `script-src` covers the boot-theme
 *     <script> in index.html. We keep it scoped to `'self'` plus
 *     inline because the renderer also runs Vite's own runtime which
 *     emits inline initializer fragments.
 *   - `frame-ancestors 'none'` only takes effect via header (meta-tag
 *     CSP ignores this directive).
 */
function installContentSecurityPolicy() {
    const cspDev = [
        `default-src 'self'`,
        `script-src 'self' 'unsafe-inline' http://localhost:5173`,
        `style-src 'self' 'unsafe-inline' http://localhost:5173 https://fonts.googleapis.com`,
        `img-src 'self' data: blob:`,
        `font-src 'self' data: https://fonts.gstatic.com`,
        `connect-src 'self' http://localhost:5173 ws://localhost:5173`,
        `object-src 'none'`,
        `base-uri 'self'`,
        `frame-ancestors 'none'`,
    ].join('; ')
    const cspProd = [
        `default-src 'self'`,
        `script-src 'self' 'unsafe-inline'`,
        `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
        `img-src 'self' data: blob:`,
        `font-src 'self' data: https://fonts.gstatic.com`,
        `connect-src 'self'`,
        `object-src 'none'`,
        `base-uri 'self'`,
        `frame-ancestors 'none'`,
    ].join('; ')
    const policy = isDev ? cspDev : cspProd

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const headers = { ...(details.responseHeaders || {}) }
        // Remove any pre-existing CSP from upstream so our policy wins.
        for (const k of Object.keys(headers)) {
            if (k.toLowerCase() === 'content-security-policy') delete headers[k]
        }
        headers['Content-Security-Policy'] = [policy]
        callback({ responseHeaders: headers })
    })
}

app.whenReady().then(() => {
    appendStartupLog('app.whenReady')
    database.init(app.getPath('userData'))
    installContentSecurityPolicy()
    createWindow()
    startNetworkWatcher()
    appendStartupLog('startup complete')
}).catch(err => {
    appendStartupLog(`whenReady-error: ${err?.stack || err}`)
})

process.on('uncaughtException', err => {
    appendStartupLog(`uncaughtException: ${err?.stack || err}`)
})

process.on('unhandledRejection', reason => {
    appendStartupLog(`unhandledRejection: ${reason?.stack || reason}`)
})
app.on('window-all-closed', () => {
    stopNetworkWatcher()
    stopAllTrackedProcesses()
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
    // `countryCode` is the ISO 3166-1 alpha-2 (2 letters: US, DR, ES, MX,
    // …). The Dashboard prefers it over the full country name in tight
    // tile space so long names like "Dominican Republic" or "United Arab
    // Emirates" never collide with the truncation ellipsis.
    http.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp,org,lat,lon,timezone,as`, res => {
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
ipcMain.handle('get-dns-servers', async () => {
    // dns.getServers() often returns stub/loopback (127.0.0.1, ::1) or
    // link-local IPv6 (fe80::) instead of the real upstream DNS.
    // Always try ipconfig /all first on Windows to get the actual DNS servers.
    try {
        const { out } = await run('ipconfig /all', 5000)
        if (out) {
            // Parse DNS server lines: they follow "Servidores DNS" / "DNS Servers" label
            // and may span multiple indented continuation lines
            const dnsFromIpconfig = []
            const lines = out.split('\n')
            let inDnsBlock = false
            for (const line of lines) {
                if (/DNS\s*(Servers|Server)|Servidores\s*DNS/i.test(line) && line.includes(':')) {
                    inDnsBlock = true
                    const val = line.substring(line.indexOf(':') + 1).trim()
                    if (val && !/^fe80/i.test(val)) dnsFromIpconfig.push(val)
                } else if (inDnsBlock) {
                    const trimmed = line.trim()
                    // Continuation lines are indented values (IPs) with no label
                    if (trimmed && !trimmed.includes(':') && /^[\d.]/.test(trimmed)) {
                        // Plain IPv4 continuation
                        if (!dnsFromIpconfig.includes(trimmed)) dnsFromIpconfig.push(trimmed)
                    } else if (trimmed && !trimmed.includes(' . ') && /^[\da-f.:]+$/i.test(trimmed) && !/^fe80/i.test(trimmed)) {
                        // IPv6 continuation (non-link-local)
                        if (!dnsFromIpconfig.includes(trimmed)) dnsFromIpconfig.push(trimmed)
                    } else {
                        inDnsBlock = false
                    }
                }
            }
            // Deduplicate & filter out loopback
            const filtered = [...new Set(dnsFromIpconfig)].filter(s =>
                s !== '127.0.0.1' && s !== '::1' && !/^fe80/i.test(s)
            )
            if (filtered.length) return filtered
        }
    } catch { /* fall through */ }

    // Fallback: use Node's dns.getServers(), sort IPv4 first
    const servers = dns.getServers()
    return [...servers].sort((a, b) => {
        const aIsV4 = /^\d+\.\d+\.\d+\.\d+$/.test(a)
        const bIsV4 = /^\d+\.\d+\.\d+\.\d+$/.test(b)
        const aIsLinkLocal = a.startsWith('fe80') || a === '127.0.0.1' || a === '::1'
        const bIsLinkLocal = b.startsWith('fe80') || b === '127.0.0.1' || b === '::1'
        if (aIsV4 && !bIsV4) return -1
        if (!aIsV4 && bIsV4) return 1
        if (aIsLinkLocal && !bIsLinkLocal) return 1
        if (!aIsLinkLocal && bIsLinkLocal) return -1
        return 0
    })
})

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

const LAN_HTTP_PORTS = new Set([80, 81, 88, 8000, 8080, 8081, 8888, 9000, 9090, 10000])
const LAN_HTTPS_PORTS = new Set([443, 444, 8443, 9443, 10443, 5001, 7001, 7443])

function normalizePortList(rawPorts, maxLength = 4096) {
    const source = Array.isArray(rawPorts) ? rawPorts : []
    const ports = []
    for (const value of source) {
        const port = Number.parseInt(String(value), 10)
        if (!Number.isInteger(port) || port < 1 || port > 65535) continue
        ports.push(port)
    }
    const unique = Array.from(new Set(ports))
    unique.sort((a, b) => a - b)
    return unique.slice(0, maxLength)
}

function normalizeErrorCode(error) {
    return String(error?.code || error?.message || '').trim().toUpperCase()
}

function normalizeTcpStateFromError(error) {
    const code = normalizeErrorCode(error)
    if (code === 'ETIMEDOUT' || code === 'TIMEOUT') return 'filtered'
    if (code === 'ECONNREFUSED') return 'closed'
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'EHOSTDOWN' || code === 'ENOTFOUND') return 'closed'
    return 'closed'
}

function tcpProbeOnce(host, port, timeoutMs) {
    return new Promise(resolve => {
        const started = Date.now()
        const socket = new net.Socket()
        let settled = false

        const done = (state, error = null) => {
            if (settled) return
            settled = true
            try { socket.destroy() } catch { /* noop */ }
            resolve({
                state,
                rtt: Date.now() - started,
                error: error || null,
            })
        }

        socket.setTimeout(timeoutMs)
        socket.once('connect', () => done('open'))
        socket.once('timeout', () => done('filtered', 'timeout'))
        socket.once('error', err => done(normalizeTcpStateFromError(err), normalizeErrorCode(err)))

        try { socket.connect(port, host) } catch (err) { done('closed', normalizeErrorCode(err)) }
    })
}

async function tcpProbeWithAttempts(host, port, timeoutMs, attempts = 1) {
    const maxAttempts = Math.max(1, Math.min(3, attempts))
    const rows = []
    for (let index = 0; index < maxAttempts; index += 1) {
        const row = await tcpProbeOnce(host, port, timeoutMs)
        rows.push(row)
        if (row.state === 'open') break
    }

    const open = rows.find(item => item.state === 'open')
    if (open) {
        return {
            state: 'open',
            rtt: open.rtt,
            attempts: rows.length,
            error: null,
        }
    }

    const filtered = rows.find(item => item.state === 'filtered')
    if (filtered) {
        return {
            state: 'filtered',
            rtt: filtered.rtt,
            attempts: rows.length,
            error: filtered.error || null,
        }
    }

    const last = rows[rows.length - 1] || { state: 'closed', rtt: null, error: null }
    return {
        state: 'closed',
        rtt: last.rtt,
        attempts: rows.length,
        error: last.error || null,
    }
}

function cleanupBannerText(text) {
    return replaceDisallowedAscii(text)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180)
}

function readTcpBanner(host, port, timeoutMs, payload = null, expectData = true) {
    return new Promise(resolve => {
        const socket = new net.Socket()
        let settled = false
        let chunks = []

        const done = (value = null) => {
            if (settled) return
            settled = true
            try { socket.destroy() } catch { /* noop */ }
            resolve(value)
        }

        socket.setTimeout(timeoutMs)
        socket.once('connect', () => {
            if (payload) {
                try { socket.write(payload) } catch { /* noop */ }
            }
            if (!expectData) {
                setTimeout(() => done(null), Math.min(260, timeoutMs))
            }
        })
        socket.on('data', data => {
            if (settled) return
            chunks.push(data)
            const merged = Buffer.concat(chunks).subarray(0, 512)
            done(cleanupBannerText(merged.toString('utf8')))
        })
        socket.once('timeout', () => done(null))
        socket.once('error', () => done(null))

        try { socket.connect(port, host) } catch { done(null) }
    })
}

function probeHttpHead(host, port, secure, timeoutMs) {
    return new Promise(resolve => {
        const client = secure ? https : http
        const req = client.request({
            host,
            port,
            method: 'HEAD',
            path: '/',
            timeout: timeoutMs,
            rejectUnauthorized: false,
        }, res => {
            const detail = [`status ${res.statusCode}`]
            if (res.headers?.server) detail.push(`server ${String(res.headers.server).slice(0, 80)}`)
            if (res.headers?.['x-powered-by']) detail.push(`x-powered-by ${String(res.headers['x-powered-by']).slice(0, 80)}`)
            res.resume()
            resolve({
                service: secure ? 'https' : 'http',
                detail: detail.join(', '),
            })
        })
        req.once('error', () => resolve(null))
        req.once('timeout', () => { req.destroy(); resolve(null) })
        req.end()
    })
}

function probeTlsIdentity(host, port, timeoutMs) {
    return new Promise(resolve => {
        const socket = tls.connect({
            host,
            port,
            servername: host,
            rejectUnauthorized: false,
            timeout: timeoutMs,
        }, () => {
            const cert = socket.getPeerCertificate(true)
            const detail = []
            if (cert?.subject?.CN) detail.push(`cn ${String(cert.subject.CN).slice(0, 80)}`)
            const proto = socket.getProtocol()
            if (proto) detail.push(`tls ${proto}`)
            socket.end()
            resolve({
                service: 'tls',
                detail: detail.join(', ') || 'tls endpoint',
            })
        })
        socket.once('error', () => resolve(null))
        socket.once('timeout', () => { socket.destroy(); resolve(null) })
    })
}

async function fingerprintTcpService(host, port, timeoutMs) {
    if (LAN_HTTP_PORTS.has(port)) {
        const info = await probeHttpHead(host, port, false, timeoutMs + 400)
        if (info) return info
    }
    if (LAN_HTTPS_PORTS.has(port)) {
        const info = await probeHttpHead(host, port, true, timeoutMs + 500)
        if (info) return info
        const tlsInfo = await probeTlsIdentity(host, port, timeoutMs + 500)
        if (tlsInfo) return tlsInfo
    }

    if (port === 22) {
        const banner = await readTcpBanner(host, port, timeoutMs)
        return banner ? { service: 'ssh', detail: banner } : { service: 'ssh', detail: null }
    }
    if (port === 21) {
        const banner = await readTcpBanner(host, port, timeoutMs)
        return banner ? { service: 'ftp', detail: banner } : { service: 'ftp', detail: null }
    }
    if (port === 25 || port === 587) {
        const banner = await readTcpBanner(host, port, timeoutMs)
        return banner ? { service: 'smtp', detail: banner } : { service: 'smtp', detail: null }
    }
    if (port === 110) {
        const banner = await readTcpBanner(host, port, timeoutMs)
        return banner ? { service: 'pop3', detail: banner } : { service: 'pop3', detail: null }
    }
    if (port === 143) {
        const banner = await readTcpBanner(host, port, timeoutMs)
        return banner ? { service: 'imap', detail: banner } : { service: 'imap', detail: null }
    }
    if (port === 6379) {
        const banner = await readTcpBanner(host, port, timeoutMs, Buffer.from('*1\r\n$4\r\nPING\r\n'), true)
        if (banner && /PONG/i.test(banner)) return { service: 'redis', detail: 'PONG response' }
        return { service: 'redis', detail: banner || null }
    }
    if (port === 3306) {
        const banner = await readTcpBanner(host, port, timeoutMs)
        return { service: 'mysql', detail: banner || null }
    }
    if (port === 3389) return { service: 'rdp', detail: null }
    if (port === 445) return { service: 'smb', detail: null }
    return null
}

function buildDnsQueryPacket() {
    const tx = Math.floor(Math.random() * 0xffff)
    const header = Buffer.from([
        (tx >> 8) & 0xff, tx & 0xff,
        0x01, 0x00,
        0x00, 0x01,
        0x00, 0x00,
        0x00, 0x00,
        0x00, 0x00,
    ])
    const labels = Buffer.from([0x07, 0x65, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x03, 0x63, 0x6f, 0x6d, 0x00])
    const tail = Buffer.from([0x00, 0x01, 0x00, 0x01])
    return Buffer.concat([header, labels, tail])
}

function getUdpProbePayload(port) {
    if (port === 53) return buildDnsQueryPacket()
    if (port === 69) return Buffer.concat([Buffer.from([0x00, 0x01]), Buffer.from('netduo-test\0octet\0', 'ascii')])
    if (port === 123) {
        const buf = Buffer.alloc(48)
        buf[0] = 0x1b
        return buf
    }
    if (port === 161) return Buffer.from('302602010104067075626c6963a01902047065b37b020100020100300b300906052b060102010500', 'hex')
    if (port === 1900) {
        return Buffer.from(
            'M-SEARCH * HTTP/1.1\r\n' +
            'HOST:239.255.255.250:1900\r\n' +
            'MAN:"ssdp:discover"\r\n' +
            'MX:2\r\n' +
            'ST:ssdp:all\r\n\r\n',
            'ascii'
        )
    }
    if (port === 5351) return Buffer.from([0x00, 0x00, 0x00, 0x00])
    return Buffer.from([0x00])
}

function udpProbeOnce(host, port, timeoutMs) {
    return new Promise(resolve => {
        const socket = dgram.createSocket('udp4')
        const started = Date.now()
        let settled = false

        const done = (state, error = null, responseSize = 0) => {
            if (settled) return
            settled = true
            try { socket.close() } catch { /* noop */ }
            resolve({
                state,
                rtt: Date.now() - started,
                error: error || null,
                responseSize,
            })
        }

        const timer = setTimeout(() => done('filtered', 'timeout', 0), timeoutMs)
        socket.once('message', msg => {
            clearTimeout(timer)
            done('open', null, msg?.length || 0)
        })
        socket.once('error', err => {
            clearTimeout(timer)
            const code = normalizeErrorCode(err)
            if (code === 'ECONNREFUSED') done('closed', code, 0)
            else done('filtered', code || 'error', 0)
        })

        const payload = getUdpProbePayload(port)
        socket.send(payload, 0, payload.length, port, host, err => {
            if (!err) return
            clearTimeout(timer)
            done('closed', normalizeErrorCode(err), 0)
        })
    })
}

async function udpProbeWithAttempts(host, port, timeoutMs, attempts = 1) {
    const maxAttempts = Math.max(1, Math.min(3, attempts))
    const rows = []
    for (let index = 0; index < maxAttempts; index += 1) {
        const row = await udpProbeOnce(host, port, timeoutMs)
        rows.push(row)
        if (row.state === 'open') break
    }

    const open = rows.find(item => item.state === 'open')
    if (open) {
        return {
            state: 'open',
            rtt: open.rtt,
            attempts: rows.length,
            error: null,
        }
    }

    const filtered = rows.find(item => item.state === 'filtered' || item.state === 'open|filtered')
    if (filtered) {
        return {
            state: 'filtered',
            rtt: filtered.rtt,
            attempts: rows.length,
            error: filtered.error || null,
        }
    }

    const last = rows[rows.length - 1] || { state: 'closed', rtt: null, error: null }
    return {
        state: 'closed',
        rtt: last.rtt,
        attempts: rows.length,
        error: last.error || null,
    }
}

async function scanLanSecurityHost(host, options) {
    const entries = []
    const tcpPorts = normalizePortList(options?.tcpPorts, 4096)
    const udpPorts = normalizePortList(options?.udpPorts, 2048)
    const timeoutMs = Math.max(300, Math.min(4000, Number.parseInt(String(options?.timeoutMs || 900), 10) || 900))
    const tcpAttempts = Math.max(1, Math.min(3, Number.parseInt(String(options?.tcpAttempts || 1), 10) || 1))
    const udpAttempts = Math.max(1, Math.min(3, Number.parseInt(String(options?.udpAttempts || 1), 10) || 1))
    const includeServiceProbe = options?.includeServiceProbe !== false
    const tcpConcurrency = Math.max(4, Math.min(64, Number.parseInt(String(options?.tcpConcurrency || 24), 10) || 24))
    const udpConcurrency = Math.max(2, Math.min(24, Number.parseInt(String(options?.udpConcurrency || 8), 10) || 8))

    if (tcpPorts.length) {
        const tcpRows = await parallelMap(tcpPorts, async port => {
            const probe = await tcpProbeWithAttempts(host, port, timeoutMs, tcpAttempts)
            const row = {
                protocol: 'tcp',
                port,
                state: probe.state,
                rtt: probe.rtt,
                attempts: probe.attempts,
                service: null,
                detail: null,
                error: probe.error || null,
            }
            if (probe.state === 'open' && includeServiceProbe) {
                const fp = await withTimeout(fingerprintTcpService(host, port, timeoutMs), timeoutMs + 600, null)
                if (fp?.service) row.service = fp.service
                if (fp?.detail) row.detail = fp.detail
            }
            return row
        }, tcpConcurrency)
        entries.push(...tcpRows)
    }

    if (udpPorts.length) {
        const udpRows = await parallelMap(udpPorts, async port => {
            const probe = await udpProbeWithAttempts(host, port, timeoutMs, udpAttempts)
            return {
                protocol: 'udp',
                port,
                state: probe.state,
                rtt: probe.rtt,
                attempts: probe.attempts,
                service: null,
                detail: probe.state === 'filtered' ? 'no response (filtered)' : null,
                error: probe.error || null,
            }
        }, udpConcurrency)
        entries.push(...udpRows)
    }

    entries.sort((a, b) => {
        if (a.protocol !== b.protocol) return a.protocol.localeCompare(b.protocol)
        return a.port - b.port
    })
    return entries
}

ipcMain.handle('lan-security-scan', async (_, payload = {}) => {
    const started = Date.now()
    const rawTargets = Array.isArray(payload?.targets) ? payload.targets : []
    const targets = rawTargets
        .map(item => sanitizeHost(item?.ip ?? item))
        .filter(Boolean)
        .map(ip => ({ ip }))

    if (!targets.length) {
        return {
            ok: true,
            checkedAt: new Date().toISOString(),
            durationMs: 0,
            results: [],
        }
    }

    const hostConcurrency = Math.max(1, Math.min(12, Number.parseInt(String(payload?.hostConcurrency || 4), 10) || 4))
    const options = {
        tcpPorts: payload?.tcpPorts,
        udpPorts: payload?.udpPorts,
        timeoutMs: payload?.timeoutMs,
        tcpAttempts: payload?.tcpAttempts,
        udpAttempts: payload?.udpAttempts,
        includeServiceProbe: payload?.includeServiceProbe !== false,
        tcpConcurrency: payload?.tcpConcurrency,
        udpConcurrency: payload?.udpConcurrency,
    }

    const results = await parallelMap(targets, async target => {
        const entries = await scanLanSecurityHost(target.ip, options)
        return { ip: target.ip, entries }
    }, hostConcurrency)

    return {
        ok: true,
        checkedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - started),
        results,
    }
})

// ── Port Scanner ──────────────────────────────────────
let portScanCtrl = null
ipcMain.on('stop-port-scan', () => {
    if (portScanCtrl) {
        portScanCtrl.cancelled = true
        for (const s of portScanCtrl.sockets) { try { s.destroy() } catch { /* noop */ } }
        portScanCtrl.sockets.clear()
    }
})
ipcMain.handle('scan-ports', async (_, host, startPort, endPort) => {
    // SECURITY: sanitize host (IPv4 / hostname) and clamp the port range
    // before allocating the port array. Without clamping, a renderer
    // could request endPort = 2**31 and balloon memory / tie up the
    // event loop before any socket even opens.
    const safeHost = sanitizeHost(host)
    if (!safeHost) return []
    const lo = Math.max(1, Math.min(65535, Number.parseInt(startPort, 10) || 1))
    const hi = Math.max(lo, Math.min(65535, Number.parseInt(endPort, 10) || lo))
    startPort = lo
    endPort = hi
    host = safeHost

    const ctrl = { cancelled: false, sockets: new Set() }
    portScanCtrl = ctrl
    const results = []
    const ports = []
    for (let p = startPort; p <= endPort; p++) ports.push(p)
    try {
        for (let i = 0; i < ports.length; i += 50) {
            if (ctrl.cancelled) break
            const batch = ports.slice(i, i + 50)
            const res = await Promise.all(batch.map(port => new Promise(r => {
                if (ctrl.cancelled) return r({ port, open: false })
                const s = new net.Socket()
                ctrl.sockets.add(s)
                const done = (payload) => { ctrl.sockets.delete(s); s.destroy(); r(payload) }
                s.setTimeout(800)
                s.on('connect', () => done({ port, open: true }))
                s.on('timeout', () => done({ port, open: false }))
                s.on('error', () => done({ port, open: false }))
                s.connect(port, host)
            })))
            results.push(...res.filter(r => r.open))
        }
    } finally {
        if (portScanCtrl === ctrl) portScanCtrl = null
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
const scannerDiscoveryCache = {
    ssdpByBase: new Map(),
    mdnsByBase: new Map(),
}
const SCANNER_DISCOVERY_TTL_MS = 20000
const SCANNER_DISCOVERY_MAX_KEYS = 16

function getScannerDiscoveryCache(cacheMap, key) {
    const hit = cacheMap.get(key)
    if (!hit) return null
    if (Date.now() - hit.ts > SCANNER_DISCOVERY_TTL_MS) {
        cacheMap.delete(key)
        return null
    }
    return hit.value
}

function setScannerDiscoveryCache(cacheMap, key, value) {
    cacheMap.set(key, { ts: Date.now(), value: value || {} })
    if (cacheMap.size <= SCANNER_DISCOVERY_MAX_KEYS) return
    const oldestKey = cacheMap.keys().next().value
    if (oldestKey) cacheMap.delete(oldestKey)
}

function filterDiscoveryByRange(infoByIp, baseIP, rangeStart, rangeEnd) {
    const out = {}
    for (const [ip, info] of Object.entries(infoByIp || {})) {
        if (!ipInRange(ip, baseIP, rangeStart, rangeEnd)) continue
        out[ip] = info
    }
    return out
}

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
    if (!validators.isIPv4(ip)) return Promise.resolve(null)
    return new Promise((resolve) => {
        execFile('nslookup', [ip], { timeout: 3200, windowsHide: true, encoding: 'utf8' }, (_err, stdout) => {
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
    if (!validators.isIPv4(ip)) return Promise.resolve(null)
    return new Promise((resolve) => {
        execFile('ping', ['-a', '-4', '-n', '1', '-w', '1200', ip], { timeout: 3000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
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
    if (!validators.isIPv4(ip)) return Promise.resolve(null)
    return new Promise((resolve) => {
        execFile('nbtstat', ['-A', ip], { timeout: 3500, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
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

/**
 * Resolve the vendor for a MAC address.
 *
 * Priority:
 *   1. Local OUI table (offline, instant)
 *   2. Randomized-MAC heuristic (clear local-admin bit, retry OUI)
 *   3. macvendors.com HTTPS API (network call)
 *
 * Step 3 is skipped when:
 *   - `skipOnline` is passed true (randomized/empty MACs where the API
 *     call would be wasted)
 *   - The user has disabled online lookups via the `macVendorLookupOnline`
 *     config flag (Settings → Privacy). Read once per call so changes
 *     take effect on the next scan without restarting the app.
 */
async function resolveVendor(mac, skipOnline = false) {
    const localVendor = ouiLookup(mac)
    if (localVendor) return { vendor: localVendor, vendorSource: 'oui' }
    const derivedVendor = deriveVendorFromRandomized(mac)
    if (derivedVendor) return { vendor: derivedVendor, vendorSource: 'oui-derived' }
    if (!mac || skipOnline) return { vendor: null, vendorSource: 'unknown' }

    // User opt-out: "Consultas online de fabricante" in Settings. The
    // flag is stored as a boolean; null / undefined = opted in (default).
    const onlineAllowed = database.configGet('macVendorLookupOnline')
    if (onlineAllowed === false) return { vendor: null, vendorSource: 'unknown' }

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

function encodeDnsName(name) {
    const labels = String(name || '')
        .split('.')
        .map(label => label.trim())
        .filter(Boolean)
    const chunks = []
    for (const label of labels) {
        const bytes = Buffer.from(label, 'utf8')
        if (bytes.length === 0 || bytes.length > 63) return null
        chunks.push(Buffer.from([bytes.length]))
        chunks.push(bytes)
    }
    chunks.push(Buffer.from([0]))
    return Buffer.concat(chunks)
}

function buildMdnsQueryPacket() {
    const names = [
        '_services._dns-sd._udp.local',
        '_workstation._tcp.local',
        '_http._tcp.local',
        '_ipp._tcp.local',
        '_printer._tcp.local',
        '_airplay._tcp.local',
        '_raop._tcp.local',
        '_googlecast._tcp.local',
        '_hap._tcp.local',
        '_companion-link._tcp.local',
        '_apple-mobdev2._tcp.local',
        '_airdrop._tcp.local',
        '_smb._tcp.local',
        '_device-info._tcp.local',
        '_adb-tls-connect._tcp.local',
        '_androidtvremote2._tcp.local',
        '_spotify-connect._tcp.local',
    ]
    const encoded = names.map(encodeDnsName)
    if (encoded.some(q => !q)) return null
    const header = Buffer.alloc(12)
    // Transaction ID = 0 for multicast DNS.
    header.writeUInt16BE(0x0000, 0)
    header.writeUInt16BE(0x0000, 2)
    header.writeUInt16BE(encoded.length, 4)
    header.writeUInt16BE(0, 6)
    header.writeUInt16BE(0, 8)
    header.writeUInt16BE(0, 10)
    // QCLASS with QU bit (0x8000) requests unicast responses when possible.
    const questionClass = Buffer.from([0x80, 0x01]) // IN + unicast-response
    const questionTypePtr = Buffer.from([0x00, 0x0c]) // PTR
    const questions = []
    for (const q of encoded) questions.push(q, questionTypePtr, questionClass)
    return Buffer.concat([header, ...questions])
}

function parseIPv6FromBuffer(buf, offset) {
    const parts = []
    for (let i = 0; i < 16; i += 2) {
        parts.push(buf.readUInt16BE(offset + i).toString(16))
    }
    return parts.join(':')
}

function readDnsName(buf, offset, depth = 0) {
    if (!Buffer.isBuffer(buf) || offset < 0 || offset >= buf.length || depth > 12) return null
    const labels = []
    let i = offset
    let nextOffset = offset
    while (i < buf.length) {
        const len = buf[i]
        // Pointer compression (11xxxxxx)
        if ((len & 0xc0) === 0xc0) {
            if (i + 1 >= buf.length) return null
            const pointerOffset = ((len & 0x3f) << 8) | buf[i + 1]
            const pointed = readDnsName(buf, pointerOffset, depth + 1)
            if (!pointed) return null
            if (pointed.name) labels.push(pointed.name)
            nextOffset = i + 2
            return { name: labels.join('.'), nextOffset }
        }
        if (len === 0) {
            nextOffset = i + 1
            return { name: labels.join('.'), nextOffset }
        }
        if (len > 63 || i + 1 + len > buf.length) return null
        labels.push(buf.slice(i + 1, i + 1 + len).toString('utf8'))
        i += 1 + len
    }
    return null
}

function parseDnsRecords(buf, offset, count) {
    const records = []
    let cursor = offset
    for (let i = 0; i < count; i++) {
        const nameNode = readDnsName(buf, cursor)
        if (!nameNode) return { records: [], nextOffset: null }
        cursor = nameNode.nextOffset
        if (cursor + 10 > buf.length) return { records: [], nextOffset: null }
        const type = buf.readUInt16BE(cursor)
        const klassRaw = buf.readUInt16BE(cursor + 2)
        const klass = klassRaw & 0x7fff
        const ttl = buf.readUInt32BE(cursor + 4)
        const rdlength = buf.readUInt16BE(cursor + 8)
        cursor += 10
        if (cursor + rdlength > buf.length) return { records: [], nextOffset: null }
        const rstart = cursor

        let ptr = null
        let target = null
        let txt = []
        let ipv4 = null
        let ipv6 = null

        if (type === 1 && rdlength === 4) {
            ipv4 = `${buf[rstart]}.${buf[rstart + 1]}.${buf[rstart + 2]}.${buf[rstart + 3]}`
        } else if (type === 28 && rdlength === 16) {
            ipv6 = parseIPv6FromBuffer(buf, rstart)
        } else if (type === 12 || type === 5) {
            const ptrNode = readDnsName(buf, rstart)
            if (ptrNode) ptr = ptrNode.name
        } else if (type === 33 && rdlength >= 6) {
            const targetNode = readDnsName(buf, rstart + 6)
            if (targetNode) target = targetNode.name
        } else if (type === 16) {
            txt = parseDnsTxtValues(buf, rstart, rdlength)
        }

        records.push({
            name: nameNode.name || '',
            type,
            class: klass,
            ttl,
            ptr,
            target,
            txt,
            ipv4,
            ipv6,
        })
        cursor += rdlength
    }
    return { records, nextOffset: cursor }
}

function parseDnsTxtValues(buf, offset, length) {
    const values = []
    const end = offset + length
    let cursor = offset
    while (cursor < end) {
        const len = buf[cursor]
        cursor += 1
        if (!len) continue
        if (cursor + len > end) break
        const value = stripControlChars(buf.slice(cursor, cursor + len).toString('utf8')).trim()
        if (value) values.push(value)
        cursor += len
    }
    return values
}

function parseDnsMessage(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 12) return null
    const qdcount = buf.readUInt16BE(4)
    const ancount = buf.readUInt16BE(6)
    const nscount = buf.readUInt16BE(8)
    const arcount = buf.readUInt16BE(10)

    let cursor = 12
    for (let i = 0; i < qdcount; i++) {
        const qname = readDnsName(buf, cursor)
        if (!qname) return null
        cursor = qname.nextOffset
        if (cursor + 4 > buf.length) return null
        cursor += 4
    }

    const parsedAnswers = parseDnsRecords(buf, cursor, ancount + nscount + arcount)
    if (parsedAnswers.nextOffset == null) return null
    return parsedAnswers.records
}

function normalizeMdnsCandidate(raw) {
    if (!raw || typeof raw !== 'string') return null
    let value = raw.trim().replace(/\.$/, '')
    if (!value) return null
    if (value.includes('._')) value = value.split('._')[0]
    value = value.replace(/\.local$/i, '').trim()
    if (!value || /^_/.test(value)) return null
    // Remove control characters while keeping printable names intact.
    value = stripControlChars(value).trim()
    if (!value) return null
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return null
    if (/^[0-9a-f]{12,}$/i.test(value)) return null
    return value
}

function scoreMdnsCandidate(name, sourceType) {
    if (!name) return -100
    let score = sourceType === 'a' ? 50
        : sourceType === 'txt' ? 48
        : sourceType === 'service' ? 44
        : sourceType === 'srv' ? 40
        : 30
    if (name.length <= 24) score += 4
    if (name.includes(' ')) score += 2
    if (name.includes('._')) score -= 6
    if (/^([a-f0-9]{2}[:-]){2,}/i.test(name)) score -= 8
    return score
}

function mdnsMergeCandidate(outByIp, ip, rawName, sourceType = 'ptr') {
    if (!ip) return
    const hostname = normalizeMdnsCandidate(rawName)
    if (!hostname) return
    const score = scoreMdnsCandidate(hostname, sourceType)
    const prev = outByIp[ip]
    if (!prev || score > prev.score || (score === prev.score && hostname.length < prev.hostname.length)) {
        outByIp[ip] = { hostname, score }
    }
}

function mdnsTxtNameCandidates(values) {
    const out = []
    for (const value of values || []) {
        const raw = String(value || '').trim()
        const m = raw.match(/^(?:fn|name|device[-_]?name|friendly[-_]?name|nm)\s*=\s*(.+)$/i)
        if (m?.[1]) out.push(m[1])
    }
    return out
}

function mdnsDiscover(timeoutMs = 1400) {
    return new Promise((resolve) => {
        const packet = buildMdnsQueryPacket()
        if (!packet) return resolve({})

        const socket = dgram.createSocket('udp4')
        const byIp = {}
        let done = false

        const finish = () => {
            if (done) return
            done = true
            try { socket.close() } catch { /* noop */ }
            const out = {}
            for (const [ip, row] of Object.entries(byIp)) {
                if (!row?.hostname) continue
                out[ip] = { hostname: row.hostname }
            }
            resolve(out)
        }

        socket.on('error', finish)
        socket.on('message', (msg, rinfo) => {
            const sourceIp = rinfo?.address
            if (!sourceIp) return
            const records = parseDnsMessage(msg)
            if (!records?.length) return
            for (const record of records) {
                if (record.type === 1 && record.ipv4) {
                    mdnsMergeCandidate(byIp, record.ipv4, record.name, 'a')
                    continue
                }
                if (record.type === 33 && record.target) {
                    mdnsMergeCandidate(byIp, sourceIp, record.name, 'service')
                    mdnsMergeCandidate(byIp, sourceIp, record.target, 'srv')
                    continue
                }
                if (record.type === 16) {
                    mdnsMergeCandidate(byIp, sourceIp, record.name, 'service')
                    for (const candidate of mdnsTxtNameCandidates(record.txt)) {
                        mdnsMergeCandidate(byIp, sourceIp, candidate, 'txt')
                    }
                    continue
                }
                if (record.type === 12 && record.ptr) {
                    mdnsMergeCandidate(byIp, sourceIp, record.ptr, 'ptr')
                }
            }
        })

        socket.bind(0, () => {
            try { socket.setBroadcast(true) } catch { /* noop */ }
            socket.send(packet, 0, packet.length, 5353, '224.0.0.251', () => { })
            setTimeout(() => {
                socket.send(packet, 0, packet.length, 5353, '224.0.0.251', () => { })
            }, 250)
            setTimeout(finish, timeoutMs)
        })
    })
}

async function collectMdnsInfo(baseIP, rangeStart, rangeEnd) {
    const raw = await withTimeout(mdnsDiscover(1500), 2100, {})
    const out = {}
    for (const [ip, info] of Object.entries(raw || {})) {
        if (!ipInRange(ip, baseIP, rangeStart, rangeEnd)) continue
        const hostname = normalizeResolvedHost(info?.hostname)
        if (hostname) out[ip] = { hostname }
    }
    return out
}

async function collectSsdpInfoCached(baseIP, rangeStart, rangeEnd) {
    const cacheKey = String(baseIP || '').trim()
    const cached = getScannerDiscoveryCache(scannerDiscoveryCache.ssdpByBase, cacheKey)
    if (cached) return filterDiscoveryByRange(cached, baseIP, rangeStart, rangeEnd)
    const full = await withTimeout(collectSsdpInfo(baseIP, 1, 254), 4200, {})
    setScannerDiscoveryCache(scannerDiscoveryCache.ssdpByBase, cacheKey, full || {})
    return filterDiscoveryByRange(full || {}, baseIP, rangeStart, rangeEnd)
}

async function collectMdnsInfoCached(baseIP, rangeStart, rangeEnd) {
    const cacheKey = String(baseIP || '').trim()
    const cached = getScannerDiscoveryCache(scannerDiscoveryCache.mdnsByBase, cacheKey)
    if (cached) return filterDiscoveryByRange(cached, baseIP, rangeStart, rangeEnd)
    const full = await withTimeout(collectMdnsInfo(baseIP, 1, 254), 2300, {})
    setScannerDiscoveryCache(scannerDiscoveryCache.mdnsByBase, cacheKey, full || {})
    return filterDiscoveryByRange(full || {}, baseIP, rangeStart, rangeEnd)
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

function safeUrlFromXml(rawUrl, baseUrl = null) {
    if (!rawUrl || typeof rawUrl !== 'string') return null
    try {
        const parsed = new URL(rawUrl.trim(), baseUrl || undefined)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
        return parsed.toString()
    } catch {
        return null
    }
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

function normalizeGatewayHint(value, baseIP) {
    const ip = String(value || '').trim()
    if (!validators.isIPv4(ip) || !ip.startsWith(`${baseIP}.`)) return null
    const last = parseInt(ip.split('.').pop(), 10)
    // Keep the hint narrow: common default gateways only. This prevents a
    // renderer bug from turning an arbitrary client into a ghost-filter
    // exemption while still disambiguating real .254 clients on .1 networks.
    return last === 1 || last === 254 ? ip : null
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
    const modelDescription = xmlTag(body, 'modelDescription')
    const modelNumber = xmlTag(body, 'modelNumber')
    const serialNumber = xmlTag(body, 'serialNumber')
    const deviceType = xmlTag(body, 'deviceType')
    const udn = xmlTag(body, 'UDN')
    const presentationUrl = safeUrlFromXml(xmlTag(body, 'presentationURL'), locationUrl)
    const serviceTypes = []
    const re = /<serviceType[^>]*>([\s\S]*?)<\/serviceType>/gi
    let match
    while ((match = re.exec(body)) !== null) {
        const serviceType = decodeXmlEntities(String(match[1] || '')).replace(/\s+/g, ' ').trim()
        if (serviceType) serviceTypes.push(serviceType)
    }
    if (
        !friendlyName && !manufacturer && !modelName && !modelDescription &&
        !modelNumber && !serialNumber && !deviceType && !udn &&
        !presentationUrl && !serviceTypes.length
    ) return null
    return {
        friendlyName,
        manufacturer,
        modelName,
        modelDescription,
        modelNumber,
        serialNumber,
        deviceType,
        udn,
        presentationUrl,
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
        const modelDescription = (desc?.modelDescription || '').trim() || null
        const modelNumber = (desc?.modelNumber || '').trim() || null
        const serialNumber = (desc?.serialNumber || '').trim() || null
        const deviceType = (desc?.deviceType || '').trim() || null
        const udn = (desc?.udn || '').trim() || null
        const presentationUrl = desc?.presentationUrl || null
        const serviceTypes = Array.isArray(desc?.serviceTypes) ? desc.serviceTypes : []
        if (
            friendlyName || manufacturer || modelName || modelDescription ||
            modelNumber || serialNumber || deviceType || udn || presentationUrl ||
            serviceTypes.length || info.location || info.server || info.st || info.usn
        ) {
            out[ip] = {
                friendlyName,
                manufacturer,
                modelName,
                modelDescription,
                modelNumber,
                serialNumber,
                presentationUrl,
                ssdpDeviceType: deviceType,
                ssdpUdn: udn,
                serviceTypes,
                location: info.location || null,
                server: info.server || null,
                st: info.st || null,
                usn: info.usn || null,
            }
        }
    }
    return out
}

/** Resolve hostname for a single device using multiple strategies. */
async function resolveHostname(ip, options = {}) {
    const allowHeavy = options?.allowHeavy === true
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
    if (allowHeavy && process.platform === 'win32') {
        const pingName = normalizeResolvedHost(await withTimeout(pingResolveName(ip), 2500))
        if (pingName) return { hostname: pingName, nameSource: 'ptr' }
    }

    // 5. NetBIOS
    if (allowHeavy && process.platform === 'win32') {
        const nb = normalizeResolvedHost(await withTimeout(netbiosLookup(ip), 3500))
        if (nb) return { hostname: nb, nameSource: 'netbios' }
    }

    return { hostname: null, nameSource: 'unknown' }
}

function nameCandidateScore(name, source = 'unknown') {
    const clean = normalizeResolvedHost(name)
    if (!clean) return -Infinity

    const lower = clean.toLowerCase()
    let score = ({
        ssdp: 84,
        mdns: 78,
        netbios: 72,
        ptr: 62,
    })[source] || 50

    // Generic DNS/router labels are less useful than explicit SSDP/mDNS
    // friendly names such as "Living Room TV" or "HP LaserJet".
    if (lower.includes('.')) score -= 8
    if (/^(unknown|localhost|host|device|router|gateway)$/i.test(clean)) score -= 18
    if (/^(android|desktop|laptop|host|dhcp)[-_]?[a-z0-9]{4,}$/i.test(clean)) score -= 8
    if (/^[0-9a-f]{8,}$/i.test(clean.replace(/[-_:]/g, ''))) score -= 22
    if (/\d{1,3}[-_.]\d{1,3}[-_.]\d{1,3}[-_.]\d{1,3}/.test(lower)) score -= 25
    if (clean.length > 48) score -= Math.min(20, clean.length - 48)
    if (/\s/.test(clean)) score += 4
    return score
}

function pickBestName(candidates) {
    let best = null
    for (const candidate of candidates || []) {
        const hostname = normalizeResolvedHost(candidate?.hostname)
        if (!hostname) continue
        const source = candidate?.source || 'unknown'
        const score = nameCandidateScore(hostname, source)
        if (!best || score > best.score) best = { hostname, nameSource: source, score }
    }
    return best ? { hostname: best.hostname, nameSource: best.nameSource } : { hostname: null, nameSource: 'unknown' }
}

function compactDeviceModel(info) {
    if (!info) return null
    const manufacturer = String(info.manufacturer || '').trim()
    const modelName = String(info.modelName || '').trim()
    const modelNumber = String(info.modelNumber || '').trim()
    const pieces = []
    if (manufacturer) pieces.push(manufacturer)
    if (modelName && !pieces.some(p => p.toLowerCase() === modelName.toLowerCase())) pieces.push(modelName)
    if (
        modelNumber &&
        !pieces.some(p => p.toLowerCase() === modelNumber.toLowerCase()) &&
        !modelName.toLowerCase().includes(modelNumber.toLowerCase())
    ) pieces.push(modelNumber)
    return pieces.join(' ').replace(/\s+/g, ' ').trim() || null
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

function udpTouch(ip, port, settleMs = 360) {
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4')
        let done = false
        const finish = () => {
            if (done) return
            done = true
            clearTimeout(timer)
            try { socket.close() } catch { /* noop */ }
            resolve()
        }
        const timer = setTimeout(finish, settleMs)
        socket.once('error', finish)
        try {
            socket.send(Buffer.from([0]), port, ip, (err) => {
                if (err) finish()
            })
        } catch {
            finish()
        }
    })
}

async function preheatNeighborCache(targets) {
    if (!targets?.length) return
    // UDP touches force ARP resolution even for hosts that silently drop TCP.
    // Keep the socket alive briefly after send; resolving immediately can
    // close before Windows has time to settle the neighbor cache.
    const ports = [445, 80]
    await parallelMap(targets, async (ip) => {
        await Promise.all([
            udpTouch(ip, 9),
            udpTouch(ip, 137),
        ])
        // TCP touches still help classify machines with common open services.
        for (const port of ports) {
            await tcpTouch(ip, port, 220)
        }
    }, 48)
    await sleep(450)
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function pingHostOnce(ip, isWin, timeoutWin, timeoutUnix, activeSource = 'icmp') {
    const args = isWin
        ? ['-4', '-n', '1', '-w', String(timeoutWin), ip]
        : ['-c', '1', '-W', String(timeoutUnix), ip]

    return new Promise(resolve => {
        execFile('ping', args,
            { timeout: Math.max(2500, timeoutWin + 1000), windowsHide: true, encoding: 'utf8' },
            (err, stdout) => {
                const m = stdout && stdout.match(PING_TIME_RE)
                if (isPingReply(stdout)) {
                    return resolve({ ip, alive: true, time: m ? parseFloat(m[1]) : null, mac: null, activeSource })
                }
                resolve({ ip, alive: false })
            }
        )
    })
}

async function retryNeighborPing(ip, isWin, timeoutWin, timeoutUnix) {
    const first = await pingHostOnce(ip, isWin, timeoutWin, timeoutUnix, 'icmp-retry')
    if (first.alive) return first

    // Give Wi-Fi power-save clients a short wake window, but only for the
    // small neighbor-cache candidate set instead of every silent IP.
    await sleep(650)
    return pingHostOnce(ip, isWin, timeoutWin, timeoutUnix, 'icmp-retry')
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
            map[ip] = mergeNeighborEntry(map[ip], {
                mac,
                state: 'unknown',
                source: 'arp',
            })
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
                    const state = normalizeNeighborState(row?.State)
                    const mac = String(row?.LinkLayerAddress || '').trim().replace(/-/g, ':').toLowerCase()
                    if (!ip || !ip.startsWith(`${baseIP}.`)) continue
                    const last = parseInt(ip.split('.').pop(), 10)
                    if (isNaN(last) || last < rangeStart || last > rangeEnd) continue
                    if (!isUnicastMAC(mac)) continue
                    if (!isUsableNeighborState(state)) continue
                    map[ip] = mergeNeighborEntry(map[ip], {
                        mac,
                        state,
                        source: 'netneighbor',
                    })
                }
            }
        } catch { /* ignore */ }

        // Fallback for normal, non-elevated Windows sessions where the CIM
        // Get-NetNeighbor call can return Access denied. `netsh` exposes the
        // same table without elevation, localized state names included.
        try {
            const { err, out } = await run('netsh interface ipv4 show neighbors', 6500)
            if (!err && out) {
                for (const line of out.split(/\r?\n/)) {
                    const m = line.match(/^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+((?:[0-9a-f]{2}[-:]){5}[0-9a-f]{2})\s+(.+?)\s*$/i)
                    if (!m) continue
                    const ip = m[1]
                    const mac = m[2].replace(/-/g, ':').toLowerCase()
                    const state = normalizeNetshNeighborState(m[3])
                    if (!ip || !ip.startsWith(`${baseIP}.`)) continue
                    const last = parseInt(ip.split('.').pop(), 10)
                    if (isNaN(last) || last < rangeStart || last > rangeEnd) continue
                    if (!isUnicastMAC(mac)) continue
                    if (!isUsableNeighborState(state)) continue
                    map[ip] = mergeNeighborEntry(map[ip], {
                        mac,
                        state,
                        source: 'netsh',
                    })
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

ipcMain.handle('lan-scan', async (_, baseIP, rangeStart, rangeEnd, options = {}) => {
    // SECURITY: revalidate every value received from the renderer before
    // it ever reaches a shell. Even though preload narrows the API, an
    // XSS inside our own content would hand the renderer a bypass; these
    // validators are the last line. The old code interpolated `baseIP`
    // directly into `exec('ping ...')` which was a full RCE path.
    if (!validators.isSubnetBase(baseIP)) throw validators.invalidArg('baseIP', baseIP)
    if (!validators.isNonNegInt(rangeStart)) throw validators.invalidArg('rangeStart', rangeStart)
    if (!validators.isNonNegInt(rangeEnd)) throw validators.invalidArg('rangeEnd', rangeEnd)

    let results = []
    const isWin = process.platform === 'win32'
    const local = getLocalMAC()
    const localHostname = os.hostname()

    // Safe Scan mode: gentler profile for sensitive / legacy networks.
    // - Lower ping concurrency (4 vs 32)
    // - Longer per-ping timeout (2000 ms vs 1100 ms)
    // - Skip UDP/TCP neighbor-cache preheat
    // - Skip SSDP/mDNS multicast discovery
    const safeMode = options && options.safeMode === true
    const gatewayIp = normalizeGatewayHint(options?.gatewayIp, baseIP)
    const PING_CONCURRENCY = safeMode ? 4 : 32
    const PING_TIMEOUT_WIN = safeMode ? 2000 : 1100
    const PING_TIMEOUT_UNIX = safeMode ? 2 : 1  // seconds for -W on Unix

    // Clamp range (post-validation defence: even valid ints beyond 1-254
    // would produce invalid IPs, so we clamp here before composing).
    rangeStart = Math.max(1, Math.min(254, Number(rangeStart) || 1))
    rangeEnd = Math.max(rangeStart, Math.min(254, Number(rangeEnd) || 254))

    // Phase 1: Ping sweep (batches sized by mode)
    const targets = []
    for (let i = rangeStart; i <= rangeEnd; i++) {
        const ip = `${baseIP}.${i}`
        // Paranoid: validate each composed IP before pushing — catches
        // any unexpected interaction with `baseIP` content.
        if (validators.isIPv4(ip)) targets.push(ip)
    }
    for (let i = 0; i < targets.length; i += PING_CONCURRENCY) {
        const batch = targets.slice(i, i + PING_CONCURRENCY)
        const res = await Promise.all(batch.map(ip => pingHostOnce(
            ip,
            isWin,
            PING_TIMEOUT_WIN,
            PING_TIMEOUT_UNIX,
            'icmp',
        )))
        results.push(...res.filter(r => r.alive))
    }

    const byIp = new Map(results.map(r => [r.ip, r]))
    let neighborMap = {}

    // Phase 2: Warm neighbor cache on silent hosts with quick TCP touches.
    // Skipped in Safe Scan mode — Safe Scan stays strictly low-traffic.
    if (!safeMode) {
        const silentTargets = targets.filter(ip => !byIp.has(ip))
        await preheatNeighborCache(silentTargets)

        // Some Wi-Fi clients drop the first probe while waking from power
        // save, then respond immediately after traffic reaches the AP. Do
        // one extra ICMP pass over the same silent set in normal mode only.
        // This is intentionally much cheaper than the old all-host 3s retry:
        // current renderer batches are <=30 IPs, so this adds at most one
        // lightweight ping wave per batch.
        if (silentTargets.length) {
            const wakeRes = await parallelMap(silentTargets, ip => pingHostOnce(
                ip,
                isWin,
                Math.max(PING_TIMEOUT_WIN, 1400),
                PING_TIMEOUT_UNIX,
                'icmp-wake',
            ), PING_CONCURRENCY)
            for (const r of wakeRes.filter(r => r.alive)) byIp.set(r.ip, r)
        }
    }

    // Phase 2.5: Targeted wake/confirm pass. The previous implementation
    // retried every silent address with a 3s timeout and concurrency 4,
    // which made a normal /24 take minutes. We now consult the OS neighbor
    // table first and only retry IPs with L2 evidence.
    try {
        neighborMap = await collectNeighborMap(baseIP, rangeStart, rangeEnd)
    } catch { /* neighbor collection failed */ }

    const retryTargets = Object.entries(neighborMap)
        .filter(([ip, neighbor]) => !byIp.has(ip) && shouldRetryNeighbor(neighbor))
        .map(([ip]) => ip)

    if (retryTargets.length) {
        const RETRY_CONCURRENCY = safeMode ? 6 : 12
        const RETRY_TIMEOUT_WIN = safeMode ? 1600 : 900
        const RETRY_TIMEOUT_UNIX = safeMode ? 2 : 1
        for (let i = 0; i < retryTargets.length; i += RETRY_CONCURRENCY) {
            const batch = retryTargets.slice(i, i + RETRY_CONCURRENCY)
            const res = await Promise.all(batch.map(ip => retryNeighborPing(
                ip,
                isWin,
                RETRY_TIMEOUT_WIN,
                RETRY_TIMEOUT_UNIX,
            )))
            for (const r of res.filter(r => r.alive)) byIp.set(r.ip, r)
        }
    }

    // Phase 3: Enrich using ARP + OS neighbor table and include silent neighbors.
    // Runs even in Safe Scan — it's a local system call with no network traffic.
    try {
        const refreshed = await collectNeighborMap(baseIP, rangeStart, rangeEnd)
        for (const [ip, neighbor] of Object.entries(refreshed)) {
            neighborMap[ip] = mergeNeighborEntry(neighborMap[ip], neighbor)
        }
        for (const [ip, neighbor] of Object.entries(neighborMap)) {
            if (byIp.has(ip)) {
                const existing = byIp.get(ip)
                existing.mac = neighbor.mac
                existing.neighborState = neighbor.state
                existing.neighborSource = neighbor.source
            } else {
                byIp.set(ip, {
                    ip,
                    alive: false,
                    time: null,
                    mac: neighbor.mac,
                    seenOnly: true,
                    presenceHint: 'cached',
                    neighborState: neighbor.state,
                    neighborSource: neighbor.source,
                })
            }
        }
    } catch { /* neighbor enrichment failed */ }

    // Phase 4: Discovery intel via multicast (SSDP + mDNS).
    // Skipped in Safe Scan mode — multicast can be noisy on legacy switches.
    const [ssdpByIp, mdnsByIp] = safeMode
        ? [{}, {}]
        : await Promise.all([
            withTimeout(collectSsdpInfoCached(baseIP, rangeStart, rangeEnd), 4300, {}),
            withTimeout(collectMdnsInfoCached(baseIP, rangeStart, rangeEnd), 2400, {}),
        ])

    const addActiveDiscoveryHit = (ip, source) => {
        if (!validators.isIPv4(ip) || !ipInRange(ip, baseIP, rangeStart, rangeEnd)) return
        const neighbor = neighborMap[ip] || null
        if (byIp.has(ip)) {
            const existing = byIp.get(ip)
            existing.activeSource = source
            existing.discoveryOnly = true
            existing.presenceHint = null
            if (!existing.alive) {
                existing.alive = true
                existing.seenOnly = false
            }
            return
        }
        byIp.set(ip, {
            ip,
            alive: true,
            time: null,
            mac: neighbor?.mac || null,
            seenOnly: false,
            discoveryOnly: true,
            activeSource: source,
            neighborState: neighbor?.state || null,
            neighborSource: neighbor?.source || null,
        })
    }

    for (const ip of Object.keys(ssdpByIp || {})) addActiveDiscoveryHit(ip, 'ssdp')
    for (const ip of Object.keys(mdnsByIp || {})) addActiveDiscoveryHit(ip, 'mdns')

    results = Array.from(byIp.values())
    if (results.length === 0) return results

    // Phase 5: Parallel name resolution + vendor lookup (concurrency = 8)
    await parallelMap(results, async (r) => {
        // Classification flags first (used by vendor and display fallbacks)
        const lastOctet = parseInt(r.ip.split('.').pop())
        r.isGateway = gatewayIp
            ? r.ip === gatewayIp
            : (lastOctet === 1 || lastOctet === 254)
        r.isLocal = r.ip === local.ip || (r.mac && local.mac && r.mac === local.mac)
        r.isRandomized = isRandomizedMAC(r.mac) && !r.isLocal
        r.macEmpty = isEmptyMAC(r.mac)
        r.seenOnly = !!r.seenOnly || !r.alive

        // Hostname resolution
        const ssdp = ssdpByIp[r.ip]
        const mdns = mdnsByIp[r.ip]
        const ptr = await resolveHostname(r.ip, { allowHeavy: false })
        const { hostname, nameSource } = pickBestName([
            { hostname: ssdp?.friendlyName, source: 'ssdp' },
            { hostname: mdns?.hostname, source: 'mdns' },
            { hostname: ptr?.hostname, source: ptr?.nameSource || 'ptr' },
        ])
        r.hostname = hostname
        r.nameSource = nameSource

        r.modelName = ssdp?.modelName || null
        r.modelDescription = ssdp?.modelDescription || null
        r.modelNumber = ssdp?.modelNumber || null
        r.serialNumber = ssdp?.serialNumber || null
        r.presentationUrl = ssdp?.presentationUrl || null
        r.ssdpDeviceType = ssdp?.ssdpDeviceType || null
        r.ssdpUdn = ssdp?.ssdpUdn || null
        r.serviceTypes = Array.isArray(ssdp?.serviceTypes) ? ssdp.serviceTypes : []
        r.ssdpServer = ssdp?.server || null
        r.discoverySources = [
            r.activeSource,
            mdns?.hostname ? 'mdns' : null,
            (ssdp?.friendlyName || ssdp?.modelName || r.serviceTypes.length) ? 'ssdp' : null,
        ].filter(Boolean)

        // Vendor from local OUI DB, with online fallback for unknown non-randomized MACs
        let { vendor, vendorSource } = await resolveVendor(r.mac, r.isRandomized || r.macEmpty)
        if ((!vendor || vendorSource === 'unknown') && ssdp?.manufacturer) {
            vendor = ssdp.manufacturer
            vendorSource = 'ssdp'
        }
        r.vendor = vendor || null
        r.vendorSource = vendorSource || 'unknown'

        // Role-aware display fallback to reduce Unknown Device labels.
        const modelLabel = compactDeviceModel(ssdp)
        if (hostname) r.displayName = hostname
        else if (modelLabel) r.displayName = modelLabel
        else if (vendor) r.displayName = vendor
        else if (r.isLocal) r.displayName = localHostname || 'This Device'
        else if (r.isGateway) r.displayName = 'Gateway'
        else if (r.isRandomized) r.displayName = 'Network Device'
        else if (r.mac && !r.macEmpty) r.displayName = 'Network Device'
        else r.displayName = null
    }, 8)

    // Proxy-ARP ghost filter. See electron/scanner/ghostFilter.js for
    // the deterministic Rule A + Rule B specification. Keeping it as a
    // pure module makes the logic unit-testable without touching Electron.
    results = filterGhosts(results)

    results.sort((a, b) => {
        const av = parseInt((a.ip || '').split('.').pop(), 10)
        const bv = parseInt((b.ip || '').split('.').pop(), 10)
        return (isNaN(av) ? 999 : av) - (isNaN(bv) ? 999 : bv)
    })

    return results
})

ipcMain.handle('lan-scan-enrich', async (_, payload = {}) => {
    const items = Array.isArray(payload?.devices) ? payload.devices : []
    if (!items.length) return []

    const enriched = await parallelMap(items, async (item) => {
        const ip = String(item?.ip || '').trim()
        // SECURITY: reject anything that is not a pure IPv4 literal before
        // it propagates into pingResolveName / netbiosLookup / nslookup.
        if (!validators.isIPv4(ip)) return null

        const existingHost = normalizeResolvedHost(item?.hostname)
        const hasHostname = !!existingHost
        const isRandomized = !!item?.isRandomized
        const macEmpty = !!item?.macEmpty
        const isLocal = !!item?.isLocal
        let hostname = null
        let nameSource = null
        let vendor = null
        let vendorSource = null

        // Heavy host naming fallback only when still unnamed. Reuse the same
        // resolver as the main scan so PTR/nslookup/lookupService, ping -a
        // and NetBIOS stay in one pipeline.
        if (!hasHostname) {
            const resolved = await withTimeout(
                resolveHostname(ip, { allowHeavy: true }),
                process.platform === 'win32' ? 6500 : 3500,
                { hostname: null, nameSource: 'unknown' },
            )
            hostname = normalizeResolvedHost(resolved?.hostname)
            nameSource = hostname ? (resolved?.nameSource || 'ptr') : null
        }

        // Retry vendor fallback for unknown devices (skip randomized/private MACs).
        if (!item?.vendor && item?.mac && !isRandomized && !macEmpty) {
            const vendorResolved = await resolveVendor(item.mac, false)
            if (vendorResolved?.vendor) {
                vendor = vendorResolved.vendor
                vendorSource = vendorResolved.vendorSource
            }
        }

        if (!hostname && !vendor) return null
        return {
            ip,
            hostname,
            nameSource,
            vendor,
            vendorSource,
            displayName: hostname || vendor || (isLocal ? os.hostname() : null),
        }
    }, 6)

    return enriched.filter(Boolean)
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
            modelDescription: description?.modelDescription || null,
            modelNumber: description?.modelNumber || null,
            serialNumber: description?.serialNumber || null,
            presentationUrl: description?.presentationUrl || null,
            ssdpDeviceType: description?.deviceType || null,
            ssdpUdn: description?.udn || null,
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

// -- Speed test cancellation controller --------------------
let speedTestCtrl = null
function newSpeedTestCtrl() {
    speedTestCtrl = { cancelled: false, closers: [] }
    return speedTestCtrl
}
function registerSpeedCloser(ctrl, fn) {
    if (!ctrl || ctrl.cancelled) { try { fn() } catch { /* noop */ } return }
    ctrl.closers.push(fn)
}
function cancelSpeedTest() {
    const ctrl = speedTestCtrl
    if (!ctrl || ctrl.cancelled) return
    ctrl.cancelled = true
    for (const fn of ctrl.closers) { try { fn() } catch { /* noop */ } }
    ctrl.closers.length = 0
}
ipcMain.on('stop-speed-test', () => cancelSpeedTest())

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
function ndt7Download(send, downloadUrl, ctrl) {
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
        registerSpeedCloser(ctrl, () => { try { ws.terminate() } catch { /* noop */ } })

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
function ndt7Upload(send, uploadUrl, ctrl) {
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
        registerSpeedCloser(ctrl, () => { try { ws.terminate() } catch { /* noop */ } })

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
async function runNdt7Test(send, ctrl) {
    const abortIfCancelled = () => {
        if (ctrl?.cancelled) {
            send('speed-progress', { phase: 'cancelled', message: 'Test cancelled' })
            return true
        }
        return false
    }

    // Discover server
    send('speed-progress', { phase: 'init', message: 'Discovering M-Lab server...' })
    let located
    try {
        located = await ndt7Locate()
    } catch (e) {
        send('speed-progress', { phase: 'error', message: 'Could not find M-Lab server' })
        return { error: 'M-Lab locate failed: ' + e.message }
    }
    if (abortIfCancelled()) return { error: 'cancelled' }

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
        if (abortIfCancelled()) return { error: 'cancelled' }
        const t0 = Date.now()
        await new Promise(r => {
            const sock = net.createConnection({ host: pingTarget, port: 443, timeout: 3000 }, () => {
                sock.destroy()
                r()
            })
            registerSpeedCloser(ctrl, () => { try { sock.destroy() } catch { /* noop */ } })
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

    if (abortIfCancelled()) return { error: 'cancelled' }

    // Download via WebSocket
    send('speed-progress', { phase: 'download-start' })
    const dlResult = await ndt7Download(send, located.downloadUrl, ctrl)
    if (ctrl?.cancelled) { send('speed-progress', { phase: 'cancelled', message: 'Test cancelled' }); return { error: 'cancelled' } }
    if (dlResult.error) {
        send('speed-progress', { phase: 'error', message: 'NDT7 download failed' })
        return { error: 'NDT7 download failed' }
    }
    send('speed-progress', { phase: 'download-done', speed: dlResult.speedMbps })

    await new Promise(r => setTimeout(r, 600))
    if (abortIfCancelled()) return { error: 'cancelled' }

    // Upload via WebSocket
    send('speed-progress', { phase: 'upload-start' })
    const ulResult = await ndt7Upload(send, located.uploadUrl, ctrl)
    if (ctrl?.cancelled) { send('speed-progress', { phase: 'cancelled', message: 'Test cancelled' }); return { error: 'cancelled' } }
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
function runCalibrationProbe(server, ctrl) {
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
        registerSpeedCloser(ctrl, finish)
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

    const ctrl = newSpeedTestCtrl()
    const abortIfCancelled = () => {
        if (ctrl.cancelled) {
            send('speed-progress', { phase: 'cancelled', message: 'Test cancelled' })
            return true
        }
        return false
    }

    const server = getSpeedServer(serverId)

    // -- NDT7 branch: entirely different protocol --
    if (server.ndt7) return runNdt7Test(send, ctrl)

    const SERVER_INFO = { name: server.name, location: server.location, host: server.id, sponsor: server.sponsor }

    // Phase 0: Init & Latency
    send('speed-progress', { phase: 'init', message: 'Finding best server...' })

    const serverPings = []
    const pingUrl = server.pingUrl || server.getDownloadUrl(1)
    for (let i = 0; i < 5; i++) {
        if (abortIfCancelled()) return { error: 'cancelled' }
        const t0 = Date.now()
        await new Promise(r => {
            const req = https.get(pingUrl, res => { res.resume(); res.on('end', r) })
            registerSpeedCloser(ctrl, () => { try { req.destroy() } catch { /* noop */ } })
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
    if (abortIfCancelled()) return { error: 'cancelled' }

    // Phase 1: Calibration probe
    send('speed-progress', { phase: 'calibrating', message: 'Calibrating...' })
    const probe = await runCalibrationProbe(server, ctrl)
    if (abortIfCancelled()) return { error: 'cancelled' }
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
    const dlResult = await runDownloadTest(send, server, dlTargetBytes, ctrl)
    if (abortIfCancelled()) return { error: 'cancelled' }
    if (dlResult.error) {
        send('speed-progress', { phase: 'error', message: 'Download test failed' })
        return { error: 'Download failed' }
    }
    send('speed-progress', { phase: 'download-done', speed: dlResult.speedMbps })

    const smartUlBytes = calcUploadBytes(dlResult.speedMbps)
    await new Promise(r => setTimeout(r, 600))
    if (abortIfCancelled()) return { error: 'cancelled' }

    // Phase 3: Upload
    send('speed-progress', { phase: 'upload-start' })
    const ulResult = await runUploadTest(send, server, smartUlBytes, ctrl)
    if (abortIfCancelled()) return { error: 'cancelled' }
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
function runDownloadTest(send, server, targetBytes, ctrl) {
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
                if (ctrl?.cancelled) { finish(); return }

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
        registerSpeedCloser(ctrl, finish)
        req.on('error', () => { if (!done) resolve({ error: true }) })
        req.setTimeout(45000, () => { req.destroy(); if (!done) resolve({ error: true }) })
    })
}

/** Adaptive upload test with live progress */
function runUploadTest(send, server, targetBytes, ctrl) {
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
        registerSpeedCloser(ctrl, () => { try { req.destroy() } catch { /* noop */ } })

        const CHUNK = 64 * 1024
        let offset = 0

        function writeNext() {
            if (ctrl?.cancelled) { try { req.destroy() } catch { /* noop */ } return }
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

const tracerouteProcesses = new Map()
const pingLiveProcesses = new Map()
const PROBE_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const PROBE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024

/**
 * Return true when the given hostname resolves (syntactically) to a
 * private / loopback / link-local target. Used by the WAN probe to
 * block SSRF by default: the probe is meant to reach the public WAN,
 * not any local service.
 *
 * We intentionally check the literal form — we don't resolve DNS. The
 * probe will fail if the hostname resolves to a private range at runtime
 * but syntactically looks public; that's acceptable (fail closed with a
 * clear error) and avoids DNS-rebinding races between check and request.
 */
function isPrivateHost(hostname) {
    if (!hostname) return true
    const h = String(hostname).toLowerCase()
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true
    // IPv6 loopback / link-local / unique-local.
    if (h === '::1') return true
    if (h.startsWith('[fc') || h.startsWith('[fd') || h.startsWith('fc') || h.startsWith('fd')) return true
    if (h.startsWith('[fe80') || h.startsWith('fe80')) return true
    // IPv4 literal ranges.
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (!m) return false
    const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)]
    if (a === 10) return true                                   // 10/8
    if (a === 127) return true                                  // loopback
    if (a === 0) return true                                    // 0/8
    if (a === 169 && b === 254) return true                     // link-local
    if (a === 172 && b >= 16 && b <= 31) return true            // 172.16/12
    if (a === 192 && b === 168) return true                     // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true           // 100.64/10 carrier-grade NAT
    if (a >= 224) return true                                   // multicast / reserved
    return false
}

function stopTrackedProcess(processMap, senderId) {
    const proc = processMap.get(senderId)
    if (!proc) return
    try {
        proc.kill()
    } catch {
        // Child may already be gone.
    }
    processMap.delete(senderId)
}

function bindTrackedProcess(processMap, senderId, proc) {
    stopTrackedProcess(processMap, senderId)
    processMap.set(senderId, proc)
    proc.once('close', () => {
        if (processMap.get(senderId) === proc) processMap.delete(senderId)
    })
    proc.once('error', () => {
        if (processMap.get(senderId) === proc) processMap.delete(senderId)
    })
}

function stopAllTrackedProcesses() {
    for (const senderId of [...tracerouteProcesses.keys()]) {
        stopTrackedProcess(tracerouteProcesses, senderId)
    }
    for (const senderId of [...pingLiveProcesses.keys()]) {
        stopTrackedProcess(pingLiveProcesses, senderId)
    }
}

function sanitizeProbeHeaders(headers) {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {}
    const safeHeaders = {}
    for (const [rawKey, rawValue] of Object.entries(headers)) {
        const key = String(rawKey || '').trim()
        if (!key || /[^A-Za-z0-9-]/.test(key)) continue
        if (rawValue == null) continue
        const value = Array.isArray(rawValue)
            ? rawValue.map(item => String(item).replace(/[\r\n]+/g, ' ').trim()).join(', ')
            : String(rawValue).replace(/[\r\n]+/g, ' ').trim()
        if (!value) continue
        safeHeaders[key] = value
    }
    return safeHeaders
}

function normalizeProbeRequestBody(body) {
    if (body == null) return null
    if (typeof body === 'string' || Buffer.isBuffer(body)) return body
    if (typeof body === 'object') return JSON.stringify(body)
    return String(body)
}

// ── Live Traceroute ───────────────────────────────────
ipcMain.on('start-traceroute', (event, rawHost) => {
    const host = sanitizeHost(rawHost)
    if (!host) { event.sender.send('traceroute:done'); return }
    const isWin = process.platform === 'win32'
    const senderId = event.sender.id
    // -4 forces IPv4 so we always get dotted IPs (systems with IPv6 default to v6)
    const cmd = isWin ? 'tracert' : 'traceroute'
    const args = isWin
        ? ['-4', '-d', '-h', '30', '-w', '2000', host]
        : ['-4', '-m', '30', '-n', '-q', '1', host]
    const proc = spawn(cmd, args, { shell: false, windowsHide: true })
    bindTrackedProcess(tracerouteProcesses, senderId, proc)
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
    event.sender.once('destroyed', () => stopTrackedProcess(tracerouteProcesses, senderId))
})

ipcMain.on('stop-traceroute', (event) => {
    stopTrackedProcess(tracerouteProcesses, event.sender.id)
})

// ── Live Ping (per-packet) ────────────────────────────
ipcMain.on('start-ping-live', (event, rawHost, count = 10) => {
    const host = sanitizeHost(rawHost)
    if (!host) { event.sender.send('ping:done', { seqNum: 0 }); return }
    const isWin = process.platform === 'win32'
    const senderId = event.sender.id
    const cmd = isWin ? 'ping' : 'ping'
    const args = isWin
        ? ['-4', '-n', String(count), host]
        : ['-c', String(count), host]
    const proc = spawn(cmd, args, { shell: false, windowsHide: true })
    bindTrackedProcess(pingLiveProcesses, senderId, proc)
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
    event.sender.once('destroyed', () => stopTrackedProcess(pingLiveProcesses, senderId))
})

ipcMain.on('stop-ping-live', (event) => {
    stopTrackedProcess(pingLiveProcesses, event.sender.id)
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

ipcMain.handle('wan-probe-history-get', () => database.wanProbeHistoryGetAll())
ipcMain.handle('wan-probe-history-add', (_, entry) => database.wanProbeHistoryAdd(entry))
ipcMain.handle('wan-probe-history-delete', (_, id) => database.wanProbeHistoryDelete(id))
ipcMain.handle('wan-probe-history-clear', () => database.wanProbeHistoryClear())

// Report exports (PDF / CSV)
ipcMain.handle('report-export', (_, kind, format, payload) =>
    reports.exportReport(kind, format, payload)
)
ipcMain.handle('report-reveal', (_, filePath) => {
    // SECURITY: reveal is only permitted for paths we ourselves
    // exported in this session (see reports/save.js for the whitelist,
    // which uses path.resolve + fs.realpathSync + fs.existsSync to
    // canonicalise before consulting the allowed set). We also return
    // the library's boolean so the renderer can surface a failure toast
    // when the path was rejected.
    return reports.revealInFolder(filePath)
})

// Device snapshots (LAN scan change tracking)
ipcMain.handle('device-snapshot-add', (_, baseIP, devices) =>
    database.deviceSnapshotAdd(baseIP, devices)
)
ipcMain.handle('device-snapshot-latest', (_, baseIP, beforeTs) =>
    database.deviceSnapshotLatest(baseIP, beforeTs)
)
ipcMain.handle('device-snapshot-list', (_, baseIP, limit) =>
    database.deviceSnapshotList(baseIP, limit)
)
ipcMain.handle('device-snapshot-get', (_, id) =>
    database.deviceSnapshotGet(id)
)
ipcMain.handle('device-snapshot-clear', (_, baseIP) =>
    database.deviceSnapshotClear(baseIP)
)

// Device inventory (persistent known-device registry, scoped per NETWORK).
// Callers pass a `networkId` derived from the gateway's MAC (preferred)
// or the subnet (fallback). See deriveNetworkId() in Scanner.jsx.
ipcMain.handle('device-inventory-list', (_, networkId) =>
    database.deviceInventoryList(networkId)
)
ipcMain.handle('device-inventory-get', (_, deviceKey) =>
    database.deviceInventoryGet(deviceKey)
)
ipcMain.handle('device-inventory-merge', (_, networkId, baseIP, devices) =>
    database.deviceInventoryMergeScan(networkId, baseIP, devices)
)
ipcMain.handle('device-inventory-update', (_, deviceKey, patch) =>
    database.deviceInventoryUpdateMeta(deviceKey, patch)
)
ipcMain.handle('device-inventory-remove', (_, deviceKey) =>
    database.deviceInventoryRemove(deviceKey)
)
ipcMain.handle('device-inventory-clear', (_, networkId) =>
    database.deviceInventoryClear(networkId)
)
ipcMain.handle('device-inventory-purge-ghosts', (_, networkId, seenKeys, scanCoveredFullRange, gatewayDeviceKey) =>
    database.deviceInventoryPurgeGhosts(networkId, seenKeys, scanCoveredFullRange, gatewayDeviceKey)
)

// Config (key/value)
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

function isSensitiveRendererConfigKey(key) {
    return Boolean(database.isSensitiveConfigKey?.(key))
}

ipcMain.handle('config-get', (_, key) => {
    if (isSensitiveRendererConfigKey(key)) return null
    return database.configGet(key)
})

// One-shot query: did the DB layer recover from corruption on startup?
// Returns true once (on first read), false afterwards. UI uses this to
// show a warning toast when the inventory was reset.
ipcMain.handle('db-recovery-flag', () => database.consumeRecoveryFlag())
ipcMain.handle('config-set', (_, key, value) => {
    if (isSensitiveRendererConfigKey(key)) return false
    database.configSet(key, value)
    return true
})
ipcMain.handle('config-get-all', (_, keys) => database.configGetPublic(keys))
ipcMain.handle('config-delete', (_, key) => {
    if (isSensitiveRendererConfigKey(key)) return false
    database.configDelete(key)
    return true
})
ipcMain.handle('wan-probe-config-get', () => {
    const output = {}
    for (const key of WAN_PROBE_CONFIG_KEYS) {
        const value = database.configGet(key)
        if (value !== null) output[key] = value
    }
    return output
})
ipcMain.handle('wan-probe-config-set', (_, payload = {}) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
    for (const key of WAN_PROBE_CONFIG_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) continue
        database.configSet(key, payload[key])
    }
    return true
})

// ======================================================
//   WAN PROBE - HTTP proxy for remote probe service
// ======================================================
//
// Security policy:
//   - Only HTTPS by default. HTTP requires explicit opt-in (allowHttp)
//     — prevents accidental credential leakage over cleartext.
//   - Certificate verification ON by default. `allowInsecure` must be
//     explicitly `true` to disable (opt-in).
//   - Private / loopback / link-local targets blocked by default —
//     prevents SSRF from a compromised renderer hitting internal
//     services. `allowPrivate: true` opts in.
//   - HTTP methods restricted to the standard verbs; custom methods
//     rejected.
//   - Request body / headers size-limited (see sanitizeProbeHeaders).
//
// Each policy is strict-by-default; the renderer must explicitly
// acknowledge any relaxation per request.
ipcMain.handle('wan-probe-request', async (_, opts) => {
    const url = typeof opts?.url === 'string' ? opts.url.trim() : ''
    if (!validators.isHttpUrl(url)) return { error: 'Invalid URL' }

    let parsed
    try {
        parsed = new URL(url)
    } catch {
        return { error: 'Invalid URL' }
    }

    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== 'http:' && protocol !== 'https:') {
        return { error: 'Unsupported protocol' }
    }

    // HTTPS-first policy. HTTP needs explicit allowHttp=true.
    if (protocol === 'http:' && opts?.allowHttp !== true) {
        return { error: 'Plain HTTP blocked. Use HTTPS or set allowHttp=true.' }
    }

    // Block private / loopback / link-local unless caller opts in.
    if (!opts?.allowPrivate && isPrivateHost(parsed.hostname)) {
        return { error: 'Private/loopback target blocked. Set allowPrivate=true to override.' }
    }

    const rawMethod = String(opts?.method || 'GET').trim().toUpperCase()
    if (!validators.isAllowedHttpMethod(rawMethod) || !PROBE_HTTP_METHODS.has(rawMethod)) {
        return { error: 'Unsupported HTTP method' }
    }
    const method = rawMethod

    const headers = sanitizeProbeHeaders(opts?.headers)
    const body = normalizeProbeRequestBody(opts?.body)
    const isHttps = protocol === 'https:'
    // Strict TLS by default — only skip verification if renderer
    // explicitly opts in. Legacy default was the opposite (insecure-ok)
    // which made MITM silent on any HTTPS probe.
    const allowInsecure = opts?.allowInsecure === true
    const lib = isHttps ? require('https') : require('http')

    return new Promise(resolve => {
        let settled = false
        const finish = (payload) => {
            if (settled) return
            settled = true
            resolve(payload)
        }
        const reqOpts = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method,
            headers,
            timeout: 15000,
            rejectUnauthorized: !allowInsecure,
        }
        const req = lib.request(reqOpts, res => {
            let data = ''
            let size = 0
            res.on('data', chunk => {
                size += chunk.length
                if (size > PROBE_MAX_RESPONSE_BYTES) {
                    req.destroy(new Error('Response too large'))
                    return
                }
                data += chunk.toString('utf8')
            })
            res.on('end', () => {
                try {
                    finish({ status: res.statusCode, statusText: res.statusMessage, data: JSON.parse(data) })
                } catch {
                    finish({ status: res.statusCode, statusText: res.statusMessage, data })
                }
            })
        })
        req.on('error', err => finish({ error: err.message }))
        req.on('timeout', () => { req.destroy(); finish({ error: 'Request timed out' }) })
        if (body) req.write(body)
        req.end()
    })
})
