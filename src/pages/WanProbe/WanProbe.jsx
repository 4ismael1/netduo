import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
    AlertCircle,
    Check,
    CheckCheck,
    CheckCircle,
    Clock,
    Copy,
    Eye,
    EyeOff,
    Github,
    Globe,
    History,
    Info,
    KeyRound,
    Loader2,
    Lock,
    Play,
    Plus,
    Plug,
    Radar,
    RefreshCw,
    RotateCcw,
    Search,
    Server,
    Shield,
    ShieldAlert,
    ShieldCheck,
    SlidersHorizontal,
    Sparkles,
    Target,
    Trash2,
    Unplug,
    Wifi,
    X,
    Zap,
} from 'lucide-react'
import ExportMenu from '../../components/ExportMenu/ExportMenu'
import bridge from '../../lib/electronBridge'
import { logBridgeWarning } from '../../lib/devLog.js'
import './WanProbe.css'

const TOKEN_PREFIX = 'NDUO_PROBE_V1:'
const AGENT_GITHUB_URL = 'https://github.com/4ismael1/netduo-wan-probe'
const VALID_SCAN_MODES = new Set(['quick', 'advanced', 'deep'])
const VALID_SCAN_SCOPES = new Set(['preset', 'custom'])
const VALID_SCAN_PROFILES = new Set(['safe', 'balanced', 'aggressive'])
const VALID_SCAN_TRANSPORTS = new Set(['tcp', 'udp', 'both', 'auto'])
const VALID_JOB_STATUSES = new Set(['queued', 'running', 'done', 'error'])
const VALID_PHASES = new Set(['connect', 'queued', 'tcp_sweep', 'udp_sweep', 'service_probe', 'analysis', 'done', 'error'])

const MIN_VISUAL_DURATION_MS = { quick: 12000, advanced: 22000, deep: 32000 }
const EXPECTED_VISUAL_DURATION_MS = { quick: 17000, advanced: 32000, deep: 48000 }
const REPORT_PAGE_SIZE = 10
const APP_LANGUAGE = 'en'

const QUICK_MODE_PORTS = [
    21, 22, 23, 25, 53, 67, 68, 69, 80, 81, 88, 110, 123, 135, 137, 138, 139,
    143, 389, 443, 445, 465, 587, 993, 995, 1080, 1723, 1900, 5000, 5351, 554,
    7547, 8080, 8081, 8443, 8888, 9000, 10000, 32764,
]

const ADVANCED_MODE_PORTS = [
    1, 7, 9, 13, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 49, 53, 67, 68, 69,
    70, 79, 80, 81, 82, 83, 84, 85, 88, 89, 90, 99, 100, 106, 109, 110, 111,
    113, 119, 123, 135, 137, 138, 139, 143, 161, 162, 179, 389, 427, 443, 444,
    445, 465, 500, 502, 512, 513, 514, 515, 548, 554, 587, 631, 636, 646, 873,
    902, 989, 990, 993, 995, 1025, 1026, 1080, 1099, 1110, 1194, 1352, 1433,
    1434, 1521, 1720, 1723, 1812, 1900, 1935, 2000, 2049, 2082, 2083, 2086,
    2087, 2375, 2376, 2483, 2484, 25565, 3000, 3128, 3268, 3306, 3389, 4000,
    4443, 4444, 4567, 5000, 5001, 5060, 5061, 5351, 5432, 5601, 5631, 5632,
    5900, 5985, 5986, 6379, 6443, 6667, 7001, 7002, 7080, 7443, 7547, 7681,
    7777, 8000, 8008, 8010, 8080, 8081, 8088, 8090, 8443, 8888, 9000, 9090,
    9200, 9443, 10000, 11211, 15672, 27017, 32764, 49152, 49153, 49154,
]

const QUICK_UDP_MODE_PORTS = [
    53, 67, 68, 69, 123, 137, 138, 161, 500, 514, 1194, 1434, 1701, 1812, 1900,
    4500, 5004, 5060, 5351,
]

const ADVANCED_UDP_MODE_PORTS = [
    19, 53, 67, 68, 69, 111, 123, 137, 138, 161, 162, 389, 427, 500, 514, 520,
    623, 631, 1194, 1434, 1701, 1812, 1900, 2049, 3478, 3702, 4500, 5004, 5060,
    5061, 5351, 5353, 5683, 10000, 17185, 27015, 33434,
]

function buildDeepUdpModePortsFallback() {
    const set = new Set()
    for (let p = 1; p <= 1024; p += 1) set.add(p)
    const highValue = [
        1194, 1434, 1701, 1812, 1900, 3478, 3702, 4500, 5004, 5060, 5061, 5349,
        5351, 5353, 5683, 10000, 17185, 27015, 3074, 33434,
    ]
    for (const port of highValue) set.add(port)
    return [...set].sort((a, b) => a - b)
}

const DEEP_UDP_MODE_PORTS = buildDeepUdpModePortsFallback()

function buildDeepModePortsFallback() {
    const set = new Set()
    for (let p = 1; p <= 2048; p += 1) set.add(p)

    const highValue = [
        1080, 1194, 1433, 1434, 1521, 1720, 1901, 2000, 2049, 2375, 2376, 25565,
        3000, 3128, 3306, 3389, 4000, 4443, 4444, 4567, 5000, 5001, 5060, 5061,
        5351, 5432, 5900, 5985, 5986, 6379, 6443, 7001, 7002, 7080, 7443, 7547,
        7681, 7777, 8000, 8008, 8010, 8080, 8081, 8088, 8090, 8443, 8888, 9000,
        9090, 9200, 9443, 10000, 11211, 15672, 27017, 49152, 49153, 49154, 49155,
    ]
    for (const port of highValue) set.add(port)
    return [...set].sort((a, b) => a - b)
}

const DEEP_MODE_PORTS = buildDeepModePortsFallback()

const MODE_PRESETS = {
    quick: {
        title: 'Quick',
        eta: '10s - 30s',
        description: 'Critical remote-management exposure audit.',
        portsFallback: QUICK_MODE_PORTS,
    },
    advanced: {
        title: 'Advanced',
        eta: '25s - 70s',
        description: 'Broader internet exposure plus service fingerprinting.',
        portsFallback: ADVANCED_MODE_PORTS,
    },
    deep: {
        title: 'Deep',
        eta: '45s - 150s',
        description: 'High-coverage WAN audit with detailed evidence collection.',
        portsFallback: DEEP_MODE_PORTS,
    },
}

const TRANSPORT_PRESETS = {
    auto: {
        title: 'Auto',
        description: 'Default safe mode. Always resolves to TCP.',
    },
    tcp: {
        title: 'TCP only',
        description: 'Best reliability and fastest deterministic results.',
    },
    udp: {
        title: 'UDP only',
        description: 'Checks UDP exposure. Some ports can appear as open|filtered.',
    },
    both: {
        title: 'TCP + UDP',
        description: 'Maximum WAN coverage with higher runtime cost.',
    },
}

const PROFILE_PRESETS = {
    safe: { title: 'Safe', description: 'Lower concurrency, less intrusive, more conservative timing.' },
    balanced: { title: 'Balanced', description: 'Recommended. Good depth and stable runtime.' },
    aggressive: { title: 'Aggressive', description: 'Higher concurrency and faster turnaround.' },
}

const PHASE_STEPS = [
    { key: 'connect', label: 'Handshake', description: 'Service reachability and auth validation.' },
    { key: 'queued', label: 'Queue', description: 'Probe accepted request and prepared scan job.' },
    { key: 'tcp_sweep', label: 'TCP Sweep', description: 'WAN TCP checks across selected scope.' },
    { key: 'udp_sweep', label: 'UDP Sweep', description: 'WAN UDP checks for exposure and reachability.' },
    { key: 'service_probe', label: 'Service Probe', description: 'HTTP/TLS/banner fingerprinting on exposed services.' },
    { key: 'analysis', label: 'Analysis', description: 'Risk model, findings, confidence and impact scoring.' },
    { key: 'done', label: 'Report', description: 'Final normalized report ready in NetDuo.' },
]

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const SEVERITY_LABELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' }

const RISK_BANDS = [
    { max: 20, label: 'Low', color: '#22c55e' },
    { max: 50, label: 'Medium', color: '#f59e0b' },
    { max: 75, label: 'High', color: '#f97316' },
    { max: 100, label: 'Critical', color: '#ef4444' },
]

const PORT_STATE_FILTERS = ['all', 'open', 'closed', 'filtered']
const PORT_PROTOCOL_FILTERS = ['all', 'tcp', 'udp']

const FINDING_TEXT_REPLACEMENTS = [
    [/Docker Remote API sin TLS expuest[ao]s?/gi, 'Docker Remote API exposed without TLS'],
    [/Servicios de base de datos visibles desde Internet/gi, 'Database services exposed to the internet'],
    [/SNMP expuesto por UDP en WAN/gi, 'SNMP exposed over UDP on WAN'],
    [/TFTP expuesto por UDP en WAN/gi, 'TFTP exposed over UDP on WAN'],
    [/DNS UDP expuesto en WAN/gi, 'DNS over UDP exposed on WAN'],
    [/SSDP\/UPnP visible por UDP en WAN/gi, 'SSDP/UPnP exposed over UDP on WAN'],
    [/Protocolos legacy\/inseguros expuestos/gi, 'Legacy/insecure protocols exposed'],
    [/Superficie de administracion remota visible/gi, 'Remote administration surface visible'],
    [/Superficie UDP administrativa visible/gi, 'UDP administrative surface visible'],
    [/Superficie WAN extensa/gi, 'Broad WAN attack surface'],
    [/Interfaz web de administracion detectada en WAN/gi, 'Administrative web interface detected on WAN'],
    [/Configuracion TLS debil o certificado no confiable/gi, 'Weak TLS configuration or untrusted certificate'],
    [/Varios puertos UDP quedaron en estado indeterminado/gi, 'Multiple UDP ports remained indeterminate'],
    [/No se detectaron puertos abiertos en el set escaneado/gi, 'No open ports detected in scanned set'],
    [/Puertos detectados:/gi, 'Detected ports:'],
    [/SNMP detectado en:/gi, 'SNMP detected on:'],
    [/Puertos legacy abiertos:\s*/gi, 'Open legacy ports: '],
    [/Puertos administrativos abiertos:\s*/gi, 'Open administrative ports: '],
    [/Servicios UDP sensibles abiertos:\s*/gi, 'Open sensitive UDP services: '],
    [/Admin\/login identificado en puertos:\s*/gi, 'Admin/login surface identified on ports: '],
    [/Servicios con cert auto-firmado\/expirado en:\s*/gi, 'Services with self-signed/expired certs on: '],
    [/(\d+)\s+puertos abiertos detectados \(TCP:\s*(\d+), UDP:\s*(\d+)\)\./gi, '$1 open ports detected (TCP: $2, UDP: $3).'],
    [/(\d+)\s+puertos UDP sin respuesta \(open\|filtered\)\./gi, '$1 UDP ports without response (open|filtered).'],
    [/Todos los puertos del escaneo respondieron como cerrados o filtrados\./gi, 'All scanned ports responded as closed or filtered.'],
    [/Puerto\s+(\d+)\s+abierto en\s+([^.\n]+)\./gi, 'Port $1 is open on $2.'],
    [/UDP\/(\d+)\s+abierto en:\s*([^.\n]+)\./gi, 'UDP/$1 is open on: $2.'],
    [/Deshabilita\s+(\d+)\s+en WAN o fuerza TLS mutuo en\s+(\d+)\s+con ACL estricta\./gi, 'Disable port $1 on WAN or enforce mutual TLS on port $2 with strict ACLs.'],
    [/Restringe acceso por firewall y expone BD solo por VPN o red privada\./gi, 'Restrict access with firewall rules and expose databases only through VPN or private network.'],
    [/Bloquea SNMP en WAN o limita por ACL estricta y credenciales robustas\./gi, 'Block SNMP on WAN or restrict it with strict ACLs and strong credentials.'],
    [/Restringe recursion y permite consultas solo desde rangos autorizados\./gi, 'Restrict recursion and allow queries only from authorized ranges.'],
    [/Desactiva UPnP WAN y limita discovery solo a la red local\./gi, 'Disable WAN UPnP and limit discovery to the local network.'],
    [/Deshabilita TFTP en Internet o migra a protocolo cifrado y autenticado\./gi, 'Disable internet-exposed TFTP or migrate to encrypted, authenticated protocols.'],
    [/Deshabilita servicios legacy y migra a alternativas cifradas \(SSH\/TLS\/VPN\)\./gi, 'Disable legacy services and migrate to encrypted alternatives (SSH/TLS/VPN).'],
    [/Limita administracion remota a VPN\/IPs permitidas y activa MFA cuando exista\./gi, 'Restrict remote administration to VPN/allowlisted IPs and enable MFA when available.'],
    [/Limita servicios UDP de gestion a VPN o listas de IP permitidas\./gi, 'Restrict UDP management services to VPN or IP allowlists.'],
    [/Desactiva admin WAN o protege con VPN y listas de acceso\./gi, 'Disable WAN admin or protect it with VPN and access allowlists.'],
    [/Renueva certificados, evita self-signed en produccion y revisa cadena TLS\./gi, 'Renew certificates, avoid self-signed certs in production, and validate TLS chain.'],
    [/Reduce la exposicion: cierra puertos no necesarios y segmenta servicios\./gi, 'Reduce exposure: close unnecessary ports and segment services.'],
    [/Correlaciona con firewall del objetivo y repite UDP con timeout mayor si es necesario\./gi, 'Correlate with target firewall behavior and repeat UDP with higher timeout when required.'],
    [/Mantener politica de minimo privilegio y repetir escaneo periodico\./gi, 'Maintain least-privilege policy and repeat scans periodically.'],
    [/Deshabilita TFTP en WAN o lim[ií]talo por ACL estricta y segmentaci[oó]n de red\./gi, 'Disable TFTP on WAN or restrict it with strict ACLs and network segmentation.'],
    [/sin TLS/gi, 'without TLS'],
    [/visible(?:s)? desde Internet/gi, 'visible from the internet'],
]

function clamp(value, min, max) {
    if (value < min) return min
    if (value > max) return max
    return value
}

function toInt(value, fallback = 0) {
    const parsed = Number.parseInt(String(value), 10)
    return Number.isInteger(parsed) ? parsed : fallback
}

function toFloat(value, fallback = null) {
    const parsed = Number.parseFloat(String(value))
    return Number.isFinite(parsed) ? parsed : fallback
}

function asArray(value) {
    return Array.isArray(value) ? value : []
}

function asObject(value) {
    return value && typeof value === 'object' ? value : {}
}

function normalizeUiLanguage(value, fallback = 'en') {
    const raw = String(value || '').trim().toLowerCase()
    if (raw === 'es' || raw === 'en') return raw
    return fallback
}

function normalizeFindingText(value, language = 'en') {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (language === 'es') return raw

    let normalized = raw
    for (const [pattern, replacement] of FINDING_TEXT_REPLACEMENTS) {
        normalized = normalized.replace(pattern, replacement)
    }
    return normalized.replace(/\s{2,}/g, ' ').trim()
}

function decodeBase64Url(input) {
    const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/')
    const pad = normalized.length % 4
    const padded = pad ? normalized + '='.repeat(4 - pad) : normalized
    return atob(padded)
}

function parseConnectToken(raw) {
    try {
        const trimmed = String(raw || '').trim()
        if (!trimmed.startsWith(TOKEN_PREFIX)) return null
        const payloadRaw = decodeBase64Url(trimmed.slice(TOKEN_PREFIX.length))
        const payload = JSON.parse(payloadRaw)
        if (payload?.v !== 1 || payload?.kind !== 'netduo-wan-probe') return null
        if (!payload?.url || !payload?.apiKey) return null

        return {
            url: normalizeUrl(payload.url),
            apiKey: String(payload.apiKey).trim(),
            createdAt: payload.createdAt || null,
        }
    } catch {
        return null
    }
}

function normalizeUrl(raw) {
    return String(raw || '').trim().replace(/\/+$/, '')
}

function isValidHttpUrl(raw) {
    try {
        const url = new URL(normalizeUrl(raw))
        return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
        return false
    }
}

function normalizeIpv4Like(raw) {
    const cleaned = String(raw || '').trim()
    if (!cleaned) return ''
    if (cleaned.startsWith('::ffff:')) return cleaned.slice(7)
    if (cleaned.includes(',')) return cleaned.split(',')[0].trim()
    return cleaned
}

function isPublicIPv4(raw) {
    const ip = normalizeIpv4Like(raw)
    const match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (!match) return false
    const nums = match.slice(1).map(Number)
    if (nums.some(n => n < 0 || n > 255)) return false

    const [a, b] = nums
    if (a === 10 || a === 127 || a === 0) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a >= 224) return false
    return true
}

function maskApiKey(value) {
    const key = String(value || '').trim()
    if (!key) return '-'
    if (key.length <= 8) return '********'
    return `${key.slice(0, 4)}****${key.slice(-4)}`
}

function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '-'
    const sec = ms / 1000
    if (sec < 60) return `${sec.toFixed(1)}s`
    const min = Math.floor(sec / 60)
    const rem = Math.round(sec % 60)
    return `${min}m ${rem}s`
}

function formatTime(iso) {
    if (!iso) return '-'
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return '-'
    return date.toLocaleString()
}

function formatMode(mode) {
    if (mode === 'advanced') return 'Advanced'
    if (mode === 'deep') return 'Deep'
    return 'Quick'
}

function formatProfile(profile) {
    if (profile === 'safe') return 'Safe'
    if (profile === 'aggressive') return 'Aggressive'
    return 'Balanced'
}

function formatTransport(transport) {
    if (transport === 'udp') return 'UDP'
    if (transport === 'both') return 'TCP + UDP'
    if (transport === 'auto') return 'Auto'
    return 'TCP'
}

function resolveRuntimeTransport(transport, mode) {
    const normalizedTransport = VALID_SCAN_TRANSPORTS.has(String(transport || '').toLowerCase())
        ? String(transport).toLowerCase()
        : 'tcp'
    void mode
    if (normalizedTransport !== 'auto') return normalizedTransport
    return 'tcp'
}

function transportIncludesTcp(transport, mode) {
    const runtime = resolveRuntimeTransport(transport, mode)
    return runtime === 'tcp' || runtime === 'both'
}

function transportIncludesUdp(transport, mode) {
    const runtime = resolveRuntimeTransport(transport, mode)
    return runtime === 'udp' || runtime === 'both'
}

function getRiskBand(score) {
    const safe = clamp(Number(score) || 0, 0, 100)
    return RISK_BANDS.find(item => safe <= item.max) || RISK_BANDS[RISK_BANDS.length - 1]
}

function healthIsOk(payload) {
    return Boolean(payload && (payload.ok === true || payload.status === 'ok'))
}
function normalizeNode(raw) {
    const node = asObject(raw)
    return {
        nodeId: node.nodeId || null,
        label: node.label || null,
        provider: node.provider || null,
        region: node.region || null,
        city: node.city || null,
        country: node.country || null,
        asn: node.asn || null,
        publicIp: normalizeIpv4Like(node.publicIp || '') || null,
    }
}

function normalizeApiVersion(value) {
    const raw = String(value || '').trim()
    if (!raw) return ''

    const fromSemver = raw.match(/^v?(\d+)\.(\d+)(?:\.(\d+))?$/i)
    if (fromSemver) {
        const major = Number.parseInt(fromSemver[1], 10)
        const minor = Number.parseInt(fromSemver[2], 10)
        const patch = Number.parseInt(fromSemver[3] || '0', 10)
        return `v${major}.${minor}.${patch}`
    }

    const legacyTagged = raw.match(/-v(\d+)(?:\.(\d+))?(?:\.(\d+))?$/i)
    if (legacyTagged) {
        const major = Number.parseInt(legacyTagged[1], 10)
        const minor = Number.parseInt(legacyTagged[2] || '0', 10)
        const patch = Number.parseInt(legacyTagged[3] || '0', 10)
        return `v${major}.${minor}.${patch}`
    }

    return ''
}

function normalizeVersionInfo(raw) {
    const payload = asObject(raw)
    const packageVersion = String(payload.packageVersion || payload.version || '').trim()
    const apiRevision = String(payload.apiRevision || '').trim()
    const apiVersion = normalizeApiVersion(payload.apiVersion || apiRevision || '')
    const runtime = String(payload.runtime || '').trim()
    const service = String(payload.service || '').trim()
    const startedAt = String(payload.startedAt || '').trim()
    const features = asArray(payload.features)
        .map(feature => String(feature || '').trim())
        .filter(Boolean)

    if (!packageVersion && !apiVersion && !runtime && !service) return null

    return {
        packageVersion: packageVersion || null,
        apiVersion: apiVersion || null,
        apiRevision: apiRevision || null,
        runtime: runtime || null,
        service: service || null,
        startedAt: startedAt || null,
        features,
        checkedAt: new Date().toISOString(),
    }
}

function normalizeWhoami(raw) {
    const payload = asObject(raw)
    const modePolicy = asObject(payload.mode)
    const defaults = asObject(payload.defaults)
    const connect = asObject(payload.connect)
    const payloadRaw = asObject(payload.raw)
    const payloadRawMode = asObject(payloadRaw.mode)
    const payloadRawDefaults = asObject(payloadRaw.defaults)
    const payloadRawConnect = asObject(payloadRaw.connect)

    const payloadLooksLikeWhoami = (
        Object.prototype.hasOwnProperty.call(payload, 'mode')
        || Object.prototype.hasOwnProperty.call(payload, 'defaults')
        || Object.prototype.hasOwnProperty.call(payload, 'connect')
    )
    const payloadRawLooksLikeWhoami = (
        Object.prototype.hasOwnProperty.call(payloadRaw, 'mode')
        || Object.prototype.hasOwnProperty.call(payloadRaw, 'defaults')
        || Object.prototype.hasOwnProperty.call(payloadRaw, 'connect')
    )

    const effectiveModePolicy = Object.keys(modePolicy).length ? modePolicy : payloadRawMode
    const effectiveDefaults = Object.keys(defaults).length ? defaults : payloadRawDefaults
    const effectiveConnect = Object.keys(connect).length ? connect : payloadRawConnect

    const modeDefaultRaw = String(effectiveDefaults.mode || 'quick').toLowerCase()
    const profileDefaultRaw = String(effectiveDefaults.profile || 'balanced').toLowerCase()
    const transportDefaultRaw = String(effectiveDefaults.transport || 'tcp').toLowerCase()
    const quickPorts = asArray(payload.quickPorts).filter(n => Number.isInteger(n))
    const advancedPorts = asArray(payload.advancedPorts).filter(n => Number.isInteger(n))
    const deepPorts = asArray(payload.deepPorts).filter(n => Number.isInteger(n))
    const quickUdpPorts = asArray(payload.quickUdpPorts).filter(n => Number.isInteger(n))
    const advancedUdpPorts = asArray(payload.advancedUdpPorts).filter(n => Number.isInteger(n))
    const deepUdpPorts = asArray(payload.deepUdpPorts).filter(n => Number.isInteger(n))
    const udpEnabled = typeof payload.udpEnabled === 'boolean'
        ? payload.udpEnabled
        : (quickUdpPorts.length + advancedUdpPorts.length + deepUdpPorts.length) > 0
    const capabilityVerified = payload.capabilityVerified === true || payloadLooksLikeWhoami || payloadRawLooksLikeWhoami

    return {
        observedIp: normalizeIpv4Like(payload.observedIp || payload.yourIp || payload.ip || '') || '-',
        isPublicIp: typeof payload.isPublicIp === 'boolean' ? payload.isPublicIp : null,
        allowExternalTarget: effectiveModePolicy.allowExternalTarget ?? null,
        requirePublicTarget: effectiveModePolicy.requirePublicTarget ?? null,
        quickPorts,
        advancedPorts,
        deepPorts,
        quickUdpPorts,
        advancedUdpPorts,
        deepUdpPorts,
        defaultMode: VALID_SCAN_MODES.has(modeDefaultRaw) ? modeDefaultRaw : 'quick',
        defaultProfile: VALID_SCAN_PROFILES.has(profileDefaultRaw) ? profileDefaultRaw : 'balanced',
        defaultTransport: VALID_SCAN_TRANSPORTS.has(transportDefaultRaw) ? transportDefaultRaw : 'tcp',
        udpEnabled,
        capabilityVerified,
        capabilityApiVersion: normalizeApiVersion(payload.capabilityApiVersion || payload.apiVersion || payload.capabilityApiRevision || payload.apiRevision || '') || null,
        capabilityApiRevision: String(payload.capabilityApiRevision || payload.apiRevision || '').trim() || null,
        probeUrl: effectiveConnect.probeUrl || null,
        token: effectiveConnect.token || null,
        service: payload.service || null,
        node: normalizeNode(payload.node),
        raw: payload,
    }
}

function normalizeFinding(item, index, language = 'en') {
    const raw = asObject(item)
    const severityRaw = String(raw.severity || '').toLowerCase()
    const severity = SEVERITY_ORDER[severityRaw] != null ? severityRaw : 'info'

    const category = String(raw.category || 'other').toLowerCase()
    const confidence = clamp(toFloat(raw.confidence, 0.55) ?? 0.55, 0, 1)

    return {
        id: raw.id || `finding-${index + 1}`,
        severity,
        category,
        title: normalizeFindingText(raw.title || raw.message || 'Finding', language),
        evidence: normalizeFindingText(raw.evidence || raw.description || '', language),
        recommendation: normalizeFindingText(raw.recommendation || '', language),
        impact: normalizeFindingText(raw.impact || '', language),
        confidence,
        ports: asArray(raw.ports).filter(p => Number.isInteger(p)),
    }
}

function normalizePortResult(item) {
    const raw = asObject(item)
    const stateRaw = String(raw.state || '').toLowerCase()
    const state = ['open', 'closed', 'filtered'].includes(stateRaw) ? stateRaw : 'filtered'
    const protocolRaw = String(raw.protocol || '').toLowerCase()
    const protocol = protocolRaw === 'udp' ? 'udp' : 'tcp'

    const httpRaw = asObject(raw.http)
    const tlsRaw = asObject(raw.tls)
    const bannerRaw = asObject(raw.banner)

    return {
        port: toInt(raw.port, 0),
        protocol,
        service: raw.service || 'unknown',
        state,
        stateReason: raw.stateReason || null,
        attempts: toInt(raw.attempts, 0),
        rttMs: toFloat(raw.rttMs, null),
        lastError: raw.lastError || raw.error || null,
        http: Object.keys(httpRaw).length ? {
            ok: Boolean(httpRaw.ok),
            protocol: httpRaw.protocol || null,
            statusCode: toInt(httpRaw.statusCode, 0) || null,
            serverHeader: httpRaw.serverHeader || null,
            poweredByHeader: httpRaw.poweredByHeader || null,
            authHeader: httpRaw.authHeader || null,
            title: httpRaw.title || null,
            locationHeader: httpRaw.locationHeader || null,
            adminLike: Boolean(httpRaw.adminLike),
            responseBytes: toInt(httpRaw.responseBytes, 0),
            error: httpRaw.error || null,
        } : null,
        tls: Object.keys(tlsRaw).length ? {
            ok: Boolean(tlsRaw.ok),
            protocol: tlsRaw.protocol || null,
            cipher: tlsRaw.cipher || null,
            authorized: tlsRaw.authorized ?? null,
            authorizationError: tlsRaw.authorizationError || null,
            subject: tlsRaw.subject || null,
            issuer: tlsRaw.issuer || null,
            validTo: tlsRaw.validTo || null,
            expired: tlsRaw.expired ?? null,
            selfSigned: tlsRaw.selfSigned ?? null,
            error: tlsRaw.error || null,
        } : null,
        banner: Object.keys(bannerRaw).length ? {
            ok: Boolean(bannerRaw.ok),
            serviceHint: bannerRaw.serviceHint || null,
            banner: bannerRaw.banner || null,
            error: bannerRaw.error || null,
        } : null,
    }
}

function normalizeScanMeta(raw) {
    const meta = asObject(raw)
    const tcp = asObject(meta.tcp)
    const udp = asObject(meta.udp)
    const transportRaw = String(meta.transport || '').toLowerCase()
    return {
        transport: VALID_SCAN_TRANSPORTS.has(transportRaw) ? transportRaw : 'tcp',
        timeoutMs: toInt(meta.timeoutMs, 0),
        retries: toInt(meta.retries, 0),
        concurrency: toInt(meta.concurrency, 0),
        tcp: {
            timeoutMs: toInt(tcp.timeoutMs, 0),
            retries: toInt(tcp.retries, 0),
            concurrency: toInt(tcp.concurrency, 0),
        },
        udp: {
            timeoutMs: toInt(udp.timeoutMs, 0),
            retries: toInt(udp.retries, 0),
            concurrency: toInt(udp.concurrency, 0),
        },
        httpProbe: Boolean(meta.httpProbe),
        tlsProbe: Boolean(meta.tlsProbe),
        bannerProbe: Boolean(meta.bannerProbe),
    }
}

function normalizePhase(raw, statusRaw = '') {
    if (statusRaw === 'error') return 'error'
    if (statusRaw === 'done') return 'done'

    const phase = String(raw || '').toLowerCase().trim()
    if (VALID_PHASES.has(phase)) return phase

    if (phase === 'sweep' || phase === 'running') return 'tcp_sweep'
    if (phase === 'udp' || phase === 'udpsweep' || phase === 'udp-sweep') return 'udp_sweep'
    if (phase === 'fingerprint') return 'service_probe'
    if (phase === 'finalize') return 'analysis'
    if (phase === 'queue' || phase === 'pending') return 'queued'

    if (statusRaw === 'running') return 'tcp_sweep'
    if (statusRaw === 'queued') return 'queued'
    return 'connect'
}

function normalizeScanProgress(raw, totalFallback = 0, phaseFallback = 'queued') {
    const payload = asObject(raw)
    const phase = normalizePhase(payload.phase || phaseFallback)
    const transportRaw = String(payload.transport || '').toLowerCase()
    const transport = VALID_SCAN_TRANSPORTS.has(transportRaw) ? transportRaw : 'tcp'

    const totalPorts = Math.max(0, toInt(payload.totalPorts, totalFallback))
    const scannedPorts = Math.max(0, toInt(payload.scannedPorts, 0))
    const openPorts = Math.max(0, toInt(payload.openPorts, 0))
    const closedPorts = Math.max(0, toInt(payload.closedPorts, 0))
    const filteredPorts = Math.max(0, toInt(payload.filteredPorts, 0))
    const totalTcpPorts = Math.max(0, toInt(payload.totalTcpPorts, 0))
    const totalUdpPorts = Math.max(0, toInt(payload.totalUdpPorts, 0))
    const scannedTcpPorts = Math.max(0, toInt(payload.scannedTcpPorts, 0))
    const scannedUdpPorts = Math.max(0, toInt(payload.scannedUdpPorts, 0))
    const openTcpPorts = Math.max(0, toInt(payload.openTcpPorts, 0))
    const closedTcpPorts = Math.max(0, toInt(payload.closedTcpPorts, 0))
    const filteredTcpPorts = Math.max(0, toInt(payload.filteredTcpPorts, 0))
    const openUdpPorts = Math.max(0, toInt(payload.openUdpPorts, 0))
    const closedUdpPorts = Math.max(0, toInt(payload.closedUdpPorts, 0))
    const filteredUdpPorts = Math.max(0, toInt(payload.filteredUdpPorts, 0))
    const servicePortsScanned = Math.max(0, toInt(payload.servicePortsScanned, 0))

    const fallbackPercent = totalPorts > 0 ? (scannedPorts / totalPorts) * 100 : 0
    const percentRaw = toFloat(payload.percent, fallbackPercent)

    return {
        phase,
        transport,
        message: payload.message || '',
        totalPorts,
        scannedPorts,
        openPorts,
        closedPorts,
        filteredPorts,
        totalTcpPorts,
        totalUdpPorts,
        scannedTcpPorts,
        scannedUdpPorts,
        openTcpPorts,
        closedTcpPorts,
        filteredTcpPorts,
        openUdpPorts,
        closedUdpPorts,
        filteredUdpPorts,
        servicePortsScanned,
        percent: clamp(percentRaw ?? fallbackPercent, 0, 100),
        startedAt: payload.startedAt || null,
        updatedAt: payload.updatedAt || null,
    }
}

function normalizeScanResult(raw, fallbackMode = 'quick', fallbackProfile = 'balanced', language = 'en') {
    const payload = asObject(raw)

    const modeRaw = String(payload.mode || fallbackMode).toLowerCase()
    const mode = VALID_SCAN_MODES.has(modeRaw) ? modeRaw : fallbackMode

    const profileRaw = String(payload.profile || fallbackProfile).toLowerCase()
    const profile = VALID_SCAN_PROFILES.has(profileRaw) ? profileRaw : fallbackProfile
    const transportRaw = String(payload.transport || '').toLowerCase()
    const transport = VALID_SCAN_TRANSPORTS.has(transportRaw) ? transportRaw : 'tcp'

    const rowsRaw = asArray(payload.results).length
        ? asArray(payload.results)
        : asArray(payload.ports).filter(item => item && typeof item === 'object')

    const rows = rowsRaw
        .map(normalizePortResult)
        .filter(row => row.port >= 1)

    const derivedOpen = rows.filter(row => row.state === 'open').length
    const derivedClosed = rows.filter(row => row.state === 'closed').length
    const derivedFiltered = rows.filter(row => row.state === 'filtered').length

    const tcpRows = rows.filter(row => row.protocol === 'tcp')
    const udpRows = rows.filter(row => row.protocol === 'udp')

    const openTcpCount = toInt(payload.openTcpCount, tcpRows.filter(row => row.state === 'open').length)
    const closedTcpCount = toInt(payload.closedTcpCount, tcpRows.filter(row => row.state === 'closed').length)
    const filteredTcpCount = toInt(payload.filteredTcpCount, tcpRows.filter(row => row.state === 'filtered').length)
    const openUdpCount = toInt(payload.openUdpCount, udpRows.filter(row => row.state === 'open').length)
    const closedUdpCount = toInt(payload.closedUdpCount, udpRows.filter(row => row.state === 'closed').length)
    const filteredUdpCount = toInt(payload.filteredUdpCount, udpRows.filter(row => row.state === 'filtered').length)

    const openCount = toInt(payload.openCount, derivedOpen)
    const closedCount = toInt(payload.closedCount, derivedClosed)
    const filteredCount = toInt(payload.filteredCount, derivedFiltered)

    const tcpPorts = uniqueSortedPorts(asArray(payload.tcpPorts))
    const udpPorts = uniqueSortedPorts(asArray(payload.udpPorts))
    const portsPlanned = uniqueSortedPorts(asArray(payload.ports))

    return {
        mode,
        profile,
        transport,
        target: payload.target || '-',
        observedIp: normalizeIpv4Like(payload.observedIp || '') || '-',
        startedAt: payload.startedAt || null,
        finishedAt: payload.finishedAt || null,
        durationMs: toInt(payload.durationMs, 0),
        portsPlanned,
        tcpPorts: tcpPorts.length ? tcpPorts : portsPlanned,
        udpPorts,
        results: rows,
        openCount,
        closedCount,
        filteredCount,
        openTcpCount,
        closedTcpCount,
        filteredTcpCount,
        openUdpCount,
        closedUdpCount,
        filteredUdpCount,
        findings: asArray(payload.findings).map((item, index) => normalizeFinding(item, index, language)),
        riskScore: clamp(toInt(payload.riskScore, 0), 0, 100),
        confidenceScore: clamp(toInt(payload.confidenceScore, 0), 0, 100),
        scanMeta: normalizeScanMeta(payload.scanMeta),
        language: normalizeUiLanguage(payload.language || language, language),
    }
}

function looksLikeResult(payload) {
    if (!payload || typeof payload !== 'object') return false
    if (Array.isArray(payload.results) || Array.isArray(payload.findings)) return true
    if (payload.riskScore != null || payload.openCount != null || payload.closedCount != null) return true
    return false
}
function normalizeJobPayload(payload, fallbackMode = 'quick', fallbackProfile = 'balanced', language = 'en') {
    if (!payload || typeof payload !== 'object') return null

    const root = payload.job && typeof payload.job === 'object' ? payload.job : payload
    const statusRaw = String(root.status || '').toLowerCase()

    if (VALID_JOB_STATUSES.has(statusRaw)) {
        const modeRaw = String(root.mode || fallbackMode).toLowerCase()
        const profileRaw = String(root.profile || fallbackProfile).toLowerCase()
        const transportRaw = String(root.transport || '').toLowerCase()

        const mode = VALID_SCAN_MODES.has(modeRaw) ? modeRaw : fallbackMode
        const profile = VALID_SCAN_PROFILES.has(profileRaw) ? profileRaw : fallbackProfile
        const transport = VALID_SCAN_TRANSPORTS.has(transportRaw) ? transportRaw : 'tcp'
        const phase = normalizePhase(root.phase || asObject(root.progress).phase, statusRaw)
        const progress = normalizeScanProgress(
            root.progress,
            asArray(root.ports).length || (asArray(root.tcpPorts).length + asArray(root.udpPorts).length),
            phase,
        )

        let result = null
        if (statusRaw === 'done') {
            if (root.result && typeof root.result === 'object') result = normalizeScanResult(root.result, mode, profile, language)
            else if (looksLikeResult(root)) result = normalizeScanResult(root, mode, profile, language)
        }

        return {
            id: root.id || root.jobId || '',
            status: statusRaw,
            phase,
            progress,
            error: root.error || payload.error || null,
            mode,
            profile,
            transport,
            target: root.target || null,
            observedIp: normalizeIpv4Like(root.observedIp || '') || null,
            result,
        }
    }

    if (looksLikeResult(root)) {
        const modeRaw = String(root.mode || fallbackMode).toLowerCase()
        const profileRaw = String(root.profile || fallbackProfile).toLowerCase()

        return {
            id: root.id || root.jobId || '',
            status: 'done',
            phase: 'done',
            progress: normalizeScanProgress({}, asArray(root.ports).length, 'done'),
            error: null,
            mode: VALID_SCAN_MODES.has(modeRaw) ? modeRaw : fallbackMode,
            profile: VALID_SCAN_PROFILES.has(profileRaw) ? profileRaw : fallbackProfile,
            transport: VALID_SCAN_TRANSPORTS.has(String(root.transport || '').toLowerCase())
                ? String(root.transport).toLowerCase()
                : 'tcp',
            target: root.target || null,
            observedIp: normalizeIpv4Like(root.observedIp || '') || null,
            result: normalizeScanResult(root, fallbackMode, fallbackProfile, language),
        }
    }

    return null
}

function friendlyProbeError(error, context = 'generic') {
    const status = Number(error?.status || 0)
    const message = String(error?.message || 'Unknown error')

    if (context === 'connect') {
        if (status === 401 || status === 403) return 'Authentication failed. Check API key.'
        if (status >= 500) return 'Probe server error. Retry in a few seconds.'
        if (message.toLowerCase().includes('timed out')) return 'Connection timed out. Probe did not respond in time.'
        if (message.includes('ENOTFOUND') || message.includes('ECONNREFUSED')) return 'Cannot reach probe URL. Verify host and port.'
        return message
    }

    if (context === 'scan') {
        if (status === 401 || status === 403) return 'Scan rejected. API key invalid or policy blocked this request.'
        if (status === 400) return message || 'Invalid scan request.'
        if (message.toLowerCase().includes('timed out')) return 'Scan polling timed out. Probe response is too slow.'
        return message
    }

    return message
}

function phaseHeadline(phase) {
    if (phase === 'connect') return 'Establishing secure handshake with probe...'
    if (phase === 'queued') return 'Scan job queued on remote probe node...'
    if (phase === 'tcp_sweep') return 'Sweeping WAN TCP exposure across selected scope...'
    if (phase === 'udp_sweep') return 'Sweeping WAN UDP exposure across selected scope...'
    if (phase === 'service_probe') return 'Fingerprinting exposed services (HTTP/TLS/Banner)...'
    if (phase === 'analysis') return 'Correlating evidence, severity and recommendations...'
    if (phase === 'done') return 'WAN exposure report complete.'
    if (phase === 'error') return 'Scan failed.'
    return 'Running...'
}

function phaseCompactLabel(phase) {
    if (phase === 'connect') return 'Handshake'
    if (phase === 'queued') return 'Queued'
    if (phase === 'tcp_sweep') return 'TCP sweep'
    if (phase === 'udp_sweep') return 'UDP sweep'
    if (phase === 'service_probe') return 'Service probe'
    if (phase === 'analysis') return 'Analysis'
    if (phase === 'done') return 'Done'
    if (phase === 'error') return 'Error'
    return 'Running'
}

function phaseStepsForTransport(transport) {
    const runtime = transport === 'udp'
        ? 'udp'
        : transport === 'both'
            ? 'both'
            : 'tcp'

    return PHASE_STEPS.filter(step => {
        if (step.key === 'tcp_sweep') return runtime === 'tcp' || runtime === 'both'
        if (step.key === 'udp_sweep') return runtime === 'udp' || runtime === 'both'
        if (step.key === 'service_probe') return runtime === 'tcp' || runtime === 'both'
        return true
    })
}

function phaseIndexForSteps(phase, steps) {
    const idx = steps.findIndex(step => step.key === phase)
    if (idx >= 0) return idx
    return 0
}

function mergeProgressMonotonic(prev, next) {
    const previous = asObject(prev)
    const incoming = asObject(next)
    const monotonicNumericKeys = [
        'percent',
        'scannedPorts',
        'openPorts',
        'closedPorts',
        'filteredPorts',
        'scannedTcpPorts',
        'scannedUdpPorts',
        'openTcpPorts',
        'closedTcpPorts',
        'filteredTcpPorts',
        'openUdpPorts',
        'closedUdpPorts',
        'filteredUdpPorts',
        'servicePortsScanned',
    ]

    const merged = { ...incoming }
    for (const key of monotonicNumericKeys) {
        const prevValue = Number(previous[key] ?? 0)
        const nextValue = Number(incoming[key] ?? 0)
        if (Number.isFinite(prevValue) && Number.isFinite(nextValue)) {
            merged[key] = Math.max(prevValue, nextValue)
        }
    }
    return merged
}

function heuristicRunningProgress(elapsedMs, mode, transport = 'tcp') {
    const expected = EXPECTED_VISUAL_DURATION_MS[mode] || EXPECTED_VISUAL_DURATION_MS.quick
    const ratio = clamp(elapsedMs / expected, 0, 1)
    const runtimeTransport = resolveRuntimeTransport(transport, mode)

    if (runtimeTransport === 'udp') {
        if (ratio < 0.2) return { phase: 'queued', percent: 10 + ratio * 35 }
        if (ratio < 0.8) {
            const local = (ratio - 0.2) / 0.6
            return { phase: 'udp_sweep', percent: 22 + local * 58 }
        }
        const local = (ratio - 0.8) / 0.2
        return { phase: 'analysis', percent: 82 + local * 14 }
    }

    if (runtimeTransport === 'both') {
        if (ratio < 0.12) return { phase: 'queued', percent: 10 + ratio * 45 }
        if (ratio < 0.48) {
            const local = (ratio - 0.12) / 0.36
            return { phase: 'tcp_sweep', percent: 22 + local * 36 }
        }
        if (ratio < 0.74) {
            const local = (ratio - 0.48) / 0.26
            return { phase: 'udp_sweep', percent: 58 + local * 18 }
        }
        if (ratio < 0.9) {
            const local = (ratio - 0.74) / 0.16
            return { phase: 'service_probe', percent: 76 + local * 12 }
        }
        const local = (ratio - 0.9) / 0.1
        return { phase: 'analysis', percent: 88 + local * 10 }
    }

    if (ratio < 0.15) return { phase: 'queued', percent: 10 + ratio * 55 }

    if (ratio < 0.62) {
        const local = (ratio - 0.15) / 0.47
        return { phase: 'tcp_sweep', percent: 25 + local * 40 }
    }

    if (ratio < 0.84) {
        const local = (ratio - 0.62) / 0.22
        return { phase: 'service_probe', percent: 66 + local * 18 }
    }

    const local = (ratio - 0.84) / 0.16
    return { phase: 'analysis', percent: 84 + local * 10 }
}

function parsePortsInput(raw) {
    const text = String(raw || '').trim()
    if (!text) return { ports: [], error: '' }

    const tokens = text
        .split(/[\s,;\n]+/)
        .map(part => part.trim())
        .filter(Boolean)

    const invalid = tokens.find(part => !/^\d+$/.test(part) || Number(part) < 1 || Number(part) > 65535)
    if (invalid) return { ports: [], error: `Invalid port value: ${invalid}` }

    const ports = Array.from(new Set(tokens.map(part => Number.parseInt(part, 10))))
        .filter(port => Number.isInteger(port) && port >= 1 && port <= 65535)
        .sort((a, b) => a - b)

    if (ports.length > 2048) return { ports, error: 'Port list is too large. Limit custom list to 2048 entries.' }

    return { ports, error: '' }
}

function parsePortRangeInput(fromRaw, toRaw) {
    const fromText = String(fromRaw || '').trim()
    const toText = String(toRaw || '').trim()
    if (!fromText && !toText) return { range: null, count: 0, error: '' }

    const from = Number.parseInt(fromText, 10)
    const to = Number.parseInt(toText, 10)

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
        return { range: null, count: 0, error: 'Port range requires numeric from/to values.' }
    }

    if (from < 1 || from > 65535 || to < 1 || to > 65535) {
        return { range: null, count: 0, error: 'Port range must be between 1 and 65535.' }
    }

    const start = Math.min(from, to)
    const end = Math.max(from, to)
    const count = end - start + 1

    if (count > 4096) {
        return {
            range: { from: start, to: end },
            count,
            error: 'Range is very large. Keep custom range <= 4096 ports for practical runtimes.',
        }
    }

    return { range: { from: start, to: end }, count, error: '' }
}

function resolveScanPorts({ scope = 'preset', mode, customPorts, usePortRange, range }) {
    const normalizedScope = VALID_SCAN_SCOPES.has(String(scope || '').toLowerCase()) ? String(scope).toLowerCase() : 'preset'
    const hasCustomPorts = Array.isArray(customPorts) && customPorts.length > 0
    const hasRange = Boolean(usePortRange && range)

    if (normalizedScope !== 'custom') {
        const basePorts = MODE_PRESETS[mode]?.portsFallback || MODE_PRESETS.quick.portsFallback
        return uniqueSortedPorts(basePorts)
    }

    if (!hasCustomPorts && !hasRange) return []

    const portSet = new Set(Array.isArray(customPorts) ? customPorts : [])
    if (hasRange && range) {
        for (let port = range.from; port <= range.to; port += 1) {
            portSet.add(port)
            if (portSet.size > 4096) break
        }
    }
    return uniqueSortedPorts([...portSet])
}

function resolveUdpScanPorts({
    scope = 'preset',
    mode,
    customPorts,
    usePortRange,
    range,
    fallbackPorts = [],
}) {
    const normalizedScope = VALID_SCAN_SCOPES.has(String(scope || '').toLowerCase()) ? String(scope).toLowerCase() : 'preset'
    const hasCustomPorts = Array.isArray(customPorts) && customPorts.length > 0
    const hasRange = Boolean(usePortRange && range)

    if (normalizedScope !== 'custom') {
        if (mode === 'deep') return uniqueSortedPorts(DEEP_UDP_MODE_PORTS)
        if (mode === 'advanced') return uniqueSortedPorts(ADVANCED_UDP_MODE_PORTS)
        return uniqueSortedPorts(QUICK_UDP_MODE_PORTS)
    }

    const portSet = new Set()
    if (hasCustomPorts) {
        for (const port of customPorts) portSet.add(port)
    }
    if (hasRange && range) {
        for (let port = range.from; port <= range.to; port += 1) {
            portSet.add(port)
            if (portSet.size > 4096) break
        }
    }

    // If no UDP-specific custom scope was provided, reuse TCP custom scope.
    if (!portSet.size && Array.isArray(fallbackPorts)) {
        for (const port of fallbackPorts) portSet.add(port)
    }

    return uniqueSortedPorts([...portSet])
}

function udpPresetPortsForMode(mode) {
    if (mode === 'deep') return uniqueSortedPorts(DEEP_UDP_MODE_PORTS)
    if (mode === 'advanced') return uniqueSortedPorts(ADVANCED_UDP_MODE_PORTS)
    return uniqueSortedPorts(QUICK_UDP_MODE_PORTS)
}

function presetScopeMetaForMode(mode, transport) {
    const runtimeTransport = resolveRuntimeTransport(transport, mode)
    const tcpCount = transportIncludesTcp(runtimeTransport, mode)
        ? uniqueSortedPorts(MODE_PRESETS[mode]?.portsFallback || MODE_PRESETS.quick.portsFallback).length
        : 0
    const udpCount = transportIncludesUdp(runtimeTransport, mode)
        ? udpPresetPortsForMode(mode).length
        : 0
    const total = tcpCount + udpCount

    if (runtimeTransport === 'both') {
        return {
            label: `${total} checks`,
            details: `${tcpCount} TCP + ${udpCount} UDP`,
        }
    }

    if (runtimeTransport === 'udp') {
        return {
            label: `${udpCount} UDP ports`,
            details: `${udpCount} UDP`,
        }
    }

    return {
        label: `${tcpCount} TCP ports`,
        details: `${tcpCount} TCP`,
    }
}

function uniqueSortedPorts(ports) {
    return Array.from(new Set(asArray(ports)))
        .map(port => Number.parseInt(String(port), 10))
        .filter(port => Number.isInteger(port) && port >= 1 && port <= 65535)
        .sort((a, b) => a - b)
}

function copyToClipboard(value) {
    if (!value) return Promise.reject(new Error('Nothing to copy'))
    return navigator.clipboard.writeText(String(value))
}

async function probeRequest(baseUrl, path, apiKey, method = 'GET', body = null) {
    const cleanUrl = normalizeUrl(baseUrl)
    const finalPath = path.startsWith('/') ? path : `/${path}`
    const headers = { Accept: 'application/json', 'User-Agent': 'NetDuo/2.0' }

    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    if (body != null) headers['Content-Type'] = 'application/json'

    // The WAN probe handler in main.js defaults to a strict policy
    // (HTTPS only, cert verification on) as a general SSRF shield. Probe
    // pool entries are user-configured endpoints with an API key, so the
    // user has already declared intent — we opt in explicitly here. A
    // misuse from the renderer would have to forge THIS exact call path
    // to bypass the defaults, which is acceptable defense-in-depth.
    const response = await bridge.wanProbeRequest({
        url: `${cleanUrl}${finalPath}`,
        method,
        headers,
        body: body != null ? JSON.stringify(body) : null,
        allowHttp: true,
        allowInsecure: true,
    })

    if (!response) {
        const err = new Error('No response from probe bridge')
        err.status = 0
        throw err
    }

    if (response.error) {
        const err = new Error(response.error)
        err.status = Number(response.status || 0)
        throw err
    }

    const status = Number(response.status || 0)
    if (status >= 400) {
        const payload = response.data
        const msg = payload?.message || payload?.error || `HTTP ${status}`
        const err = new Error(msg)
        err.status = status
        throw err
    }

    return response.data
}

function prettyCategory(value) {
    const text = String(value || 'other').replace(/[_-]+/g, ' ')
    return text.charAt(0).toUpperCase() + text.slice(1)
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function makeProbeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    return `probe-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function inferModeFromPortCount(count) {
    const total = Number.isFinite(count) ? Number(count) : 0
    if (total > 1200) return 'deep'
    if (total > 80) return 'advanced'
    return 'quick'
}

function sanitizeProbeEntry(raw, index = 0) {
    const item = asObject(raw)
    const url = normalizeUrl(item.url || item.probeUrl || '')
    const apiKey = String(item.apiKey || item.key || '').trim()
    if (!url || !apiKey) return null
    const versionInfo = normalizeVersionInfo(item.versionInfo)
    const normalizedInfo = item.info ? normalizeWhoami(item.info) : null
    const hasLegacyUdpSignal = Boolean(
        normalizedInfo
        && normalizedInfo.capabilityVerified !== true
        && typeof normalizedInfo.udpEnabled === 'boolean'
        && Boolean(item.connected)
        && Boolean(item.lastCheckedAt),
    )
    const info = hasLegacyUdpSignal
        ? { ...normalizedInfo, capabilityVerified: true }
        : normalizedInfo

    return {
        id: item.id || `probe-${index + 1}`,
        name: String(item.name || item.label || '').trim() || '',
        url,
        apiKey,
        selected: item.selected !== false,
        connected: Boolean(item.connected),
        testing: false,
        checkingVersion: false,
        error: '',
        info,
        versionInfo,
        lastCheckedAt: item.lastCheckedAt || null,
    }
}

function sanitizeProbePool(raw) {
    if (!Array.isArray(raw)) return []
    const normalized = raw
        .map((item, index) => sanitizeProbeEntry(item, index))
        .filter(Boolean)

    const byUrl = new Map()
    for (const probe of normalized) {
        if (!byUrl.has(probe.url)) byUrl.set(probe.url, probe)
    }
    return [...byUrl.values()]
}

function serializeProbePool(pool) {
    return pool.map(probe => ({
        id: probe.id,
        name: probe.name,
        url: probe.url,
        apiKey: probe.apiKey,
        selected: probe.selected,
        connected: probe.connected,
        info: probe.info,
        versionInfo: probe.versionInfo || null,
        lastCheckedAt: probe.lastCheckedAt,
    }))
}

function probeDisplayName(probe) {
    if (probe.name) return probe.name
    if (probe.info?.node?.label) return probe.info.node.label
    try {
        const url = new URL(probe.url)
        return url.hostname
    } catch {
        return probe.url
    }
}

function runStatusBadge(status) {
    if (status === 'done') return 'success'
    if (status === 'error') return 'danger'
    if (status === 'running') return 'info'
    return 'warning'
}

function runStatusLabel(status) {
    if (status === 'done') return 'Done'
    if (status === 'error') return 'Error'
    if (status === 'running') return 'Running'
    if (status === 'queued') return 'Queued'
    return 'Idle'
}

function normalizeRevisionTag(value) {
    return normalizeApiVersion(value)
}

function summarizeRunResult(result) {
    if (!result) {
        return {
            open: 0,
            closed: 0,
            filtered: 0,
            risk: 0,
            confidence: 0,
            findings: 0,
        }
    }

    return {
        open: result.openCount || 0,
        closed: result.closedCount || 0,
        filtered: result.filteredCount || 0,
        risk: result.riskScore || 0,
        confidence: result.confidenceScore || 0,
        findings: asArray(result.findings).length,
    }
}

function portStatePriority(state) {
    if (state === 'open') return 3
    if (state === 'filtered') return 2
    if (state === 'closed') return 1
    return 0
}

function findingAggregateKey(finding) {
    const raw = asObject(finding)
    const id = String(raw.id || raw.title || raw.message || 'finding').toLowerCase()
    const severity = String(raw.severity || 'info').toLowerCase()
    const ports = asArray(raw.ports)
        .map(port => Number.parseInt(String(port), 10))
        .filter(port => Number.isInteger(port) && port >= 1 && port <= 65535)
        .sort((a, b) => a - b)
    return `${id}|${severity}|${ports.join(',')}`
}

export default function WanProbe() {
    const [probePool, setProbePool] = useState([])

    const [tokenInput, setTokenInput] = useState('')
    const [tokenMeta, setTokenMeta] = useState(null)

    const [newProbeUrl, setNewProbeUrl] = useState('')
    const [newProbeKey, setNewProbeKey] = useState('')
    const [newProbeName, setNewProbeName] = useState('')
    const [probeSearch, setProbeSearch] = useState('')
    const [showNewProbeKey, setShowNewProbeKey] = useState(false)
    const [showAddModal, setShowAddModal] = useState(false)

    const [scanMode, setScanMode] = useState('quick')
    const [scanScope, setScanScope] = useState('preset')
    const [scanProfile, setScanProfile] = useState('balanced')
    const [scanTransport, setScanTransport] = useState('auto')

    const [useCustomTarget, setUseCustomTarget] = useState(false)
    const [customTarget, setCustomTarget] = useState('')

    const [customPortsInput, setCustomPortsInput] = useState('')
    const [usePortRange, setUsePortRange] = useState(false)
    const [rangeFrom, setRangeFrom] = useState('')
    const [rangeTo, setRangeTo] = useState('')
    const [customUdpPortsInput, setCustomUdpPortsInput] = useState('')
    const [useUdpPortRange, setUseUdpPortRange] = useState(false)
    const [udpRangeFrom, setUdpRangeFrom] = useState('')
    const [udpRangeTo, setUdpRangeTo] = useState('')

    const [setupError, setSetupError] = useState('')
    const [scanError, setScanError] = useState('')
    const [configLoaded, setConfigLoaded] = useState(false)

    const [scanState, setScanState] = useState('idle')
    const [view, setView] = useState('setup')
    const [scanElapsedMs, setScanElapsedMs] = useState(0)
    const [copiedTag, setCopiedTag] = useState('')

    const [probeRuns, setProbeRuns] = useState({})
    const [activeReportProbeId, setActiveReportProbeId] = useState('')
    const [portStateFilter, setPortStateFilter] = useState('all')
    const [portProtocolFilter, setPortProtocolFilter] = useState('all')
    const [portSearch, setPortSearch] = useState('')
    const [reportPage, setReportPage] = useState(1)
    const [historyRows, setHistoryRows] = useState([])
    const [historyLoading, setHistoryLoading] = useState(false)

    const scanStartedAtRef = useRef(0)
    const scanClockRef = useRef(null)
    const runCancelRef = useRef({ cancelled: false })

    const customPortsParsed = useMemo(() => parsePortsInput(customPortsInput), [customPortsInput])
    const rangeParsed = useMemo(() => parsePortRangeInput(rangeFrom, rangeTo), [rangeFrom, rangeTo])
    const customUdpPortsParsed = useMemo(() => parsePortsInput(customUdpPortsInput), [customUdpPortsInput])
    const udpRangeParsed = useMemo(() => parsePortRangeInput(udpRangeFrom, udpRangeTo), [udpRangeFrom, udpRangeTo])

    const selectedProbes = useMemo(() => probePool.filter(probe => probe.selected), [probePool])
    const connectedSelectedProbes = useMemo(() => selectedProbes.filter(probe => probe.connected), [selectedProbes])
    const udpCapabilityByProbe = useMemo(() => (
        connectedSelectedProbes.map(probe => {
            const info = asObject(probe.info)
            const raw = asObject(info.raw)
            const nestedRaw = asObject(raw.raw)
            const rawLooksLikeWhoami = (
                Object.prototype.hasOwnProperty.call(raw, 'mode')
                || Object.prototype.hasOwnProperty.call(raw, 'defaults')
                || Object.prototype.hasOwnProperty.call(raw, 'connect')
            )
            const nestedRawLooksLikeWhoami = (
                Object.prototype.hasOwnProperty.call(nestedRaw, 'mode')
                || Object.prototype.hasOwnProperty.call(nestedRaw, 'defaults')
                || Object.prototype.hasOwnProperty.call(nestedRaw, 'connect')
            )
            const capabilitySource = rawLooksLikeWhoami ? raw : (nestedRawLooksLikeWhoami ? nestedRaw : {})
            const hasRawUdpFlag = typeof capabilitySource.udpEnabled === 'boolean'
            const hasRawUdpPortsKey = (
                Object.prototype.hasOwnProperty.call(capabilitySource, 'quickUdpPorts')
                || Object.prototype.hasOwnProperty.call(capabilitySource, 'advancedUdpPorts')
                || Object.prototype.hasOwnProperty.call(capabilitySource, 'deepUdpPorts')
            )
            const hasStoredCapabilitySignal = info.capabilityVerified === true && typeof info.udpEnabled === 'boolean'
            const hasTrustedCapabilitySignal = (
                ((rawLooksLikeWhoami || nestedRawLooksLikeWhoami) && (hasRawUdpFlag || hasRawUdpPortsKey))
                || hasStoredCapabilitySignal
            )
            const udpEnabled = info.udpEnabled !== false
            return { probe, hasTrustedCapabilitySignal, udpEnabled }
        })
    ), [connectedSelectedProbes])
    const udpUnsupportedSelectedProbes = useMemo(() => (
        udpCapabilityByProbe
            .filter(item => item.hasTrustedCapabilitySignal && !item.udpEnabled)
            .map(item => item.probe)
    ), [udpCapabilityByProbe])
    const udpUnknownCapabilityProbes = useMemo(() => (
        udpCapabilityByProbe
            .filter(item => !item.hasTrustedCapabilitySignal)
            .map(item => item.probe)
    ), [udpCapabilityByProbe])
    const visibleProbes = useMemo(() => {
        const search = String(probeSearch || '').trim().toLowerCase()
        if (!search) return probePool
        return probePool.filter(probe => {
            const haystack = [
                probeDisplayName(probe),
                probe.url,
                probe.info?.node?.region || '',
                probe.info?.node?.country || '',
                probe.info?.observedIp || '',
                probe.versionInfo?.packageVersion || '',
                probe.versionInfo?.apiVersion || '',
                probe.versionInfo?.apiRevision || '',
            ].join(' ').toLowerCase()
            return haystack.includes(search)
        })
    }, [probePool, probeSearch])

    const versionDrift = useMemo(() => {
        const connected = probePool.filter(probe => probe.connected)
        const versionEntries = connected.map(probe => ({
            probeId: probe.id,
            name: probeDisplayName(probe),
            version: normalizeRevisionTag(probe.versionInfo?.apiVersion || probe.versionInfo?.apiRevision),
        }))

        const counts = new Map()
        for (const entry of versionEntries) {
            if (!entry.version) continue
            counts.set(entry.version, (counts.get(entry.version) || 0) + 1)
        }

        let baselineVersion = ''
        let baselineCount = 0
        for (const [version, count] of counts.entries()) {
            if (count > baselineCount) {
                baselineVersion = version
                baselineCount = count
            }
        }

        const mismatchNames = versionEntries
            .filter(entry => entry.version && baselineVersion && entry.version !== baselineVersion)
            .map(entry => entry.name)
        const unknownCount = versionEntries.filter(entry => !entry.version).length
        const alignedCount = versionEntries.filter(entry => entry.version && entry.version === baselineVersion).length

        return {
            totalConnected: connected.length,
            baselineVersion: baselineVersion || '-',
            mismatchNames,
            mismatchCount: mismatchNames.length,
            unknownCount,
            alignedCount,
            baselineCoverage: baselineCount,
        }
    }, [probePool])

    const selectedTargetLabel = useCustomTarget ? (customTarget.trim() || '-') : 'auto'

    const overallProgress = useMemo(() => {
        const runs = Object.values(probeRuns)
        if (!runs.length) return 0
        const total = runs.reduce((acc, run) => acc + (Number(run.progress?.percent) || 0), 0)
        return clamp(total / runs.length, 0, 100)
    }, [probeRuns])

    const overallPhase = useMemo(() => {
        const runs = Object.values(probeRuns)
        if (!runs.length) return 'connect'
        if (runs.some(run => run.status === 'running' && run.phase === 'service_probe')) return 'service_probe'
        if (runs.some(run => run.status === 'running' && run.phase === 'analysis')) return 'analysis'
        if (runs.some(run => run.status === 'running' && run.phase === 'udp_sweep')) return 'udp_sweep'
        if (runs.some(run => run.status === 'running' && run.phase === 'tcp_sweep')) return 'tcp_sweep'
        if (runs.some(run => run.status === 'queued')) return 'queued'
        if (runs.some(run => run.status === 'error')) return 'error'
        if (runs.every(run => run.status === 'done')) return 'done'
        return 'connect'
    }, [probeRuns])

    const completedRuns = useMemo(() => {
        return Object.values(probeRuns)
            .filter(run => run.status === 'done' && run.result)
            .sort((a, b) => {
                const aRisk = a.result?.riskScore || 0
                const bRisk = b.result?.riskScore || 0
                return bRisk - aRisk
            })
    }, [probeRuns])

    const allFindings = useMemo(() => {
        const unique = new Map()
        for (const run of completedRuns) {
            for (const finding of asArray(run.result?.findings)) {
                unique.set(findingAggregateKey(finding), finding)
            }
        }
        return [...unique.values()]
    }, [completedRuns])

    const aggregateSummary = useMemo(() => {
        const runs = completedRuns
        const totalProbes = runs.length
        if (!totalProbes) {
            return {
                totalProbes: 0,
                open: 0,
                closed: 0,
                filtered: 0,
                findings: 0,
                avgRisk: 0,
                avgConfidence: 0,
            }
        }

        const portStates = new Map()
        let risk = 0
        let confidence = 0
        let rowsObserved = 0
        let fallbackOpen = 0
        let fallbackClosed = 0
        let fallbackFiltered = 0

        for (const run of runs) {
            risk += run.result?.riskScore || 0
            confidence += run.result?.confidenceScore || 0

            const rows = asArray(run.result?.results)
            if (!rows.length) {
                fallbackOpen += run.result?.openCount || 0
                fallbackClosed += run.result?.closedCount || 0
                fallbackFiltered += run.result?.filteredCount || 0
                continue
            }

            rowsObserved += rows.length
            for (const row of rows) {
                const port = toInt(row?.port, 0)
                if (port < 1) continue
                const protocol = row?.protocol === 'udp' ? 'udp' : 'tcp'
                const stateKey = `${protocol}:${port}`
                const nextState = row?.state === 'open'
                    ? 'open'
                    : row?.state === 'closed'
                        ? 'closed'
                        : 'filtered'
                const currentState = portStates.get(stateKey)
                if (!currentState || portStatePriority(nextState) > portStatePriority(currentState)) {
                    portStates.set(stateKey, nextState)
                }
            }
        }

        const open = rowsObserved
            ? [...portStates.values()].filter(state => state === 'open').length
            : fallbackOpen
        const closed = rowsObserved
            ? [...portStates.values()].filter(state => state === 'closed').length
            : fallbackClosed
        const filtered = rowsObserved
            ? [...portStates.values()].filter(state => state === 'filtered').length
            : fallbackFiltered

        return {
            totalProbes,
            open,
            closed,
            filtered,
            findings: allFindings.length,
            avgRisk: Math.round(risk / totalProbes),
            avgConfidence: Math.round(confidence / totalProbes),
        }
    }, [allFindings.length, completedRuns])

    const liveSummary = useMemo(() => {
        return Object.values(probeRuns).reduce((acc, run) => {
            const progress = run.progress || {}
            acc.open = Math.max(acc.open, Number(progress.openPorts) || 0)
            acc.closed = Math.max(acc.closed, Number(progress.closedPorts) || 0)
            acc.filtered = Math.max(acc.filtered, Number(progress.filteredPorts) || 0)
            acc.servicePortsScanned += Number(progress.servicePortsScanned) || 0
            if (run.status === 'done') acc.done += 1
            if (run.status === 'error') acc.failed += 1
            if (run.status === 'running') acc.running += 1
            if (run.status === 'queued') acc.queued += 1
            return acc
        }, {
            open: 0,
            closed: 0,
            filtered: 0,
            servicePortsScanned: 0,
            done: 0,
            failed: 0,
            running: 0,
            queued: 0,
        })
    }, [probeRuns])

    const severityCounts = useMemo(() => {
        const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
        for (const finding of allFindings) {
            const key = SEVERITY_ORDER[finding.severity] != null ? finding.severity : 'info'
            counts[key] += 1
        }
        return counts
    }, [allFindings])

    const activeReportRun = useMemo(() => {
        if (!completedRuns.length) return null
        return completedRuns.find(run => run.probeId === activeReportProbeId) || completedRuns[0]
    }, [completedRuns, activeReportProbeId])

    /**
     * Shape the current scan into the payload consumed by both the
     * history persistence layer and the PDF/CSV export templates.
     * Kept in a single place so the saved and the exported artefacts
     * always agree.
     *
     * Target resolution priority, per probe:
     *   1. `run.target` — resolved by the probe server (authoritative;
     *      auto-mode echoes back the caller's public IP, custom mode
     *      echoes back the supplied value).
     *   2. `run.observedIp` — fallback if the server didn't echo target.
     *   3. `customTarget` — whatever the user typed locally.
     *
     * Aggregate `report.target`:
     *   - If every probe saw the same target → that single string.
     *   - If probes saw different targets (rare, but possible when
     *     one is custom and another is auto) → a comma-joined list.
     *   - Otherwise fall back to the user-supplied customTarget, or
     *     'auto' as a last resort so History never shows a bare dash.
     */
    const buildReportPayload = useCallback(() => {
        const probes = completedRuns.map(run => {
            const probeTarget = run.result?.target || run.target || run.observedIp
                || (customTarget || '').trim() || null
            return {
                probeId: run.probeId,
                label: run.probeLabel || run.probeName || run.probeUrl || run.probeId,
                url: run.probeUrl || null,
                region: run.probeRegion || run.result?.probe?.region || run.node?.region || null,
                country: run.probeCountry || run.result?.probe?.country || run.node?.country || null,
                target: probeTarget,
                // Full run metadata needed by the Report view chips
                // (Target · Observed · Duration · Mode/Profile · Transport).
                // Persisting these is what makes a history entry
                // indistinguishable from a fresh scan when re-opened.
                observedIp: run.result?.observedIp || run.observedIp || null,
                durationMs: run.result?.durationMs ?? null,
                mode: run.result?.mode || null,
                profile: run.result?.profile || null,
                transport: run.result?.transport || null,
                riskScore: run.result?.riskScore ?? null,
                confidenceScore: run.result?.confidenceScore ?? null,
                open: run.result?.openCount ?? null,
                closed: run.result?.closedCount ?? null,
                filtered: run.result?.filteredCount ?? null,
                results: Array.isArray(run.result?.results) ? run.result.results.map(r => ({
                    port: r.port,
                    protocol: r.protocol || 'tcp',
                    state: r.state || null,
                    service: r.service || null,
                    banner: r.banner || null,
                    detail: r.detail || null,
                })) : [],
                findings: Array.isArray(run.result?.findings) ? run.result.findings : [],
            }
        })

        const uniqueTargets = [...new Set(probes.map(p => p.target).filter(Boolean))]
        const typed = (customTarget || '').trim()
        const aggregateTarget = uniqueTargets.length === 1
            ? uniqueTargets[0]
            : uniqueTargets.length > 1
                ? uniqueTargets.join(', ')
                : (typed || 'auto')

        return {
            target: aggregateTarget,
            generatedAt: new Date().toISOString(),
            summary: {
                probes: probes.length,
                findingsCount: allFindings.length,
                riskScore: aggregateSummary.avgRisk,
                avgConfidence: aggregateSummary.avgConfidence,
                open: aggregateSummary.open,
                closed: aggregateSummary.closed,
                filtered: aggregateSummary.filtered,
            },
            probes,
            findings: allFindings,
        }
    }, [completedRuns, allFindings, aggregateSummary, customTarget])

    // Auto-save every completed scan into wan_probe_history once the
    // scan finishes. Guarded by a ref so a re-render of the same
    // completion doesn't write twice. Failures are silent (best-effort)
    // — the scan UX shouldn't break if persistence hiccups.
    const savedRunSignatureRef = useRef(null)
    useEffect(() => {
        if (scanState !== 'done') return
        if (!completedRuns.length) return
        const signature = completedRuns.map(r => r.probeId).sort().join('|') + ':' + (customTarget || '')
        if (savedRunSignatureRef.current === signature) return
        savedRunSignatureRef.current = signature
        const payload = buildReportPayload()
        bridge.wanProbeHistoryAdd?.({ report: payload }).then(rows => {
            if (Array.isArray(rows)) setHistoryRows(rows)
        }).catch(() => { /* best-effort */ })
    }, [scanState, completedRuns, customTarget, buildReportPayload])

    async function loadHistory() {
        setHistoryLoading(true)
        try {
            const rows = await bridge.wanProbeHistoryGet?.()
            setHistoryRows(Array.isArray(rows) ? rows : [])
        } catch {
            setHistoryRows([])
        } finally {
            setHistoryLoading(false)
        }
    }

    async function deleteHistoryEntry(id) {
        try {
            const updated = await bridge.wanProbeHistoryDelete?.(id)
            if (Array.isArray(updated)) setHistoryRows(updated)
        } catch { await loadHistory() }
    }

    async function clearHistoryEntries() {
        try {
            const updated = await bridge.wanProbeHistoryClear?.()
            setHistoryRows(Array.isArray(updated) ? updated : [])
        } catch { setHistoryRows([]) }
    }

    /**
     * Hydrate the report view with a previously-saved payload. The
     * saved shape comes from buildReportPayload() above, so every
     * probe entry already carries the per-port results needed to render
     * the detail tables AND the resolved target that the report
     * header cards read.
     *
     * We also mirror the payload target into `customTarget` so the UI
     * bits that surface "Target" from that state (scan cards, copy
     * JSON, etc.) match what was saved. Marking the flag to disable
     * auto-save keeps the hydration side-effect-free against the
     * history we just loaded from.
     */
    function openHistoryReport(entry) {
        const payload = entry?.report
        if (!payload || !Array.isArray(payload.probes)) return
        const rebuilt = {}
        for (const probe of payload.probes) {
            const resolvedTarget = probe.target || payload.target || null
            // The Report view reads `run.probeName` (set by the live
            // scan via probeDisplayName()). Populating only `probeLabel`
            // left the probe card header blank when reopening from
            // history — UI mirrors what scan flow writes, not the
            // payload field naming convention.
            rebuilt[probe.probeId] = {
                probeId: probe.probeId,
                probeName: probe.label || probe.url || probe.probeId,
                probeLabel: probe.label,
                probeUrl: probe.url,
                probeRegion: probe.region,
                probeCountry: probe.country,
                target: resolvedTarget,
                observedIp: probe.observedIp || resolvedTarget,
                status: 'done',
                result: {
                    riskScore: probe.riskScore,
                    confidenceScore: probe.confidenceScore,
                    openCount: probe.open,
                    closedCount: probe.closed,
                    filteredCount: probe.filtered,
                    results: probe.results || [],
                    findings: probe.findings || [],
                    probe: { region: probe.region, country: probe.country },
                    // Mirror every chip the Report view reads from
                    // `result.*` so a rehydrated history row renders
                    // identically to a fresh scan — otherwise the user
                    // sees "Target —" / "Duration —" / etc.
                    target: resolvedTarget,
                    observedIp: probe.observedIp || resolvedTarget,
                    durationMs: probe.durationMs ?? null,
                    mode: probe.mode || null,
                    profile: probe.profile || null,
                    transport: probe.transport || null,
                },
                progress: {},
            }
        }
        // Preseed the signature so the auto-save effect treats this
        // hydration as already-persisted and doesn't rewrite the row.
        savedRunSignatureRef.current = payload.probes.map(p => p.probeId).sort().join('|')
            + ':' + (payload.target || '')
        setProbeRuns(rebuilt)
        setActiveReportProbeId(payload.probes[0]?.probeId || '')
        if (payload.target && payload.target !== 'auto') {
            setCustomTarget(payload.target)
        }
        setScanState('done')
        setView('report')
    }

    useEffect(() => {
        // Defer the history IPC to the next idle frame so the entrance
        // animation paints unblocked. loadHistory triggers a sqlite
        // round-trip + an array of N rows worth of setState — running
        // it inline at mount competed with framer-motion and made the
        // page feel laggy on first nav.
        const handle = (typeof window.requestIdleCallback === 'function')
            ? window.requestIdleCallback(() => loadHistory().catch(() => {}), { timeout: 1500 })
            : setTimeout(() => loadHistory().catch(() => {}), 80)
        return () => {
            if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle)
            else clearTimeout(handle)
        }
    }, [])

    const filteredRows = useMemo(() => {
        const rows = asArray(activeReportRun?.result?.results)
        const searched = String(portSearch || '').trim().toLowerCase()

        return rows.filter(row => {
            if (portStateFilter !== 'all' && row.state !== portStateFilter) return false
            if (portProtocolFilter !== 'all' && row.protocol !== portProtocolFilter) return false
            if (!searched) return true
            const haystack = `${row.port} ${row.service} ${row.state} ${row.protocol}`.toLowerCase()
            return haystack.includes(searched)
        })
    }, [activeReportRun, portProtocolFilter, portSearch, portStateFilter])

    const totalReportPages = Math.max(1, Math.ceil(filteredRows.length / REPORT_PAGE_SIZE))
    const pagedRows = useMemo(() => {
        const startIndex = (reportPage - 1) * REPORT_PAGE_SIZE
        return filteredRows.slice(startIndex, startIndex + REPORT_PAGE_SIZE)
    }, [filteredRows, reportPage])

    const hasCustomTcpScopeInput = customPortsParsed.ports.length > 0 || Boolean(usePortRange && rangeParsed.range)
    const hasCustomUdpScopeInput = customUdpPortsParsed.ports.length > 0 || Boolean(useUdpPortRange && udpRangeParsed.range)
    const hasAnyCustomScopeInput = hasCustomTcpScopeInput || hasCustomUdpScopeInput

    const plannedGenericPorts = useMemo(() => {
        return resolveScanPorts({
            scope: scanScope,
            mode: scanMode,
            customPorts: customPortsParsed.ports,
            usePortRange,
            range: rangeParsed.range,
        })
    }, [customPortsParsed.ports, rangeParsed.range, scanMode, scanScope, usePortRange])

    const effectiveScanMode = useMemo(() => {
        if (scanScope === 'custom') return inferModeFromPortCount(plannedGenericPorts.length)
        return scanMode
    }, [plannedGenericPorts.length, scanMode, scanScope])

    const includesTcp = useMemo(
        () => transportIncludesTcp(scanTransport, effectiveScanMode),
        [effectiveScanMode, scanTransport],
    )
    const includesUdp = useMemo(
        () => transportIncludesUdp(scanTransport, effectiveScanMode),
        [effectiveScanMode, scanTransport],
    )

    const plannedTcpPorts = useMemo(() => {
        if (!includesTcp) return []
        return plannedGenericPorts
    }, [includesTcp, plannedGenericPorts])

    const plannedUdpPorts = useMemo(() => {
        if (!includesUdp) return []
        return resolveUdpScanPorts({
            scope: scanScope,
            mode: effectiveScanMode,
            customPorts: customUdpPortsParsed.ports,
            usePortRange: useUdpPortRange,
            range: udpRangeParsed.range,
            fallbackPorts: plannedGenericPorts,
        })
    }, [
        customUdpPortsParsed.ports,
        effectiveScanMode,
        includesUdp,
        plannedGenericPorts,
        scanScope,
        udpRangeParsed.range,
        useUdpPortRange,
    ])

    const plannedTcpCount = plannedTcpPorts.length
    const plannedUdpCount = plannedUdpPorts.length
    const plannedPortCount = plannedTcpCount + plannedUdpCount
    const plannedPortLabel = includesUdp && includesTcp
        ? `${plannedPortCount} checks (${plannedTcpCount} TCP + ${plannedUdpCount} UDP)`
        : includesUdp
            ? `${plannedPortCount} UDP ports`
            : `${plannedPortCount} TCP ports`
    const runtimeTransport = resolveRuntimeTransport(scanTransport, effectiveScanMode)
    const scopeLabel = scanScope === 'custom' ? 'Custom' : `Preset - ${formatMode(scanMode)}`
    const persistedWanProbeConfig = useMemo(() => ({
        wanProbePool: serializeProbePool(probePool),
        wanProbeMode: scanMode,
        wanProbeScope: scanScope,
        wanProbeProfile: scanProfile,
        wanProbeTransport: scanTransport,
        wanProbeUseCustomTarget: useCustomTarget,
        wanProbeTarget: customTarget,
        wanProbeCustomPorts: customPortsInput,
        wanProbeUsePortRange: usePortRange,
        wanProbeRangeFrom: rangeFrom,
        wanProbeRangeTo: rangeTo,
        wanProbeCustomUdpPorts: customUdpPortsInput,
        wanProbeUseUdpPortRange: useUdpPortRange,
        wanProbeUdpRangeFrom: udpRangeFrom,
        wanProbeUdpRangeTo: udpRangeTo,
    }), [
        customPortsInput,
        customTarget,
        customUdpPortsInput,
        probePool,
        rangeFrom,
        rangeTo,
        scanMode,
        scanProfile,
        scanScope,
        scanTransport,
        udpRangeFrom,
        udpRangeTo,
        useCustomTarget,
        usePortRange,
        useUdpPortRange,
    ])


    useEffect(() => {
        let mounted = true

        bridge.wanProbeConfigGet().then(savedConfig => {
            if (!mounted) return

            const savedPool = savedConfig?.wanProbePool
            const legacyUrl = savedConfig?.wanProbeUrl
            const legacyKey = savedConfig?.wanProbeKey
            const legacyConnected = savedConfig?.wanProbeConnected
            const legacyInfo = savedConfig?.wanProbeInfo
            const savedMode = savedConfig?.wanProbeMode
            const savedScope = savedConfig?.wanProbeScope
            const savedProfile = savedConfig?.wanProbeProfile
            const savedTransport = savedConfig?.wanProbeTransport
            const savedUseCustom = savedConfig?.wanProbeUseCustomTarget
            const savedTarget = savedConfig?.wanProbeTarget
            const savedPorts = savedConfig?.wanProbeCustomPorts
            const savedUsePortRange = savedConfig?.wanProbeUsePortRange
            const savedRangeFrom = savedConfig?.wanProbeRangeFrom
            const savedRangeTo = savedConfig?.wanProbeRangeTo
            const savedUdpPorts = savedConfig?.wanProbeCustomUdpPorts
            const savedUseUdpPortRange = savedConfig?.wanProbeUseUdpPortRange
            const savedUdpRangeFrom = savedConfig?.wanProbeUdpRangeFrom
            const savedUdpRangeTo = savedConfig?.wanProbeUdpRangeTo

            const hasSavedPool = Array.isArray(savedPool)
            let pool = sanitizeProbePool(savedPool)

            if (!hasSavedPool && !pool.length && legacyUrl && legacyKey) {
                pool = [{
                    id: makeProbeId(),
                    name: '',
                    url: normalizeUrl(legacyUrl),
                    apiKey: String(legacyKey).trim(),
                    selected: true,
                    connected: Boolean(legacyConnected),
                    testing: false,
                    error: '',
                    info: legacyInfo ? normalizeWhoami(legacyInfo) : null,
                    lastCheckedAt: null,
                }]
            }

            setProbePool(pool)

            if (VALID_SCAN_MODES.has(savedMode)) setScanMode(savedMode)
            if (VALID_SCAN_SCOPES.has(savedScope)) setScanScope(savedScope)
            if (VALID_SCAN_PROFILES.has(savedProfile)) setScanProfile(savedProfile)
            if (VALID_SCAN_TRANSPORTS.has(savedTransport)) setScanTransport(savedTransport)

            if (typeof savedUseCustom === 'boolean') setUseCustomTarget(savedUseCustom)
            if (savedTarget) setCustomTarget(String(savedTarget))

            if (savedPorts) setCustomPortsInput(String(savedPorts))
            if (typeof savedUsePortRange === 'boolean') setUsePortRange(savedUsePortRange)
            if (savedRangeFrom != null) setRangeFrom(String(savedRangeFrom))
            if (savedRangeTo != null) setRangeTo(String(savedRangeTo))
            if (savedUdpPorts) setCustomUdpPortsInput(String(savedUdpPorts))
            if (typeof savedUseUdpPortRange === 'boolean') setUseUdpPortRange(savedUseUdpPortRange)
            if (savedUdpRangeFrom != null) setUdpRangeFrom(String(savedUdpRangeFrom))
            if (savedUdpRangeTo != null) setUdpRangeTo(String(savedUdpRangeTo))

            if (!VALID_SCAN_SCOPES.has(savedScope)) {
                const hasSavedCustomPorts = Boolean(String(savedPorts || '').trim())
                const hasSavedCustomUdpPorts = Boolean(String(savedUdpPorts || '').trim())
                if (hasSavedCustomPorts || savedUsePortRange === true || hasSavedCustomUdpPorts || savedUseUdpPortRange === true) {
                    setScanScope('custom')
                }
            }
            setConfigLoaded(true)
        }).catch(error => {
            logBridgeWarning('wan-probe:config-bootstrap', error)
            if (mounted) setConfigLoaded(true)
        })

        return () => {
            mounted = false
            runCancelRef.current.cancelled = true
            if (scanClockRef.current) {
                clearInterval(scanClockRef.current)
                scanClockRef.current = null
            }
        }
    }, [])

    useEffect(() => {
        if (!configLoaded) return
        const timer = setTimeout(() => {
            bridge.wanProbeConfigSet(persistedWanProbeConfig).catch(error => {
                logBridgeWarning('wan-probe:config-persist', error)
            })
        }, 120)
        return () => clearTimeout(timer)
    }, [configLoaded, persistedWanProbeConfig])

    useEffect(() => {
        if (!copiedTag) return
        const timer = setTimeout(() => setCopiedTag(''), 1600)
        return () => clearTimeout(timer)
    }, [copiedTag])

    useEffect(() => {
        if (!completedRuns.length) {
            if (activeReportProbeId) setActiveReportProbeId('')
            return
        }
        if (!completedRuns.some(run => run.probeId === activeReportProbeId)) {
            setActiveReportProbeId(completedRuns[0].probeId)
        }
    }, [activeReportProbeId, completedRuns])

    useEffect(() => {
        setReportPage(1)
    }, [activeReportRun?.probeId, portProtocolFilter, portSearch, portStateFilter])

    useEffect(() => {
        setReportPage(prev => clamp(prev, 1, totalReportPages))
    }, [totalReportPages])

    useEffect(() => {
        if (scanState !== 'running') {
            if (scanClockRef.current) {
                clearInterval(scanClockRef.current)
                scanClockRef.current = null
            }
            return
        }

        if (scanClockRef.current) clearInterval(scanClockRef.current)
        scanClockRef.current = setInterval(() => {
            setScanElapsedMs(Math.max(0, Date.now() - scanStartedAtRef.current))
        }, 150)

        return () => {
            if (scanClockRef.current) {
                clearInterval(scanClockRef.current)
                scanClockRef.current = null
            }
        }
    }, [scanState])

    function applyToken() {
        const parsed = parseConnectToken(tokenInput)
        if (!parsed) {
            setSetupError('Invalid token. Expected NDUO_PROBE_V1:...')
            setTokenMeta(null)
            return
        }

        setNewProbeUrl(parsed.url)
        setNewProbeKey(parsed.apiKey)
        setTokenMeta(parsed)
        setSetupError('')
    }

    function clearProbeInputs() {
        setTokenInput('')
        setTokenMeta(null)
        setNewProbeUrl('')
        setNewProbeKey('')
        setNewProbeName('')
    }

    function updateProbe(probeId, updater) {
        setProbePool(prev => prev.map(probe => {
            if (probe.id !== probeId) return probe
            const next = typeof updater === 'function' ? updater(probe) : updater
            return { ...probe, ...next }
        }))
    }

    async function testProbe(probeId, probeOverride = null) {
        const probe = probeOverride || probePool.find(item => item.id === probeId)
        if (!probe) return false

        updateProbe(probeId, { testing: true, checkingVersion: false, error: '' })

        try {
            const health = await probeRequest(probe.url, '/health', null)
            if (!healthIsOk(health)) throw new Error('Health check failed.')
            let versionInfo = normalizeVersionInfo(asObject(health?.version))

            if (!versionInfo) {
                try {
                    const versionRaw = await probeRequest(probe.url, '/version', probe.apiKey)
                    versionInfo = normalizeVersionInfo(versionRaw)
                } catch {
                    // Keep connection success even when version endpoint is unavailable.
                }
            }

            const whoamiRaw = await probeRequest(probe.url, '/whoami', probe.apiKey)
            const healthVersion = asObject(health?.version)
            const whoami = normalizeWhoami({
                ...asObject(whoamiRaw),
                capabilityApiVersion: normalizeApiVersion(healthVersion.apiVersion || healthVersion.apiRevision || '') || null,
                capabilityApiRevision: String(healthVersion.apiRevision || '').trim() || null,
                capabilityVerified: true,
            })

            updateProbe(probeId, {
                connected: true,
                testing: false,
                checkingVersion: false,
                error: '',
                info: whoami,
                versionInfo,
                lastCheckedAt: new Date().toISOString(),
            })
            return true
        } catch (error) {
            updateProbe(probeId, {
                connected: false,
                testing: false,
                checkingVersion: false,
                error: friendlyProbeError(error, 'connect'),
                lastCheckedAt: new Date().toISOString(),
            })
            return false
        }
    }

    async function checkProbeVersion(probeId) {
        const probe = probePool.find(item => item.id === probeId)
        if (!probe) return false

        updateProbe(probeId, { checkingVersion: true, error: '' })

        try {
            let versionInfo = null
            try {
                const versionRaw = await probeRequest(probe.url, '/version', probe.apiKey)
                versionInfo = normalizeVersionInfo(versionRaw)
            } catch {
                const health = await probeRequest(probe.url, '/health', null)
                versionInfo = normalizeVersionInfo(asObject(health?.version))
            }

            if (!versionInfo) {
                throw new Error('Probe did not return version metadata.')
            }

            updateProbe(probeId, prev => ({
                ...prev,
                checkingVersion: false,
                versionInfo,
                error: '',
            }))
            return true
        } catch (error) {
            updateProbe(probeId, {
                checkingVersion: false,
                error: friendlyProbeError(error, 'generic'),
            })
            return false
        }
    }

    async function addProbe() {
        const cleanUrl = normalizeUrl(newProbeUrl)
        const cleanKey = String(newProbeKey || '').trim()

        if (!cleanUrl || !cleanKey) {
            setSetupError('Probe URL and API key are required.')
            return
        }

        if (!isValidHttpUrl(cleanUrl)) {
            setSetupError('Probe URL must start with http:// or https://')
            return
        }

        if (probePool.some(probe => probe.url === cleanUrl)) {
            setSetupError('This probe URL is already added.')
            return
        }

        const probeId = makeProbeId()
        const entry = {
            id: probeId,
            name: String(newProbeName || '').trim(),
            url: cleanUrl,
            apiKey: cleanKey,
            selected: true,
            connected: false,
            testing: false,
            checkingVersion: false,
            error: '',
            info: null,
            versionInfo: null,
            lastCheckedAt: null,
        }

        setProbePool(prev => [...prev, entry])
        clearProbeInputs()
        setSetupError('')
        setShowAddModal(false)

        await sleep(10)
        await testProbe(probeId, entry)
    }

    function removeProbe(probeId) {
        setProbePool(prev => prev.filter(probe => probe.id !== probeId))
        setProbeRuns(prev => {
            const next = { ...prev }
            delete next[probeId]
            return next
        })
    }

    function toggleProbeSelected(probeId) {
        updateProbe(probeId, probe => ({ selected: !probe.selected }))
    }

    function setAllSelected(selected) {
        setProbePool(prev => prev.map(probe => ({ ...probe, selected })))
    }

    async function refreshAllSelected() {
        const ids = selectedProbes.map(probe => probe.id)
        await Promise.all(ids.map(id => testProbe(id)))
    }

    function updateRun(probeId, updater) {
        setProbeRuns(prev => {
            const current = prev[probeId] || {}
            const patch = typeof updater === 'function' ? updater(current) : updater
            const next = {
                ...current,
                ...patch,
            }
            if (next.progress || current.progress) {
                next.progress = mergeProgressMonotonic(current.progress, next.progress || current.progress || {})
            }
            return {
                ...prev,
                [probeId]: next,
            }
        })
    }

    function resetResultsView() {
        if (scanState === 'running') {
            runCancelRef.current.cancelled = true
        }
        runCancelRef.current = { cancelled: false }
        if (scanClockRef.current) {
            clearInterval(scanClockRef.current)
            scanClockRef.current = null
        }

        setProbeRuns({})
        setActiveReportProbeId('')
        setPortStateFilter('all')
        setPortProtocolFilter('all')
        setPortSearch('')
        setReportPage(1)
        setScanElapsedMs(0)
        setScanError('')
        setSetupError('')
        setScanState('idle')
        setView('setup')
    }

    async function copyActiveReport() {
        if (!activeReportRun?.result) return
        try {
            await copyToClipboard(JSON.stringify(activeReportRun.result, null, 2))
            setCopiedTag(`run-json-${activeReportRun.probeId}`)
        } catch {
            setScanError('Could not copy report JSON.')
        }
    }

    async function copyAggregateReport() {
        const payload = completedRuns.map(run => ({
            probeId: run.probeId,
            probeName: run.probeName,
            probeUrl: run.probeUrl,
            node: run.node || null,
            result: run.result,
        }))
        if (!payload.length) return
        try {
            await copyToClipboard(JSON.stringify(payload, null, 2))
            setCopiedTag('all-json')
        } catch {
            setScanError('Could not copy aggregate JSON.')
        }
    }

    function validateScanRequest() {
        if (!selectedProbes.length) return 'Select at least one probe.'
        if (!connectedSelectedProbes.length) return 'No selected probe is connected.'
        if (includesUdp && udpUnknownCapabilityProbes.length) {
            const listed = udpUnknownCapabilityProbes
                .slice(0, 3)
                .map(probe => probeDisplayName(probe))
                .join(', ')
            const extra = udpUnknownCapabilityProbes.length > 3
                ? ` (+${udpUnknownCapabilityProbes.length - 3} more)`
                : ''
            return `Cannot verify UDP capability for probe(s): ${listed}${extra}. Click "Refresh Selected" and ensure each probe runs the latest NetDuo WAN Probe service.`
        }
        if (includesUdp && udpUnsupportedSelectedProbes.length) {
            const listed = udpUnsupportedSelectedProbes
                .slice(0, 3)
                .map(probe => probeDisplayName(probe))
                .join(', ')
            const extra = udpUnsupportedSelectedProbes.length > 3
                ? ` (+${udpUnsupportedSelectedProbes.length - 3} more)`
                : ''
            return `UDP scan is disabled on probe(s): ${listed}${extra}. Enable PROBE_ENABLE_UDP_SCAN=true on those probes and refresh before running UDP.`
        }
        if (scanScope === 'custom') {
            if (includesTcp) {
                if (customPortsParsed.error) return customPortsParsed.error
                if (usePortRange && rangeParsed.error) return rangeParsed.error
                if (usePortRange && !rangeParsed.range) return 'TCP port range is enabled but invalid.'
                if (!hasCustomTcpScopeInput) {
                    return 'Custom scope with TCP requires a TCP/generic custom list or range.'
                }
            }

            if (includesUdp) {
                if (customUdpPortsParsed.error) return customUdpPortsParsed.error
                if (!hasCustomUdpScopeInput && customPortsParsed.error) return customPortsParsed.error
                if (useUdpPortRange && udpRangeParsed.error) return udpRangeParsed.error
                if (useUdpPortRange && !udpRangeParsed.range) return 'UDP port range is enabled but invalid.'
                if (!hasCustomUdpScopeInput && !hasCustomTcpScopeInput) {
                    return 'Custom scope with UDP requires UDP custom ports/range or a generic custom scope.'
                }
            }

            if (!hasAnyCustomScopeInput) return 'Custom scope selected but no custom ports or range were provided.'
        }
        if (!plannedPortCount) return 'No ports selected for this scan.'
        if (useCustomTarget) {
            const target = customTarget.trim()
            if (!target) return 'Custom target is enabled but empty.'
            if (!isPublicIPv4(target)) return 'Custom target must be a public IPv4 address.'
        }
        return ''
    }

    function buildScanPayload() {
        const payload = {
            mode: effectiveScanMode,
            profile: scanProfile,
            transport: scanTransport,
            language: APP_LANGUAGE,
        }

        if (useCustomTarget && customTarget.trim()) {
            payload.target = customTarget.trim()
        }

        if (scanScope === 'custom') {
            if (customPortsParsed.ports.length) payload.ports = customPortsParsed.ports
            if (usePortRange && rangeParsed.range) payload.portRange = rangeParsed.range
            if (customUdpPortsParsed.ports.length) payload.udpPorts = customUdpPortsParsed.ports
            if (useUdpPortRange && udpRangeParsed.range) payload.udpPortRange = udpRangeParsed.range
        } else {
            if (plannedTcpPorts.length) payload.ports = plannedTcpPorts
            if (plannedUdpPorts.length) payload.udpPorts = plannedUdpPorts
        }

        return payload
    }

    async function runProbeScan(probe, payload, cancelToken) {
        const startedAtMs = Date.now()
        const startedAt = new Date(startedAtMs).toISOString()
        const requestedRuntimeTransport = resolveRuntimeTransport(payload.transport, payload.mode)
        const defaultProgress = normalizeScanProgress({
            phase: 'connect',
            transport: requestedRuntimeTransport,
            percent: 1,
            totalPorts: plannedPortCount,
            totalTcpPorts: plannedTcpCount,
            totalUdpPorts: plannedUdpCount,
            scannedPorts: 0,
            scannedTcpPorts: 0,
            scannedUdpPorts: 0,
            openPorts: 0,
            closedPorts: 0,
            filteredPorts: 0,
            openTcpPorts: 0,
            closedTcpPorts: 0,
            filteredTcpPorts: 0,
            openUdpPorts: 0,
            closedUdpPorts: 0,
            filteredUdpPorts: 0,
            servicePortsScanned: 0,
        }, plannedPortCount, 'connect')

        updateRun(probe.id, {
            probeId: probe.id,
            probeName: probeDisplayName(probe),
            probeUrl: probe.url,
            node: probe.info?.node || null,
            status: 'queued',
            phase: 'connect',
            progress: defaultProgress,
            mode: payload.mode,
            profile: payload.profile,
            transport: requestedRuntimeTransport,
            target: payload.target || 'auto',
            observedIp: probe.info?.observedIp || null,
            error: null,
            jobId: '',
            result: null,
            startedAt,
            finishedAt: null,
            updatedAtMs: startedAtMs,
        })

        try {
            const startResponse = await probeRequest(probe.url, '/scan/start', probe.apiKey, 'POST', payload)
            if (cancelToken.cancelled || runCancelRef.current !== cancelToken) return false

            const jobId = String(startResponse?.jobId || startResponse?.id || '').trim()
            if (!jobId) throw new Error('Probe did not return a job id.')
            const acceptedRuntimeTransport = resolveRuntimeTransport(
                startResponse?.transport || payload.transport,
                payload.mode,
            )
            if (acceptedRuntimeTransport !== requestedRuntimeTransport) {
                throw new Error(
                    `Probe transport mismatch. Requested ${formatTransport(requestedRuntimeTransport)} but probe accepted ${formatTransport(acceptedRuntimeTransport)}. Update probe backend and verify PROBE_ENABLE_UDP_SCAN.`,
                )
            }

            updateRun(probe.id, prev => ({
                ...prev,
                status: 'running',
                phase: 'queued',
                jobId,
                target: startResponse?.target || prev.target,
                observedIp: normalizeIpv4Like(startResponse?.observedIp || prev.observedIp || '') || null,
                node: normalizeNode(startResponse?.node || prev.node || {}),
                transport: acceptedRuntimeTransport,
                progress: normalizeScanProgress({
                    ...(prev.progress || {}),
                    phase: 'queued',
                    transport: startResponse?.transport || payload.transport,
                    percent: Math.max(4, Number(prev.progress?.percent) || 0),
                    totalPorts: Number(prev.progress?.totalPorts) || plannedPortCount,
                    totalTcpPorts: Number(prev.progress?.totalTcpPorts) || plannedTcpCount,
                    totalUdpPorts: Number(prev.progress?.totalUdpPorts) || plannedUdpCount,
                }, plannedPortCount, 'queued'),
                updatedAtMs: Date.now(),
            }))

            const timeoutMs = payload.mode === 'deep'
                ? 15 * 60 * 1000
                : payload.mode === 'advanced'
                    ? 10 * 60 * 1000
                    : 6 * 60 * 1000
            const timeoutAt = Date.now() + timeoutMs

            while (true) {
                if (cancelToken.cancelled || runCancelRef.current !== cancelToken) return false
                if (Date.now() > timeoutAt) throw new Error('Timed out waiting for probe result.')

                const pollPayload = await probeRequest(
                    probe.url,
                    `/scan/${encodeURIComponent(jobId)}`,
                    probe.apiKey,
                    'GET',
                    null,
                )
                if (cancelToken.cancelled || runCancelRef.current !== cancelToken) return false

                const normalized = normalizeJobPayload(pollPayload, payload.mode, payload.profile, payload.language || 'en')
                if (!normalized) throw new Error('Invalid scan payload returned by probe.')

                let progress = normalized.progress || defaultProgress
                if ((normalized.status === 'queued' || normalized.status === 'running') && progress.percent < 6) {
                    const heuristic = heuristicRunningProgress(
                        Date.now() - startedAtMs,
                        payload.mode,
                        normalized.transport || payload.transport,
                    )
                    progress = {
                        ...progress,
                        phase: progress.phase === 'connect' || progress.phase === 'queued' ? heuristic.phase : progress.phase,
                        percent: Math.max(progress.percent, heuristic.percent),
                    }
                }

                updateRun(probe.id, prev => ({
                    ...prev,
                    status: normalized.status,
                    phase: normalized.phase,
                    mode: normalized.mode,
                    profile: normalized.profile,
                    transport: normalized.transport || prev.transport,
                    target: normalized.target || prev.target,
                    observedIp: normalized.observedIp || prev.observedIp || null,
                    progress,
                    result: normalized.status === 'done' ? normalized.result : prev.result,
                    error: normalized.status === 'error' ? (normalized.error || 'Probe reported an error.') : null,
                    updatedAtMs: Date.now(),
                    finishedAt: normalized.status === 'done' || normalized.status === 'error'
                        ? new Date().toISOString()
                        : prev.finishedAt,
                }))

                if (normalized.status === 'done') {
                    if (!normalized.result) throw new Error('Scan completed without result payload.')
                    return true
                }
                if (normalized.status === 'error') {
                    throw new Error(normalized.error || 'Probe scan failed.')
                }

                await sleep(payload.mode === 'deep' ? 900 : 700)
            }
        } catch (error) {
            if (cancelToken.cancelled || runCancelRef.current !== cancelToken) return false

            updateRun(probe.id, prev => ({
                ...prev,
                status: 'error',
                phase: 'error',
                error: friendlyProbeError(error, 'scan'),
                finishedAt: new Date().toISOString(),
                progress: normalizeScanProgress({
                    ...(prev.progress || {}),
                    phase: 'error',
                    percent: Math.max(1, Number(prev.progress?.percent) || 0),
                }, plannedPortCount, 'error'),
                updatedAtMs: Date.now(),
            }))
            return false
        }
    }

    async function startScan() {
        if (scanState === 'running') return

        setScanError('')
        setSetupError('')

        const validationError = validateScanRequest()
        if (validationError) {
            setScanError(validationError)
            return
        }

        const payload = buildScanPayload()
        const startedAtIso = new Date().toISOString()

        const initialRuns = {}
        for (const probe of selectedProbes) {
            if (!probe.connected) {
                initialRuns[probe.id] = {
                    probeId: probe.id,
                    probeName: probeDisplayName(probe),
                    probeUrl: probe.url,
                    node: probe.info?.node || null,
                    status: 'error',
                    phase: 'error',
                    progress: normalizeScanProgress({
                        phase: 'error',
                        transport: resolveRuntimeTransport(payload.transport, payload.mode),
                        percent: 1,
                        totalPorts: plannedPortCount,
                        totalTcpPorts: plannedTcpCount,
                        totalUdpPorts: plannedUdpCount,
                    }, plannedPortCount, 'error'),
                    mode: payload.mode,
                    profile: payload.profile,
                    transport: resolveRuntimeTransport(payload.transport, payload.mode),
                    target: payload.target || 'auto',
                    observedIp: probe.info?.observedIp || null,
                    error: 'Probe is disconnected.',
                    jobId: '',
                    result: null,
                    startedAt: startedAtIso,
                    finishedAt: startedAtIso,
                    updatedAtMs: Date.now(),
                }
            } else {
                initialRuns[probe.id] = {
                    probeId: probe.id,
                    probeName: probeDisplayName(probe),
                    probeUrl: probe.url,
                    node: probe.info?.node || null,
                    status: 'queued',
                    phase: 'connect',
                    progress: normalizeScanProgress({
                        phase: 'connect',
                        transport: resolveRuntimeTransport(payload.transport, payload.mode),
                        percent: 1,
                        totalPorts: plannedPortCount,
                        totalTcpPorts: plannedTcpCount,
                        totalUdpPorts: plannedUdpCount,
                    }, plannedPortCount, 'connect'),
                    mode: payload.mode,
                    profile: payload.profile,
                    transport: resolveRuntimeTransport(payload.transport, payload.mode),
                    target: payload.target || 'auto',
                    observedIp: probe.info?.observedIp || null,
                    error: null,
                    jobId: '',
                    result: null,
                    startedAt: startedAtIso,
                    finishedAt: null,
                    updatedAtMs: Date.now(),
                }
            }
        }

        setProbeRuns(initialRuns)
        setActiveReportProbeId('')
        setPortStateFilter('all')
        setPortProtocolFilter('all')
        setPortSearch('')
        setReportPage(1)
        setScanElapsedMs(0)
        scanStartedAtRef.current = Date.now()

        const cancelToken = { cancelled: false }
        runCancelRef.current = cancelToken

        setScanState('running')
        setView('running')

        const tasks = connectedSelectedProbes.map(probe => runProbeScan(probe, payload, cancelToken))
        const taskResults = await Promise.all(tasks)

        if (runCancelRef.current !== cancelToken || cancelToken.cancelled) return

        const successCount = taskResults.filter(Boolean).length
        if (!successCount) {
            setScanError('All selected probes failed. Verify API keys, policies and target reachability.')
        }
        setScanState('done')
        setView('report')
    }

    function cancelScan() {
        runCancelRef.current.cancelled = true
        setScanState('done')
        setView('report')
        setScanError('Scan cancelled. Partial results are shown below.')
    }

    function goToSetup() {
        if (scanState === 'running') {
            runCancelRef.current.cancelled = true
            setScanState('done')
        }
        setView('setup')
    }

    async function openAgentRepo() {
        try {
            const result = await bridge.openExternal(AGENT_GITHUB_URL)
            if (result?.ok === false) throw new Error(result.error || 'open-failed')
        } catch {
            try {
                window.open(AGENT_GITHUB_URL, '_blank', 'noopener,noreferrer')
            } catch {
                setScanError('Could not open the agent repository link.')
            }
        }
    }

    const activePhaseSteps = phaseStepsForTransport(runtimeTransport)
    const activePhaseIndex = phaseIndexForSteps(overallPhase, activePhaseSteps)
    const riskBand = getRiskBand(aggregateSummary.avgRisk)
    const riskRatio = clamp((aggregateSummary.avgRisk || 0) / 100, 0, 1)
    const ringCirc = 2 * Math.PI * 52
    const ringOffset = ringCirc - (ringCirc * riskRatio)
    const runCards = Object.values(probeRuns)

    return (
        <div className={`v3-page-layout page-enter wp2-page wp2-view-${view}`}>
            <div className="v3-page-header">
                <div className="wp2-header">
                    <div>
                        <h1 className="v3-page-title">
                            <Shield size={24} color="var(--color-accent)" />
                            WAN Probe
                        </h1>
                        <p className="v3-page-subtitle">
                            Multi-probe WAN exposure analysis with synchronized quick, advanced and deep audit profiles.
                        </p>
                    </div>

                    <div className="wp2-header-actions">
                        <button className="v3-btn v3-btn-secondary wp2-agent-btn" onClick={openAgentRepo}>
                            <Github size={14} />
                            Agent GitHub
                        </button>
                        <button
                            className="v3-btn v3-btn-secondary"
                            onClick={() => setView('history')}
                            title="View past scan reports"
                        >
                            <History size={14} />
                            History
                        </button>
                        <button
                            className="v3-btn v3-btn-secondary"
                            onClick={goToSetup}
                            title="Go to setup to configure a new scan"
                        >
                            <SlidersHorizontal size={14} />
                            New Scan
                        </button>
                        <button
                            className="v3-btn v3-btn-secondary"
                            onClick={resetResultsView}
                            disabled={scanState === 'running' || !Object.keys(probeRuns).length}
                            title="Clear the current results and return to setup"
                        >
                            <RotateCcw size={14} />
                            Clear Results
                        </button>
                        {view === 'report' && (
                            <ExportMenu
                                kind="wan-probe"
                                size="md"
                                payload={buildReportPayload()}
                                disabled={!completedRuns.length}
                            />
                        )}
                        <button
                            className="v3-btn v3-btn-secondary"
                            onClick={copyAggregateReport}
                            disabled={!completedRuns.length}
                            title="Copy the full report payload as JSON to clipboard"
                        >
                            <Copy size={14} />
                            {copiedTag === 'all-json' ? 'Copied' : 'Copy JSON'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="wp2-stage-strip">
                {[
                    { key: 'setup', label: 'Setup', icon: <Plug size={13} /> },
                    { key: 'running', label: 'Scanning', icon: <Radar size={13} /> },
                    { key: 'report', label: 'Report', icon: <ShieldCheck size={13} /> },
                ].map(item => {
                    // The stage strip is a read-only breadcrumb of the
                    // current scan's flow — it tracks Setup → Scan →
                    // Report. History is a lateral view (saved reports,
                    // not a scan stage) so it lives in the header
                    // actions only; including it here confused users
                    // into clicking chips that can't navigate.
                    const active = item.key === 'setup'
                        ? view === 'setup'
                        : item.key === 'running'
                            ? scanState === 'running'
                            : view === 'report'
                    return (
                        <div key={item.key} className={`wp2-stage-chip ${active ? 'active' : ''}`}>
                            {item.icon}
                            {item.label}
                        </div>
                    )
                })}
            </div>

            {view === 'setup' && (
                <>
                    <div className="wp2-setup-grid">
                        <div className="wp2-setup-left">
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.18 }}
                                className="v3-card wp2-card wp2-scan-card"
                            >
                                <div className="v3-card-header">
                                    <div className="v3-card-title">
                                        <Radar size={16} color="var(--color-accent)" />
                                        Scan Profile
                                    </div>
                                    <span className="v3-badge info">
                                        {selectedProbes.length} selected / {connectedSelectedProbes.length} online
                                    </span>
                                </div>

                                <div className="wp2-flow-block">
                                    <div className="wp2-flow-head">
                                        <div className="wp2-flow-title"><Search size={13} />1) Port scope</div>
                                        <p>
                                            Select a preset set (Quick/Advanced/Deep) or define your own custom scope.
                                        </p>
                                    </div>

                                    <div className="wp2-scope-toggle">
                                        <button
                                            className={`wp2-scope-chip ${scanScope === 'preset' ? 'active' : ''}`}
                                            onClick={() => setScanScope('preset')}
                                        >
                                            Preset scope
                                        </button>
                                        <button
                                            className={`wp2-scope-chip ${scanScope === 'custom' ? 'active' : ''}`}
                                            onClick={() => setScanScope('custom')}
                                        >
                                            Custom scope
                                        </button>
                                    </div>

                                    <AnimatePresence initial={false} mode="wait">
                                        {scanScope === 'preset' ? (
                                            <motion.div
                                                key="preset-scope"
                                                initial={{ opacity: 0, y: 6 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -6 }}
                                                transition={{ duration: 0.18 }}
                                                className="wp2-mode-grid"
                                            >
                                                {Object.entries(MODE_PRESETS).map(([mode, preset]) => {
                                                    const scopeMeta = presetScopeMetaForMode(mode, scanTransport)
                                                    return (
                                                        <button
                                                            key={mode}
                                                            className={`wp2-mode-card ${scanMode === mode ? 'active' : ''}`}
                                                            onClick={() => {
                                                                setScanScope('preset')
                                                                setScanMode(mode)
                                                            }}
                                                        >
                                                            <span className="wp2-mode-head"><Zap size={14} />{preset.title}</span>
                                                            <p>{preset.description}</p>
                                                            <div className="wp2-mode-meta">
                                                                <span>{preset.eta}</span>
                                                                <span title={scopeMeta.details}>{scopeMeta.label}</span>
                                                            </div>
                                                        </button>
                                                    )
                                                })}
                                            </motion.div>
                                        ) : (
                                            <motion.div
                                                key="custom-scope"
                                                initial={{ opacity: 0, y: 6 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -6 }}
                                                transition={{ duration: 0.18 }}
                                                className="wp2-custom-scope-panel"
                                            >
                                                <label className="wp2-label">Generic / TCP port list</label>
                                                <textarea
                                                    className="v3-input selectable wp2-custom-textarea"
                                                    placeholder="22,80,443,8080"
                                                    value={customPortsInput}
                                                    onChange={event => {
                                                        const next = event.target.value
                                                        setCustomPortsInput(next)
                                                        if (next.trim()) setScanScope('custom')
                                                    }}
                                                />

                                                <label className="wp2-checkbox-line">
                                                    <input
                                                        type="checkbox"
                                                        checked={usePortRange}
                                                        onChange={event => {
                                                            setUsePortRange(event.target.checked)
                                                            if (event.target.checked) setScanScope('custom')
                                                        }}
                                                    />
                                                    Add generic/TCP range
                                                </label>
                                                <div className="wp2-range-grid">
                                                    <input
                                                        className="v3-input"
                                                        placeholder="TCP range from"
                                                        value={rangeFrom}
                                                        onChange={event => {
                                                            const next = event.target.value
                                                            setRangeFrom(next)
                                                            if (next.trim()) {
                                                                setUsePortRange(true)
                                                                setScanScope('custom')
                                                            }
                                                        }}
                                                    />
                                                    <input
                                                        className="v3-input"
                                                        placeholder="TCP range to"
                                                        value={rangeTo}
                                                        onChange={event => {
                                                            const next = event.target.value
                                                            setRangeTo(next)
                                                            if (next.trim()) {
                                                                setUsePortRange(true)
                                                                setScanScope('custom')
                                                            }
                                                        }}
                                                    />
                                                </div>

                                                {includesUdp && (
                                                    <>
                                                        <label className="wp2-label">UDP-specific override (optional)</label>
                                                        <textarea
                                                            className="v3-input selectable wp2-custom-textarea"
                                                            placeholder="53,67,68,123,161,1900"
                                                            value={customUdpPortsInput}
                                                            onChange={event => {
                                                                const next = event.target.value
                                                                setCustomUdpPortsInput(next)
                                                                if (next.trim()) setScanScope('custom')
                                                            }}
                                                        />
                                                        <label className="wp2-checkbox-line">
                                                            <input
                                                                type="checkbox"
                                                                checked={useUdpPortRange}
                                                                onChange={event => {
                                                                    setUseUdpPortRange(event.target.checked)
                                                                    if (event.target.checked) setScanScope('custom')
                                                                }}
                                                            />
                                                            Add UDP range override
                                                        </label>
                                                        <div className="wp2-range-grid">
                                                            <input
                                                                className="v3-input"
                                                                placeholder="UDP range from"
                                                                value={udpRangeFrom}
                                                                onChange={event => {
                                                                    const next = event.target.value
                                                                    setUdpRangeFrom(next)
                                                                    if (next.trim()) {
                                                                        setUseUdpPortRange(true)
                                                                        setScanScope('custom')
                                                                    }
                                                                }}
                                                            />
                                                            <input
                                                                className="v3-input"
                                                                placeholder="UDP range to"
                                                                value={udpRangeTo}
                                                                onChange={event => {
                                                                    const next = event.target.value
                                                                    setUdpRangeTo(next)
                                                                    if (next.trim()) {
                                                                        setUseUdpPortRange(true)
                                                                        setScanScope('custom')
                                                                    }
                                                                }}
                                                            />
                                                        </div>
                                                    </>
                                                )}

                                                <div className="wp2-runtime-hint">
                                                    <Sparkles size={13} />
                                                    Runtime mode <strong>{formatMode(effectiveScanMode)}</strong>, transport{' '}
                                                    <strong>{formatTransport(runtimeTransport)}</strong>, scope{' '}
                                                    <strong>{plannedPortLabel}</strong>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                <div className="wp2-flow-block">
                                <div className="wp2-flow-head">
                                    <div className="wp2-flow-title"><Wifi size={13} />2) Transport</div>
                                    <p>Select TCP, UDP, or both. Auto is always TCP for stable default behavior.</p>
                                </div>
                                    <div className="wp2-profile-grid">
                                        {Object.entries(TRANSPORT_PRESETS).map(([transportKey, preset]) => (
                                            <button
                                                key={transportKey}
                                                className={`wp2-profile-card ${scanTransport === transportKey ? 'active' : ''}`}
                                                onClick={() => setScanTransport(transportKey)}
                                            >
                                                <div className="wp2-profile-title">{preset.title}</div>
                                                <p>{preset.description}</p>
                                            </button>
                                        ))}
                                    </div>
                                    <div className="wp2-runtime-hint">
                                        <Info size={13} />
                                        Effective for this run: <strong>{formatTransport(resolveRuntimeTransport(scanTransport, effectiveScanMode))}</strong>
                                    </div>
                                    {includesUdp && (
                                        <div className="wp2-alert warn" style={{ marginTop: 10, marginBottom: 0 }}>
                                            <AlertCircle size={14} />
                                            UDP checks are slower and less deterministic than TCP. Use smaller ranges for faster and more reliable scans.
                                        </div>
                                    )}
                                </div>

                                <div className="wp2-flow-block">
                                    <div className="wp2-flow-head">
                                        <div className="wp2-flow-title"><Target size={13} />3) Target</div>
                                        <p>By default scans your observed WAN IP. Enable custom target to scan another public IPv4.</p>
                                    </div>
                                    <label className="wp2-checkbox-line">
                                        <input
                                            type="checkbox"
                                            checked={useCustomTarget}
                                            onChange={event => setUseCustomTarget(event.target.checked)}
                                        />
                                        Use custom public target (instead of auto observed IP)
                                    </label>
                                    <div className="wp2-input-wrap" style={{ marginBottom: 0 }}>
                                        <Target size={14} className="wp2-input-icon" />
                                        <input
                                            className="v3-input wp2-input-icon-pad"
                                            placeholder="Public IPv4 (example: 203.0.113.45)"
                                            value={customTarget}
                                            onChange={event => setCustomTarget(event.target.value)}
                                            disabled={!useCustomTarget}
                                        />
                                    </div>
                                </div>

                                <div className="wp2-flow-block">
                                    <div className="wp2-flow-head">
                                        <div className="wp2-flow-title"><Sparkles size={13} />4) Execution profile</div>
                                        <p>Controls timing/retries/concurrency. It does not change selected ports.</p>
                                    </div>
                                    <div className="wp2-profile-grid">
                                        {Object.entries(PROFILE_PRESETS).map(([profile, preset]) => (
                                            <button key={profile} className={`wp2-profile-card ${scanProfile === profile ? 'active' : ''}`} onClick={() => setScanProfile(profile)}>
                                                <div className="wp2-profile-title">{preset.title}</div>
                                                <p>{preset.description}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {scanScope === 'custom' && (
                                    customPortsParsed.error
                                    || (usePortRange && rangeParsed.error)
                                    || customUdpPortsParsed.error
                                    || (useUdpPortRange && udpRangeParsed.error)
                                ) && (
                                    <div className="wp2-alert error" style={{ marginTop: 10 }}>
                                        <AlertCircle size={14} />
                                        {customPortsParsed.error
                                            || rangeParsed.error
                                            || customUdpPortsParsed.error
                                            || udpRangeParsed.error}
                                    </div>
                                )}

                                {scanError && (
                                    <div className="wp2-alert error" style={{ marginTop: 10 }}>
                                        <AlertCircle size={14} />
                                        {scanError}
                                    </div>
                                )}

                                <div className="wp2-scan-summary">
                                    <span className="wp2-summary-pill"><Server size={12} /> Probes <strong>{connectedSelectedProbes.length}</strong></span>
                                    <span className="wp2-summary-pill"><Radar size={12} /> Scope <strong>{scopeLabel}</strong></span>
                                    <span className="wp2-summary-pill"><Zap size={12} /> Runtime <strong>{formatMode(effectiveScanMode)}</strong></span>
                                    <span className="wp2-summary-pill"><Wifi size={12} /> Transport <strong>{formatTransport(runtimeTransport)}</strong></span>
                                    <span className="wp2-summary-pill"><Sparkles size={12} /> Profile <strong>{formatProfile(scanProfile)}</strong></span>
                                    <span className="wp2-summary-pill"><Globe size={12} /> Target <strong>{selectedTargetLabel}</strong></span>
                                    <span className="wp2-summary-pill"><Search size={12} /> Planned <strong>{plannedPortLabel}</strong></span>
                                </div>

                                <button className="v3-btn v3-btn-primary wp2-main-btn" onClick={startScan}>
                                    <Play size={14} />
                                    Start Multi-Probe Scan
                                </button>
                            </motion.div>


                        </div>

                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.24 }}
                            className="v3-card wp2-card wp2-probe-pool-card"
                        >
                            <div className="v3-card-header">
                                <div className="v3-card-title">
                                    <Server size={16} color="var(--color-accent)" />
                                    Probe Pool
                                </div>
                                <div className="wp2-pool-header-right">
                                    <span className="v3-badge accent">{visibleProbes.length} shown / {probePool.length} total</span>
                                    <button className="v3-btn v3-btn-primary wp2-add-probe-btn" onClick={() => setShowAddModal(true)}>
                                        <Plus size={14} />
                                        Add Probe
                                    </button>
                                </div>
                            </div>

                            <div className="wp2-search-wrap wp2-probe-search">
                                <Search size={13} className="wp2-input-icon" />
                                <input
                                    className="v3-input wp2-input-icon-pad"
                                    placeholder="Search probe by name, URL, region or IP"
                                    value={probeSearch}
                                    onChange={event => setProbeSearch(event.target.value)}
                                />
                            </div>

                            {versionDrift.totalConnected > 0 && (
                                <div className="wp2-runtime-hint" style={{ marginTop: 10 }}>
                                    <Info size={13} />
                                    API version baseline <strong>{versionDrift.baselineVersion}</strong> | aligned{' '}
                                    <strong>{versionDrift.alignedCount}</strong> / <strong>{versionDrift.totalConnected}</strong> | unknown{' '}
                                    <strong>{versionDrift.unknownCount}</strong>
                                </div>
                            )}
                            {versionDrift.mismatchCount > 0 && (
                                <div className="wp2-alert warn" style={{ marginTop: 10, marginBottom: 10 }}>
                                    <AlertCircle size={13} />
                                    Version mismatch detected in: {versionDrift.mismatchNames.slice(0, 3).join(', ')}
                                    {versionDrift.mismatchCount > 3 ? ` (+${versionDrift.mismatchCount - 3} more)` : ''}. Use "Version" to verify each probe.
                                </div>
                            )}

                            {!visibleProbes.length ? (
                                <div className="wp2-empty">
                                    <Server size={20} style={{ opacity: .35, marginBottom: 4 }} />
                                    {probePool.length
                                        ? 'No probes match your search.'
                                        : 'No probes configured yet. Add one above using a token or manual entry.'}
                                </div>
                            ) : (
                                <div className="wp2-probe-list">
                                    {visibleProbes.map(probe => (
                                        <div key={probe.id} className={`wp2-probe-item ${probe.selected ? 'selected' : ''}`}>
                                            <label className="wp2-probe-check">
                                                <input
                                                    type="checkbox"
                                                    checked={probe.selected}
                                                    onChange={() => toggleProbeSelected(probe.id)}
                                                />
                                            </label>
                                            <div className="wp2-probe-main">
                                                <div className="wp2-probe-title-row">
                                                    <strong>{probeDisplayName(probe)}</strong>
                                                    <span className={`v3-badge ${probe.connected ? 'success' : 'warning'}`}>
                                                        {probe.connected ? 'Connected' : 'Offline'}
                                                    </span>
                                                </div>
                                                <div className="wp2-probe-sub mono">{probe.url}</div>
                                                <div className="wp2-probe-sub">
                                                    API: {maskApiKey(probe.apiKey)} | Last check: {formatTime(probe.lastCheckedAt)}
                                                </div>
                                                {probe.versionInfo && (
                                                    <div className="wp2-probe-sub">
                                                        Version: {probe.versionInfo.packageVersion || '-'} | API: {normalizeApiVersion(probe.versionInfo.apiVersion || probe.versionInfo.apiRevision) || '-'}
                                                    </div>
                                                )}
                                                {probe.info?.node?.region && (
                                                    <div className="wp2-probe-sub">
                                                        Node: {probe.info.node.region}{probe.info.node.country ? `, ${probe.info.node.country}` : ''}
                                                    </div>
                                                )}
                                                {probe.error ? (
                                                    <div className="wp2-alert error" style={{ marginTop: 8, marginBottom: 0 }}>
                                                        <AlertCircle size={13} />
                                                        {probe.error}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div className="wp2-probe-actions">
                                                <button className="v3-btn v3-btn-secondary" onClick={() => testProbe(probe.id)} disabled={probe.testing}>
                                                    {probe.testing ? <Loader2 size={13} className="spin-icon" /> : <Wifi size={13} />}
                                                    Test
                                                </button>
                                                <button
                                                    className="v3-btn v3-btn-secondary"
                                                    onClick={() => checkProbeVersion(probe.id)}
                                                    disabled={probe.checkingVersion}
                                                >
                                                    {probe.checkingVersion ? <Loader2 size={13} className="spin-icon" /> : <Info size={13} />}
                                                    Version
                                                </button>
                                                <button className="v3-btn v3-btn-danger" onClick={() => removeProbe(probe.id)}>
                                                    <Unplug size={13} />
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="wp2-probe-bulk">
                                <button className="v3-btn v3-btn-secondary" onClick={() => setAllSelected(true)}>
                                    <CheckCheck size={13} />
                                    Select All
                                </button>
                                <button className="v3-btn v3-btn-secondary" onClick={() => setAllSelected(false)}>
                                    <Unplug size={13} />
                                    Clear
                                </button>
                                <button className="v3-btn v3-btn-secondary" onClick={refreshAllSelected} disabled={!selectedProbes.length}>
                                    <RotateCcw size={13} />
                                    Refresh Selected
                                </button>
                            </div>
                        </motion.div>
                    </div>

                </>
            )}

            {view === 'running' && (
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22 }}
                    className="v3-card wp2-card wp2-run-card"
                    style={{ marginTop: 6 }}
                >
                    <div className="wp2-run-top">
                        <div className="wp2-progress-dial" style={{ '--wp-p': `${overallProgress}%` }}>
                            <div className="wp2-progress-inner">
                                <strong>{Math.round(overallProgress)}%</strong>
                                <span>{scanState === 'running' ? 'in progress' : 'completed'}</span>
                            </div>
                        </div>

                        <div className="wp2-run-main">
                            <h3>{phaseHeadline(overallPhase)}</h3>
                            <p>
                                Running {formatMode(effectiveScanMode)} / {formatProfile(scanProfile)} across{' '}
                                {connectedSelectedProbes.length || selectedProbes.length} probes.
                            </p>

                            <div className="wp2-progress-row">
                                <div className="wp2-progress-track">
                                    <div className="wp2-progress-fill" style={{ width: `${overallProgress}%` }} />
                                </div>
                                <span className="mono">{Math.round(overallProgress)}%</span>
                            </div>

                            <div className="wp2-run-meta">
                                <span><Clock size={12} /> Elapsed {formatDuration(scanElapsedMs)}</span>
                                <span><Globe size={12} /> Target {selectedTargetLabel}</span>
                                <span><Wifi size={12} /> Transport {formatTransport(runtimeTransport)}</span>
                                <span><Search size={12} /> Planned {plannedPortLabel}</span>
                                <span><Server size={12} /> Runs {runCards.length}</span>
                            </div>
                        </div>
                    </div>

                    <div className="wp2-live-grid">
                        <div className="wp2-metric tone-danger">
                            <div className="wp2-metric-icon"><ShieldAlert size={15} /></div>
                            <div className="wp2-metric-body"><span>Open ports</span><strong>{liveSummary.open}</strong></div>
                        </div>
                        <div className="wp2-metric tone-success">
                            <div className="wp2-metric-icon"><ShieldCheck size={15} /></div>
                            <div className="wp2-metric-body"><span>Closed ports</span><strong>{liveSummary.closed}</strong></div>
                        </div>
                        <div className="wp2-metric tone-muted">
                            <div className="wp2-metric-icon"><Clock size={15} /></div>
                            <div className="wp2-metric-body"><span>Service probes</span><strong>{liveSummary.servicePortsScanned}</strong></div>
                        </div>
                    </div>

                    <div className="wp2-step-grid">
                        {activePhaseSteps.map((step, index) => {
                            const isDone = activePhaseIndex > index || overallPhase === 'done'
                            const isActive = activePhaseIndex === index && overallPhase !== 'done'
                            return (
                                <div key={step.key} className={`wp2-step ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}>
                                    <div className="wp2-step-icon">{isDone ? <Check size={13} /> : index + 1}</div>
                                    <div>
                                        <div className="wp2-step-label">{step.label}</div>
                                        <div className="wp2-step-desc">{step.description}</div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {runCards.length > 0 && (
                        <div className="wp2-probe-run-scroll">
                            <div className="wp2-probe-run-grid">
                                {runCards.map(run => {
                                    const summary = summarizeRunResult(run.result)
                                    return (
                                        <div key={run.probeId} className="wp2-probe-run">
                                            <div className="wp2-probe-run-head">
                                                <strong>{run.probeName}</strong>
                                                <span className={`v3-badge ${runStatusBadge(run.status)}`}>{runStatusLabel(run.status)}</span>
                                            </div>
                                            <div className="wp2-probe-run-facts">
                                                <span className="wp2-probe-run-chip">{phaseCompactLabel(run.phase || 'connect')}</span>
                                                <span className="wp2-probe-run-chip">{formatTransport(run.transport || runtimeTransport)}</span>
                                                <span className="wp2-probe-run-chip">Open {summary.open}</span>
                                                {summary.findings > 0 ? <span className="wp2-probe-run-chip">Find {summary.findings}</span> : null}
                                                <span className="wp2-probe-run-chip">Risk {summary.risk}</span>
                                            </div>
                                            {run.error ? (
                                                <div className="wp2-probe-run-error" title={run.error}>
                                                    <AlertCircle size={13} />
                                                    {run.error}
                                                </div>
                                            ) : null}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {scanState === 'running' && (
                        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
                            <button className="v3-btn v3-btn-danger" onClick={cancelScan}>
                                <Unplug size={13} />
                                Cancel Scan
                            </button>
                        </div>
                    )}
                </motion.div>
            )}

            {view === 'report' && (
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.26 }}
                    className="wp2-results"
                >
                    {!completedRuns.length ? (
                        <div className="v3-card">
                            <div className="wp2-empty">
                                <Shield size={22} style={{ opacity: .3, marginBottom: 4 }} />
                                No completed run yet. Connect probes and launch a scan.
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="v3-card wp2-card wp2-report-card">
                                {/* Risk score hero row */}
                                <div className="wp2-report-hero">
                                    <div className="wp2-risk-card">
                                        <div className="wp2-risk-ring-wrap">
                                            <svg className="wp2-risk-ring" viewBox="0 0 120 120">
                                                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border-light)" strokeWidth="10" />
                                                <circle
                                                    cx="60"
                                                    cy="60"
                                                    r="52"
                                                    fill="none"
                                                    stroke={riskBand.color}
                                                    strokeWidth="10"
                                                    strokeLinecap="round"
                                                    strokeDasharray={ringCirc}
                                                    strokeDashoffset={ringOffset}
                                                    transform="rotate(-90 60 60)"
                                                />
                                            </svg>
                                            <div className="wp2-risk-center">
                                                <div className="wp2-risk-score">{aggregateSummary.avgRisk}</div>
                                                <span>risk</span>
                                            </div>
                                        </div>
                                        <div>
                                            <div className="wp2-risk-text" style={{ color: riskBand.color }}>
                                                <ShieldAlert size={14} />
                                                {riskBand.label}
                                            </div>
                                            <div className="wp2-risk-sub">Confidence {aggregateSummary.avgConfidence}%</div>
                                        </div>
                                    </div>

                                    {/* Stats: horizontal strip */}
                                    <div className="wp2-stats-strip">
                                        <div className="wp2-stat-item tone-danger">
                                            <ShieldAlert size={16} />
                                            <div className="wp2-stat-val">{aggregateSummary.open}</div>
                                            <div className="wp2-stat-lbl">Open</div>
                                        </div>
                                        <div className="wp2-stat-item tone-success">
                                            <ShieldCheck size={16} />
                                            <div className="wp2-stat-val">{aggregateSummary.closed}</div>
                                            <div className="wp2-stat-lbl">Closed</div>
                                        </div>
                                        <div className="wp2-stat-item tone-muted">
                                            <Shield size={16} />
                                            <div className="wp2-stat-val">{aggregateSummary.filtered}</div>
                                            <div className="wp2-stat-lbl">Filtered</div>
                                        </div>
                                        <div className="wp2-stat-item tone-accent">
                                            <AlertCircle size={16} />
                                            <div className="wp2-stat-val">{aggregateSummary.findings}</div>
                                            <div className="wp2-stat-lbl">Findings</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Severity chips + copy row */}
                                <div className="wp2-report-footer">
                                    <div className="wp2-severity-strip">
                                        {Object.keys(severityCounts).map(severity => (
                                            <span key={severity} className={`wp2-mini-chip ${severity}`}>
                                                {severity.toUpperCase()} {severityCounts[severity]}
                                            </span>
                                        ))}
                                    </div>
                                    <button className="v3-btn v3-btn-secondary" onClick={copyAggregateReport}>
                                        <Copy size={13} />
                                        {copiedTag === 'all-json' ? 'Copied' : 'Copy JSON'}
                                    </button>
                                </div>
                            </div>

                            <div className="v3-card wp2-card">
                                <div className="v3-card-header">
                                    <div className="v3-card-title">
                                        <Server size={16} color="var(--color-accent)" />
                                        Probe Reports
                                    </div>
                                    <span className="v3-badge accent">{completedRuns.length} completed</span>
                                </div>

                                <div className="wp2-report-probe-tabs">
                                    {completedRuns.map(run => (
                                        <button
                                            key={run.probeId}
                                            className={`wp2-report-probe-tab ${activeReportRun?.probeId === run.probeId ? 'active' : ''}`}
                                            onClick={() => setActiveReportProbeId(run.probeId)}
                                        >
                                            <span>{run.probeName}</span>
                                            <span className={`v3-badge ${runStatusBadge(run.status)}`}>Risk {run.result?.riskScore || 0}</span>
                                        </button>
                                    ))}
                                </div>

                                {activeReportRun?.result ? (
                                    <>
                                        <div className="wp2-run-meta" style={{ marginTop: 10 }}>
                                            <span><Target size={12} /> Target {activeReportRun.result.target}</span>
                                            <span><Globe size={12} /> Observed {activeReportRun.result.observedIp}</span>
                                            <span><Clock size={12} /> Duration {formatDuration(activeReportRun.result.durationMs)}</span>
                                            <span><Sparkles size={12} /> {formatMode(activeReportRun.result.mode)} / {formatProfile(activeReportRun.result.profile)}</span>
                                            <span><Wifi size={12} /> {formatTransport(activeReportRun.result.transport || 'tcp')}</span>
                                        </div>
                                        <button className="v3-btn v3-btn-secondary wp2-copy-json" onClick={copyActiveReport}>
                                            <Copy size={13} />
                                            {copiedTag === `run-json-${activeReportRun.probeId}` ? 'Copied' : 'Copy Probe JSON'}
                                        </button>

                                        <div style={{ marginTop: 12 }} className="wp2-findings-list">
                                            {activeReportRun.result.findings
                                                .slice()
                                                .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 10) - (SEVERITY_ORDER[b.severity] ?? 10))
                                                .map(finding => (
                                                    <div key={finding.id} className={`wp2-finding sev-${finding.severity}`}>
                                                        <div className="wp2-finding-head">
                                                            <span className={`wp2-sev-chip sev-${finding.severity}`}>
                                                                {SEVERITY_LABELS[finding.severity] || finding.severity}
                                                            </span>
                                                            <h4>{finding.title}</h4>
                                                            <span className="v3-badge info">{prettyCategory(finding.category)}</span>
                                                        </div>
                                                        {finding.evidence ? <p>{finding.evidence}</p> : null}
                                                        {finding.recommendation ? (
                                                            <div className="wp2-recommendation">
                                                                <CheckCircle size={13} />
                                                                {finding.recommendation}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                ))}
                                            {!activeReportRun.result.findings.length && (
                                                <div className="wp2-empty">No findings for this probe.</div>
                                            )}
                                        </div>

                                        <div style={{ marginTop: 12 }}>
                                            <div className="wp2-port-controls">
                                                <div className="wp2-port-filter-stack">
                                                    <div className="wp2-filter-row">
                                                        {PORT_STATE_FILTERS.map(filter => (
                                                            <button key={filter} className={`wp2-filter-btn ${portStateFilter === filter ? 'active' : ''}`} onClick={() => setPortStateFilter(filter)}>
                                                                {filter}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="wp2-filter-row">
                                                        {PORT_PROTOCOL_FILTERS.map(filter => (
                                                            <button key={filter} className={`wp2-filter-btn ${portProtocolFilter === filter ? 'active' : ''}`} onClick={() => setPortProtocolFilter(filter)}>
                                                                {filter}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="wp2-search-wrap">
                                                    <Search size={13} className="wp2-input-icon" />
                                                    <input
                                                        className="v3-input wp2-input-icon-pad"
                                                        placeholder="Search by port/service/state/protocol"
                                                        value={portSearch}
                                                        onChange={event => setPortSearch(event.target.value)}
                                                    />
                                                </div>
                                            </div>
                                            <div className="wp2-table-wrap">
                                                <table className="np-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Port</th>
                                                            <th>Protocol</th>
                                                            <th>State</th>
                                                            <th>Service</th>
                                                            <th>RTT</th>
                                                            <th>Attempts</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {pagedRows.map(row => (
                                                            <tr key={`${activeReportRun.probeId}:${row.protocol}:${row.port}`} className={`wp2-port-row ${row.state}`}>
                                                                <td className="mono">{row.port}</td>
                                                                <td className="mono">{String(row.protocol || 'tcp').toUpperCase()}</td>
                                                                <td><span className={`wp2-state-badge ${row.state}`}>{row.state}</span></td>
                                                                <td>{row.service}</td>
                                                                <td>{row.rttMs != null ? `${row.rttMs} ms` : '-'}</td>
                                                                <td>{row.attempts}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                            {!pagedRows.length && <div className="wp2-empty">No rows match the current filter.</div>}
                                            {filteredRows.length > 0 && (
                                                <div className="wp2-pagination">
                                                    <div className="wp2-pagination-info">
                                                        Showing {(reportPage - 1) * REPORT_PAGE_SIZE + 1}-{Math.min(reportPage * REPORT_PAGE_SIZE, filteredRows.length)} of {filteredRows.length} ({REPORT_PAGE_SIZE} per page)
                                                    </div>
                                                    <div className="wp2-pagination-controls">
                                                        <button
                                                            className="v3-btn v3-btn-secondary"
                                                            onClick={() => setReportPage(prev => Math.max(1, prev - 1))}
                                                            disabled={reportPage === 1}
                                                        >
                                                            Previous
                                                        </button>
                                                        <span className="wp2-pagination-page">Page {reportPage} / {totalReportPages}</span>
                                                        <button
                                                            className="v3-btn v3-btn-secondary"
                                                            onClick={() => setReportPage(prev => Math.min(totalReportPages, prev + 1))}
                                                            disabled={reportPage >= totalReportPages}
                                                        >
                                                            Next
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="wp2-empty">Select a completed probe to inspect evidence.</div>
                                )}
                            </div>
                        </>
                    )}
                </motion.div>
            )}

            {view === 'history' && (
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22 }}
                    className="wp2-history"
                >
                    <div className="v3-card">
                        <div className="v3-card-header">
                            <div className="v3-card-title">
                                <History size={16} color="var(--color-accent)" />
                                Scan history
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    className="v3-btn v3-btn-secondary"
                                    onClick={loadHistory}
                                    disabled={historyLoading}
                                    title="Refresh the history list"
                                >
                                    <RefreshCw size={14} className={historyLoading ? 'spin-icon' : ''} />
                                    Refresh
                                </button>
                                <button
                                    className="v3-btn v3-btn-secondary"
                                    onClick={clearHistoryEntries}
                                    disabled={!historyRows.length || historyLoading}
                                    title="Delete every saved report"
                                    style={{ color: 'var(--color-danger, #ef4444)' }}
                                >
                                    <Trash2 size={14} />
                                    Clear All
                                </button>
                            </div>
                        </div>

                        {!historyRows.length ? (
                            <div className="wp2-empty" style={{ padding: '22px 12px', textAlign: 'center' }}>
                                {historyLoading
                                    ? <>Loading…</>
                                    : <>No saved scans yet. Reports are auto-saved when a scan completes.</>
                                }
                            </div>
                        ) : (
                            <div className="wp2-history-list">
                                {historyRows.map(row => {
                                    const report = row.report
                                    const ts = row.timestamp ? new Date(row.timestamp) : null
                                    const tsLabel = ts && !isNaN(ts) ? ts.toLocaleString() : '—'
                                    const target = row.target || report?.target || '—'
                                    const probes = row.probes ?? (Array.isArray(report?.probes) ? report.probes.length : 0)
                                    const findings = row.findings ?? (Array.isArray(report?.findings) ? report.findings.length : 0)
                                    const risk = row.risk_score ?? report?.summary?.riskScore ?? 0
                                    return (
                                        <div key={row.id} className="wp2-history-item">
                                            <div className="wp2-history-item-main">
                                                <div className="wp2-history-item-top">
                                                    <strong className="mono">{target}</strong>
                                                    <span className={`wp2-history-risk wp2-history-risk-${risk >= 70 ? 'high' : risk >= 40 ? 'mid' : risk >= 15 ? 'low' : 'ok'}`}>
                                                        Risk {risk}/100
                                                    </span>
                                                </div>
                                                <div className="wp2-history-item-sub">
                                                    {tsLabel} · {probes} probe{probes === 1 ? '' : 's'} · {findings} finding{findings === 1 ? '' : 's'}
                                                </div>
                                            </div>
                                            <div className="wp2-history-item-actions">
                                                <button
                                                    className="v3-btn v3-btn-secondary"
                                                    onClick={() => openHistoryReport(row)}
                                                    title="Load this report into the Report tab"
                                                >
                                                    <ShieldCheck size={14} />
                                                    Open
                                                </button>
                                                <button
                                                    className="v3-btn v3-btn-secondary"
                                                    onClick={() => deleteHistoryEntry(row.id)}
                                                    title="Delete this saved report"
                                                    style={{ color: 'var(--color-danger, #ef4444)' }}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </motion.div>
            )}

            {/* Add Probe Modal — portaled to body so it covers sidebar & topbar */}
            {showAddModal && createPortal(
                    <div
                        className="wp2-modal-overlay wp2-modal-open"
                        onClick={() => setShowAddModal(false)}
                    >
                        <div
                            className="wp2-modal wp2-modal-enter"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="wp2-modal-header">
                                <h3><Plug size={16} /> Add Probe Server</h3>
                                <button className="wp2-modal-close" onClick={() => setShowAddModal(false)} aria-label="Close">
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="wp2-modal-body">
                                <label className="wp2-label">Token import</label>
                                <div className="wp2-token-row">
                                    <textarea
                                        className="v3-input wp2-token-input"
                                        placeholder="NDUO_PROBE_V1:..."
                                        value={tokenInput}
                                        onChange={event => setTokenInput(event.target.value)}
                                    />
                                    <button className="v3-btn v3-btn-secondary" onClick={applyToken}>
                                        <KeyRound size={14} />
                                        Apply
                                    </button>
                                </div>
                                {tokenMeta && (
                                    <div className="wp2-token-meta">
                                        <CheckCircle size={14} />
                                        Token parsed
                                    </div>
                                )}

                                <div className="wp2-divider"><span>or manual entry</span></div>

                                <div className="wp2-input-wrap">
                                    <Server size={14} className="wp2-input-icon" />
                                    <input
                                        className="v3-input wp2-input-icon-pad"
                                        value={newProbeName}
                                        onChange={event => setNewProbeName(event.target.value)}
                                        placeholder="Probe label (optional)"
                                    />
                                </div>

                                <div className="wp2-input-wrap">
                                    <Globe size={14} className="wp2-input-icon" />
                                    <input
                                        className="v3-input wp2-input-icon-pad"
                                        value={newProbeUrl}
                                        onChange={event => setNewProbeUrl(event.target.value)}
                                        placeholder="https://probe.example.com:9443"
                                    />
                                </div>

                                <div className="wp2-input-wrap">
                                    <Lock size={14} className="wp2-input-icon" />
                                    <input
                                        className="v3-input wp2-input-icon-pad wp2-key-input"
                                        type={showNewProbeKey ? 'text' : 'password'}
                                        value={newProbeKey}
                                        onChange={event => setNewProbeKey(event.target.value)}
                                        placeholder="API key"
                                    />
                                    <button
                                        type="button"
                                        className="wp2-eye-btn"
                                        onClick={() => setShowNewProbeKey(v => !v)}
                                        aria-label={showNewProbeKey ? 'Hide API key' : 'Show API key'}
                                    >
                                        {showNewProbeKey ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                </div>

                                {setupError && (
                                    <div className="wp2-alert error">
                                        <AlertCircle size={14} />
                                        {setupError}
                                    </div>
                                )}
                            </div>

                            <div className="wp2-modal-footer">
                                <button className="v3-btn v3-btn-secondary" onClick={() => { clearProbeInputs(); setShowAddModal(false) }}>
                                    Cancel
                                </button>
                                <button className="v3-btn v3-btn-primary" onClick={addProbe}>
                                    <Plug size={14} />
                                    Add Probe
                                </button>
                            </div>
                        </div>
                    </div>,
                document.body
            )}
        </div>
    )
}
