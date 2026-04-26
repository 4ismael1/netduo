import { useState, useEffect, useMemo, useRef } from 'react'
import {
    Radar, Search, Router, Monitor, Smartphone, Laptop, Printer,
    Tv, HardDrive, Cpu, Wifi, Server, HelpCircle, Loader2,
    X, Globe, Clock, Signal, Shield, ShieldCheck, ChevronRight, RefreshCw,
    Shuffle, Home, AlertCircle, Tag, XCircle, Eye, EyeOff,
    Gamepad2, Speaker, Camera, Lightbulb, Watch, Headphones, Thermometer,
    Tv2, Mic, Radio, Plug, Webcam, ArrowUp, ArrowDown, ArrowUpDown
} from 'lucide-react'
import bridge from '../../lib/electronBridge'
import { logBridgeWarning } from '../../lib/devLog.js'
import { validateLanScanInputs } from '../../lib/validation'
import useNetworkStatus from '../../lib/useNetworkStatus.jsx'
import { mergeScanWithInventory, primaryLabel, isHideableWhenOffline, stableKey, unscopeKey } from '../../lib/deviceInventory'
import { resolveVendorKey, resolveHostnameHint, cleanVendorName } from '../../lib/vendorClassify'
import ExportMenu from '../../components/ExportMenu/ExportMenu'
import DeviceMetaEditor from '../../components/DeviceMetaEditor/DeviceMetaEditor'
import './Scanner.css'

/* ═══════════════════════════════════════════════════════════
   Tuning constants. Named so future readers don't have to
   reverse-engineer them from magic numbers buried in the body.
   ═══════════════════════════════════════════════════════════ */

/** Batch size for each IPC round-trip of the ping sweep. 30 IPs per
 *  call keeps the main process responsive and the renderer's progress
 *  bar smooth while still respecting the backend's own concurrency. */
const SCAN_BATCH_SIZE = 30

/** Number of ICMP probes sent when opening a device's detail panel.
 *  Seen-only devices (ARP-only discovery) get a lighter probe because
 *  they're likely sleeping / behind a strict firewall. */
const DIAG_PING_COUNT_LIVE = 5
const DIAG_PING_COUNT_SEEN = 2

/** Per-probe timeouts (ms) for the detail panel's ping. Seen-only hosts
 *  get a longer leash since their reply is expected to be slower. */
const DIAG_PING_TIMEOUT_LIVE = 12000
const DIAG_PING_TIMEOUT_SEEN = 5000

/** Overall budget (ms) for the detail panel's TCP port scan. */
const DIAG_PORTSCAN_TIMEOUT_LIVE = 8000
const DIAG_PORTSCAN_TIMEOUT_SEEN = 4000

/** Per-port connection timeout (ms) when the detail panel probes. */
const DIAG_PORT_TIMEOUT_LIVE = 1500
const DIAG_PORT_TIMEOUT_SEEN = 800

/** Commonly-probed TCP ports for the device detail panel. Kept short
 *  on purpose — the full port scanner lives in Diagnostics. */
const DIAG_PORTS = [22, 53, 80, 443, 3389, 5000, 8080, 8443, 9090]

/* ═══════════════════════════════════════
   Device type catalogue — maps vendor or
   classification key → icon / color / type string.
   OUI lookup now happens on the backend via
   the comprehensive oui-db.js module.
   ═══════════════════════════════════════ */
const DEV_TYPES = {
    // ── Phones / Laptops / Desktops ─────────────────────────────
    'Apple':     { type: 'Apple Device', Icon: Laptop, color: '#0ea5e9' },
    'Samsung':   { type: 'Samsung Device', Icon: Smartphone, color: '#6366f1' },
    'Xiaomi':    { type: 'Phone', Icon: Smartphone, color: '#f97316' },
    'OnePlus':   { type: 'Phone', Icon: Smartphone, color: '#ef4444' },
    'OPPO':      { type: 'Phone', Icon: Smartphone, color: '#22c55e' },
    'Vivo':      { type: 'Phone', Icon: Smartphone, color: '#3b82f6' },
    'Motorola':  { type: 'Phone / Modem', Icon: Smartphone, color: '#3b82f6' },
    'Huawei':    { type: 'Phone / Router', Icon: Smartphone, color: '#ef4444' },
    'Honor':     { type: 'Phone', Icon: Smartphone, color: '#0ea5e9' },
    'Nokia':     { type: 'Phone', Icon: Smartphone, color: '#1e40af' },
    'Google':    { type: 'Smart Device', Icon: Wifi, color: '#22c55e' },
    'Intel':     { type: 'Computer', Icon: Cpu, color: '#3b82f6' },
    'Microsoft': { type: 'PC / Hyper-V', Icon: Monitor, color: '#0ea5e9' },
    'Dell':      { type: 'Computer', Icon: Monitor, color: '#3b82f6' },
    'Lenovo':    { type: 'Computer', Icon: Monitor, color: '#e11d48' },
    'Acer':      { type: 'Computer', Icon: Monitor, color: '#16a34a' },
    'ASUS':      { type: 'Router / PC', Icon: Router, color: '#8b5cf6' },
    'MSI':       { type: 'Computer', Icon: Monitor, color: '#dc2626' },
    'Razer':     { type: 'Gaming PC', Icon: Monitor, color: '#22c55e' },
    'Alienware': { type: 'Gaming PC', Icon: Monitor, color: '#8b5cf6' },

    // ── Network infrastructure ──────────────────────────────────
    'TP-Link':   { type: 'Router / AP', Icon: Router, color: '#0ea5e9' },
    'Tenda':     { type: 'Router / AP', Icon: Router, color: '#6366f1' },
    'Netgear':   { type: 'Router / AP', Icon: Router, color: '#f59e0b' },
    'D-Link':    { type: 'Router / AP', Icon: Router, color: '#f59e0b' },
    'Linksys':   { type: 'Router / AP', Icon: Router, color: '#0ea5e9' },
    'Belkin':    { type: 'Router / AP', Icon: Router, color: '#64748b' },
    'ZTE':       { type: 'Router / Modem', Icon: Router, color: '#3b82f6' },
    'Technicolor': { type: 'Router / Modem', Icon: Router, color: '#8b5cf6' },
    'MikroTik':  { type: 'Router / Infra', Icon: Router, color: '#f59e0b' },
    'Cisco':     { type: 'Network Infra', Icon: Server, color: '#64748b' },
    'Ubiquiti':  { type: 'Network Infra', Icon: Server, color: '#0ea5e9' },
    'Aruba':     { type: 'Network Infra', Icon: Server, color: '#f59e0b' },
    'Juniper':   { type: 'Network Infra', Icon: Server, color: '#10b981' },
    'Fortinet':  { type: 'Firewall', Icon: Shield, color: '#dc2626' },
    'SonicWall': { type: 'Firewall', Icon: Shield, color: '#f97316' },

    // ── Printers ────────────────────────────────────────────────
    'HP':        { type: 'Computer / Printer', Icon: Printer, color: '#3b82f6' },
    'Canon':     { type: 'Printer / Camera', Icon: Printer, color: '#dc2626' },
    'Epson':     { type: 'Printer', Icon: Printer, color: '#0ea5e9' },
    'Brother':   { type: 'Printer', Icon: Printer, color: '#8b5cf6' },
    'Ricoh':     { type: 'Printer', Icon: Printer, color: '#f59e0b' },
    'Xerox':     { type: 'Printer', Icon: Printer, color: '#dc2626' },
    'Kyocera':   { type: 'Printer', Icon: Printer, color: '#64748b' },

    // ── TVs / Streaming ─────────────────────────────────────────
    'LG':        { type: 'Smart TV', Icon: Tv2, color: '#e11d48' },
    'Sony':      { type: 'TV / Console', Icon: Tv2, color: '#1e293b' },
    'Vizio':     { type: 'Smart TV', Icon: Tv2, color: '#3b82f6' },
    'TCL':       { type: 'Smart TV', Icon: Tv2, color: '#dc2626' },
    'Hisense':   { type: 'Smart TV', Icon: Tv2, color: '#16a34a' },
    'Roku':      { type: 'Streaming Stick', Icon: Tv, color: '#8b5cf6' },
    'Chromecast': { type: 'Chromecast', Icon: Tv, color: '#ef4444' },
    'Amazon':    { type: 'Echo / Fire TV', Icon: Speaker, color: '#f59e0b' },

    // ── Game consoles ───────────────────────────────────────────
    'Nintendo':  { type: 'Nintendo Console', Icon: Gamepad2, color: '#dc2626' },
    'PlayStation': { type: 'PlayStation', Icon: Gamepad2, color: '#1e40af' },
    'Xbox':      { type: 'Xbox', Icon: Gamepad2, color: '#16a34a' },
    'Valve':     { type: 'Steam Deck', Icon: Gamepad2, color: '#0ea5e9' },

    // ── Smart home / IoT ────────────────────────────────────────
    'Ring':      { type: 'Security Camera', Icon: Camera, color: '#0ea5e9' },
    'Wyze':      { type: 'Smart Camera', Icon: Camera, color: '#22c55e' },
    'Arlo':      { type: 'Smart Camera', Icon: Camera, color: '#3b82f6' },
    'Eufy':      { type: 'Smart Camera', Icon: Camera, color: '#16a34a' },
    'Hikvision': { type: 'IP Camera', Icon: Webcam, color: '#dc2626' },
    'Dahua':     { type: 'IP Camera', Icon: Webcam, color: '#f97316' },
    'Axis':      { type: 'IP Camera', Icon: Webcam, color: '#0ea5e9' },
    'Nest':      { type: 'Nest Smart Home', Icon: Thermometer, color: '#22c55e' },
    'Ecobee':    { type: 'Smart Thermostat', Icon: Thermometer, color: '#f59e0b' },
    'Philips Hue': { type: 'Smart Light', Icon: Lightbulb, color: '#f59e0b' },
    'Sonos':     { type: 'Speaker', Icon: Speaker, color: '#000000' },
    'Bose':      { type: 'Speaker', Icon: Speaker, color: '#1e293b' },
    'Harman':    { type: 'Speaker / Audio', Icon: Speaker, color: '#f97316' },
    'Tuya':      { type: 'Smart Device', Icon: Plug, color: '#f59e0b' },
    'TP-Link Kasa': { type: 'Smart Plug', Icon: Plug, color: '#0ea5e9' },
    'Shelly':    { type: 'Smart Relay', Icon: Plug, color: '#3b82f6' },
    'Dyson':     { type: 'Smart Appliance', Icon: Wifi, color: '#8b5cf6' },
    'iRobot':    { type: 'Robot Vacuum', Icon: Radio, color: '#16a34a' },
    'Fitbit':    { type: 'Wearable', Icon: Watch, color: '#0ea5e9' },
    'Garmin':    { type: 'Wearable', Icon: Watch, color: '#1e40af' },

    // ── Storage / Servers ───────────────────────────────────────
    'Synology':  { type: 'NAS', Icon: HardDrive, color: '#3b82f6' },
    'QNAP':      { type: 'NAS', Icon: HardDrive, color: '#0ea5e9' },
    'Western Digital': { type: 'NAS / Storage', Icon: HardDrive, color: '#1e40af' },
    'VMware':    { type: 'Virtual Machine', Icon: Server, color: '#64748b' },
    'Proxmox':   { type: 'Hypervisor', Icon: Server, color: '#f59e0b' },
    'Supermicro': { type: 'Server', Icon: Server, color: '#3b82f6' },

    // ── Dev boards / chips ──────────────────────────────────────
    'Espressif': { type: 'IoT / ESP Board', Icon: Cpu, color: '#22c55e' },
    'Raspberry Pi': { type: 'Raspberry Pi', Icon: HardDrive, color: '#dc2626' },
    'Realtek':   { type: 'Network Adapter', Icon: Cpu, color: '#94a3b8' },
    'Broadcom':  { type: 'Network Chip', Icon: Cpu, color: '#94a3b8' },
    'MediaTek':  { type: 'Network Chip', Icon: Cpu, color: '#94a3b8' },
    'Qualcomm':  { type: 'Network Chip', Icon: Cpu, color: '#94a3b8' },

    // ── Peripherals ─────────────────────────────────────────────
    'Logitech':  { type: 'Peripheral', Icon: Headphones, color: '#0ea5e9' },
    'Plantronics': { type: 'Headset', Icon: Headphones, color: '#1e293b' },
    'Jabra':     { type: 'Headset', Icon: Headphones, color: '#dc2626' },
    'GoPro':     { type: 'Camera', Icon: Camera, color: '#000000' },

    // Discovery-derived generic profiles (SSDP/mDNS/hostname hints)
    'Printer':   { type: 'Printer', Icon: Printer, color: '#64748b' },
    'IP Camera': { type: 'IP Camera', Icon: Webcam, color: '#0ea5e9' },
    'Speaker':   { type: 'Speaker', Icon: Speaker, color: '#64748b' },
    'Smart TV':  { type: 'Smart TV', Icon: Tv2, color: '#3b82f6' },
    'Smart Plug': { type: 'Smart Plug', Icon: Plug, color: '#f59e0b' },
    'Smart Light': { type: 'Smart Light', Icon: Lightbulb, color: '#f59e0b' },
    'Thermostat': { type: 'Smart Thermostat', Icon: Thermometer, color: '#f59e0b' },
    'NAS':       { type: 'NAS', Icon: HardDrive, color: '#3b82f6' },
}


const SPECIAL_TYPES = {
    '_Gateway':    { type: 'Gateway / Router', Icon: Router, color: '#10b981' },
    '_ThisDevice': { type: 'This Device', Icon: Home, color: '#3b82f6' },
    '_Randomized': { type: 'Randomized MAC', Icon: Shuffle, color: '#8b5cf6' },
    '_NetworkDev': { type: 'Network Device', Icon: Globe, color: '#64748b' },
}
const DEF = { type: 'Unknown', Icon: HelpCircle, color: '#94a3b8' }

/**
 * Icon + colour profile for each value in the DeviceMetaEditor's
 * "Device type" dropdown. When the user explicitly picks a type from
 * that dropdown (anything other than "Auto-detect"), classifyDevice()
 * looks up the picked value here so the device row in the table
 * immediately reflects it — same icon, same colour swatch, same label
 * in the Type column. Without this map the user's choice was saved to
 * the DB but invisible in the list because classifyDevice ignored
 * `typeOverride` and re-derived the icon from vendor/hostname every
 * render.
 *
 * Keys here MUST match the `value` field of DEVICE_TYPE_OPTIONS in
 * src/components/DeviceMetaEditor/deviceTypes.js.
 */
const TYPE_OVERRIDE_PROFILES = {
    'Router / AP':      { type: 'Router / AP', Icon: Router, color: '#0ea5e9' },
    'Network Device':   { type: 'Network Device', Icon: Globe, color: '#64748b' },
    'Computer':         { type: 'Computer', Icon: Monitor, color: '#3b82f6' },
    'Gaming PC':        { type: 'Gaming PC', Icon: Monitor, color: '#8b5cf6' },
    'Phone':            { type: 'Phone', Icon: Smartphone, color: '#f97316' },
    'Tablet':           { type: 'Tablet', Icon: Smartphone, color: '#0ea5e9' },
    'Apple Device':     { type: 'Apple Device', Icon: Laptop, color: '#0ea5e9' },
    'Samsung Device':   { type: 'Samsung Device', Icon: Smartphone, color: '#6366f1' },
    'Smart TV':         { type: 'Smart TV', Icon: Tv2, color: '#3b82f6' },
    'Streaming Stick':  { type: 'Streaming Stick', Icon: Tv, color: '#8b5cf6' },
    'Game Console':     { type: 'Game Console', Icon: Gamepad2, color: '#16a34a' },
    'Printer':          { type: 'Printer', Icon: Printer, color: '#64748b' },
    'NAS':              { type: 'NAS', Icon: HardDrive, color: '#3b82f6' },
    'Server':           { type: 'Server', Icon: Server, color: '#3b82f6' },
    'IP Camera':        { type: 'IP Camera', Icon: Webcam, color: '#0ea5e9' },
    'Smart Camera':     { type: 'Smart Camera', Icon: Camera, color: '#22c55e' },
    'Speaker':          { type: 'Speaker', Icon: Speaker, color: '#64748b' },
    'Smart Light':      { type: 'Smart Light', Icon: Lightbulb, color: '#f59e0b' },
    'Smart Plug':       { type: 'Smart Plug', Icon: Plug, color: '#f59e0b' },
    'Smart Thermostat': { type: 'Smart Thermostat', Icon: Thermometer, color: '#f59e0b' },
    'Smart Appliance':  { type: 'Smart Appliance', Icon: Wifi, color: '#8b5cf6' },
    'Wearable':         { type: 'Wearable', Icon: Watch, color: '#0ea5e9' },
    'IoT / ESP Board':  { type: 'IoT / ESP Board', Icon: Cpu, color: '#22c55e' },
    'Virtual Machine':  { type: 'Virtual Machine', Icon: Server, color: '#64748b' },
    'Firewall':         { type: 'Firewall', Icon: Shield, color: '#dc2626' },
    'Randomized MAC':   { type: 'Randomized MAC', Icon: Shuffle, color: '#8b5cf6' },
    'Unknown':          { type: 'Unknown', Icon: HelpCircle, color: '#94a3b8' },
}

/** Source badge colors */
const SRC_COLORS = {
    ptr:     { bg: 'rgba(16,185,129,0.1)', fg: '#10b981', label: 'PTR' },
    netbios: { bg: 'rgba(59,130,246,0.1)', fg: '#3b82f6', label: 'NetBIOS' },
    mdns:    { bg: 'rgba(139,92,246,0.1)', fg: '#8b5cf6', label: 'mDNS' },
    ssdp:    { bg: 'rgba(14,165,233,0.12)', fg: '#0284c7', label: 'SSDP' },
    oui:     { bg: 'rgba(245,158,11,0.1)', fg: '#f59e0b', label: 'OUI' },
    'oui-derived': { bg: 'rgba(234,179,8,0.14)', fg: '#ca8a04', label: 'OUI*' },
    macvendors: { bg: 'rgba(244,63,94,0.1)', fg: '#f43f5e', label: 'MAC API' },
}

/**
 * Classify a device — backend now provides vendor, hostname, flags.
 * This just does UI enrichment (icon, color, type label).
 */
function classifyDevice(d) {
    if (d.isLocal) return { ...SPECIAL_TYPES['_ThisDevice'] }

    // User override wins over auto-detect. If the user picked a type
    // from the DeviceMetaEditor dropdown (anything other than the
    // "Auto-detect" empty value), surface it directly: same icon and
    // colour swatch as the matching dropdown choice. We do this BEFORE
    // the gateway/vendor logic so that even a re-labelled gateway
    // honours the user's choice for the type column + icon (the GW
    // pill badge in the row is rendered independently and stays).
    if (d.typeOverride) {
        const profile = TYPE_OVERRIDE_PROFILES[d.typeOverride]
        if (profile) return { ...profile }
        // Unknown override value — fall through to auto-detect rather
        // than render the literal string with a default icon.
    }

    const discoveryText = [
        d.hostname,
        d.displayName,
        d.modelName,
        d.modelDescription,
        d.ssdpDeviceType,
        Array.isArray(d.serviceTypes) ? d.serviceTypes.join(' ') : '',
    ].filter(Boolean).join(' ')

    // Vendor resolution: first try an exact DEV_TYPES key, then fall back
    // to fuzzy pattern matching on the raw OUI, then to hostname hints.
    const vendorKey =
        (d.vendor && DEV_TYPES[d.vendor] ? d.vendor : null) ||
        resolveVendorKey(d.vendor) ||
        resolveHostnameHint(discoveryText)
    const vendorProfile = vendorKey ? DEV_TYPES[vendorKey] : null

    if (d.isGateway) {
        // Qualify the Gateway label with vendor only when we resolved a
        // clean key (e.g. "Gateway (Tenda)") — avoids dumping the full OUI
        // description when we only have a raw corporate string.
        if (vendorKey) return { ...SPECIAL_TYPES['_Gateway'], type: `Gateway · ${vendorKey}` }
        // Fall back to a cleaned vendor name if available.
        const cleaned = cleanVendorName(d.vendor)
        if (cleaned && cleaned.length <= 24) {
            return { ...SPECIAL_TYPES['_Gateway'], type: `Gateway · ${cleaned}` }
        }
        return { ...SPECIAL_TYPES['_Gateway'] }
    }

    if (vendorProfile) return { ...vendorProfile }

    // No pattern match but we DO have a vendor string — surface it in the
    // type column instead of hiding it behind a generic "Network Device".
    // We only do this when the cleaned vendor is short enough to be
    // readable; otherwise we keep the generic label so the layout stays
    // predictable.
    if (d.vendor && !d.isRandomized) {
        const cleaned = cleanVendorName(d.vendor)
        if (cleaned && cleaned.length > 0 && cleaned.length <= 22) {
            return { ...SPECIAL_TYPES['_NetworkDev'], type: cleaned }
        }
    }

    if (d.isRandomized) return { ...SPECIAL_TYPES['_Randomized'] }

    if (d.mac && !d.macEmpty) return { ...SPECIAL_TYPES['_NetworkDev'] }

    return { ...DEF }
}

function extractSubnet(ip) {
    if (!ip) return null
    const p = ip.split('.')
    if (p.length === 4) { p.pop(); return p.join('.') }
    return null
}

/**
 * sessionStorage helpers for the Scanner's inventory / networkId.
 *
 * Re-entering the Scanner route remounts the component and resets all
 * useState hooks. Without a sync hydration source the user sees an
 * empty list for the ~100-200ms it takes to:
 *   1. Resolve gateway MAC via ARP (one IPC round-trip)
 *   2. Read the inventory rows from SQLite (another IPC round-trip)
 *
 * sessionStorage is the right scope: the cache lives for the app
 * session only (cleared when the Electron window closes), it's
 * synchronously readable inside a useState initializer, and it's
 * automatically isolated per BrowserWindow.
 *
 * The cache is OVERWRITTEN by the live DB load — it never serves as
 * the source of truth, only as a first-paint placeholder.
 */
const SESSION_INVENTORY_KEY = 'netduo.scanner.inventory'
const SESSION_NETWORK_KEY = 'netduo.scanner.networkId'

function readSessionInventory() {
    try {
        const raw = sessionStorage.getItem(SESSION_INVENTORY_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
}

function readSessionNetworkId() {
    try {
        const raw = sessionStorage.getItem(SESSION_NETWORK_KEY)
        return typeof raw === 'string' && raw ? raw : null
    } catch { return null }
}

function writeSessionInventory(list) {
    try {
        if (!Array.isArray(list)) return
        sessionStorage.setItem(SESSION_INVENTORY_KEY, JSON.stringify(list))
    } catch { /* quota / private mode — silent */ }
}

function writeSessionNetworkId(id) {
    try {
        if (typeof id === 'string' && id) {
            sessionStorage.setItem(SESSION_NETWORK_KEY, id)
        } else {
            // Explicitly clear when the caller passes null (e.g. when
            // a Wi-Fi switch invalidated the cached identity). Without
            // this, the stale MAC stays in sessionStorage and a
            // remount would re-hydrate the wrong network's identity.
            sessionStorage.removeItem(SESSION_NETWORK_KEY)
        }
    } catch { /* silent */ }
}

/**
 * Derive a stable network identity from a finished scan.
 *
 * Preferred: the gateway's MAC address (globally unique per router).
 * Fallback: the subnet (`ip:192.168.1`) when no gateway MAC was learned
 * — typically happens on first scans before ARP populates.
 *
 * This is how we scope the inventory per-network, Fing-style: switching
 * to a friend's Wi-Fi (also 192.168.1.x) gets its own clean inventory,
 * and coming back to your own network restores the original device list
 * because the gateway MAC matches.
 */
function deriveNetworkId(devices, baseIP) {
    if (Array.isArray(devices)) {
        const gateway = devices.find(d => d && d.isGateway && d.mac)
        if (gateway?.mac) {
            const clean = gateway.mac.toLowerCase().replace(/[^0-9a-f]/g, '')
            if (clean.length === 12 && clean !== '000000000000' && clean !== 'ffffffffffff') {
                return `mac:${clean}`
            }
        }
    }
    return baseIP ? `ip:${baseIP}` : null
}

function sourceLabel(source) {
    if (!source) return null
    return SRC_COLORS[source]?.label || String(source).toUpperCase()
}

function presenceLabel(device) {
    if (!device) return 'Unknown'
    if (device.presence === 'new') return 'New'
    if (device.presence === 'online') return 'Online'
    if (device.presence === 'cached') return 'Cached'
    if (device.presence === 'offline') return 'Offline'
    return device.alive ? 'Online' : 'Unknown'
}

function discoveryEvidenceLabel(device) {
    if (!device) return '-'
    const parts = []
    const active = sourceLabel(device.activeSource)
    if (active) parts.push(`${active} responder`)
    if (device.neighborState) {
        const state = String(device.neighborState).replace(/[_-]+/g, ' ')
        const source = device.neighborSource ? ` (${device.neighborSource})` : ''
        parts.push(`Neighbor ${state}${source}`)
    }
    if (Array.isArray(device.discoverySources)) {
        for (const source of device.discoverySources) {
            const label = sourceLabel(source)
            if (label && !parts.some(p => p.toLowerCase().includes(label.toLowerCase()))) {
                parts.push(label)
            }
        }
    }
    if (!parts.length && device.alive) parts.push(device.time != null ? 'ICMP reply' : 'Active reply')
    if (!parts.length && device.seenOnly) parts.push('Neighbor cache')
    if (!parts.length && device.presence === 'offline') parts.push('Inventory only')
    return parts.join(' - ') || '-'
}

function serviceSummary(device) {
    const services = Array.isArray(device?.serviceTypes) ? device.serviceTypes : []
    if (!services.length) return null
    const cleaned = services
        .map(service => String(service || '')
            .replace(/^urn:schemas-upnp-org:(device|service):/i, '')
            .replace(/^urn:[^:]+:/i, '')
            .replace(/:\d+$/i, '')
            .replace(/[_-]+/g, ' ')
            .trim())
        .filter(Boolean)
    if (!cleaned.length) return null
    const unique = [...new Set(cleaned)]
    const visible = unique.slice(0, 3).join(', ')
    return unique.length > 3 ? `${visible} +${unique.length - 3}` : visible
}

/**
 * Async wrapper around `deriveNetworkId` that consults the OS ARP
 * cache when the scan results don't contain the gateway (typical for
 * partial range scans like `1-50`).
 *
 * Without this, two different home networks that both happen to be
 * `192.168.1.x` would share the same fallback `ip:192.168.1` identity
 * and end up merging their inventories. By looking up the gateway's
 * MAC in ARP independently of the scan range, we keep the per-network
 * scoping correct even for partial sweeps.
 *
 * Falls back to `deriveNetworkId` (pure) when:
 *   - the scan already contains a usable gateway entry,
 *   - the ARP lookup IPC isn't available (browser mock),
 *   - the gateway IP isn't known yet, or
 *   - ARP doesn't have an entry for the gateway IP.
 */
async function resolveNetworkId(devices, baseIP, gatewayIp) {
    const fromScan = deriveNetworkId(devices, baseIP)
    // If deriveNetworkId returned a MAC-based id, the scan already
    // captured the gateway — no need to consult ARP.
    if (fromScan && fromScan.startsWith('mac:')) return fromScan

    if (!gatewayIp || typeof bridge.getArpTable !== 'function') return fromScan

    try {
        const arp = await bridge.getArpTable()
        if (!Array.isArray(arp)) return fromScan
        const entry = arp.find(e =>
            e && (e.ip === gatewayIp || e.address === gatewayIp)
        )
        const rawMac = entry?.mac || entry?.macAddress || entry?.physicalAddress
        if (!rawMac) return fromScan
        const clean = String(rawMac).toLowerCase().replace(/[^0-9a-f]/g, '')
        if (clean.length === 12 && clean !== '000000000000' && clean !== 'ffffffffffff') {
            return `mac:${clean}`
        }
    } catch { /* fall through to scan-derived id */ }

    return fromScan
}

/**
 * Fire an OS notification summarising new devices found in this scan.
 *
 * - Honours the `notifyNewDevices` config toggle (default enabled).
 * - Only uses the browser Notification API if permission is granted; if
 *   permission is "default" it requests it once, silently skipping the
 *   current round if the user denies.
 * - Aggregates multiple new devices into a single notification so we never
 *   spam users with 10+ toasts on a first extensive scan.
 */
async function notifyNewDevicesIfAllowed(newKeys, foundDevices) {
    if (typeof Notification === 'undefined') return

    let enabled = true
    try {
        const pref = await bridge.configGet?.('notifyNewDevices')
        if (pref === false || pref === 'false') enabled = false
    } catch { /* keep default */ }
    if (!enabled) return

    const grantPermission = () => {
        if (Notification.permission === 'granted') return Promise.resolve('granted')
        if (Notification.permission === 'denied') return Promise.resolve('denied')
        return Notification.requestPermission().catch(() => 'denied')
    }

    const permission = await grantPermission()
    if (permission !== 'granted') return

    // Build a human summary of the first few new devices.
    // DB returns newKeys in the scoped form `${networkId}::${baseKey}`
    // (e.g. `mac:<gw>::mac:<dev>` or `mac:<gw>::ip:192.168.1.42`). We
    // unscope first so the comparison lands on the base key that
    // stableKey() produces from the live scan result.
    const newDevices = newKeys
        .map(key => {
            const base = unscopeKey(key) || ''
            if (base.startsWith('mac:')) {
                const cleanMac = base.slice(4) // 12 hex, lowercase per inventoryKey()
                return foundDevices.find(d => {
                    const m = d?.mac ? d.mac.toLowerCase().replace(/[^0-9a-f]/g, '') : null
                    return m && m === cleanMac
                }) || null
            }
            if (base.startsWith('ip:')) {
                const ip = base.slice(3)
                return foundDevices.find(d => d?.ip === ip) || null
            }
            return null
        })
        .filter(Boolean)

    const firstThree = newDevices.slice(0, 3).map(d => {
        const label = d.hostname || d.displayName || d.vendor || d.ip
        return d.ip ? `${label} (${d.ip})` : label
    }).join(', ')

    const extra = newDevices.length > 3 ? ` and ${newDevices.length - 3} more` : ''
    const count = newDevices.length

    try {
        new Notification(
            count === 1 ? 'New device on your network' : `${count} new devices on your network`,
            {
                body: firstThree + extra,
                silent: false,
            },
        )
    } catch { /* Notification construction can throw in edge cases */ }
}

export default function Scanner() {
    const net = useNetworkStatus()
    const [scanning, setScanning] = useState(false)
    const [devices, setDevices] = useState([])
    const [progress, setProgress] = useState(0)
    const [baseIP, setBaseIP] = useState(() => extractSubnet(net.gateway) || extractSubnet(net.localIP) || '192.168.1')
    const [rangeStart, setRangeStart] = useState(1)
    const [rangeEnd, setRangeEnd] = useState(254)
    const [selected, setSelected] = useState(null)
    const [detailLoading, setDetailLoading] = useState(false)
    const [detailData, setDetailData] = useState(null)
    const [inputError, setInputError] = useState(null)
    const [safeMode, setSafeMode] = useState(false)
    // Hydrate inventory + networkId synchronously from sessionStorage
    // on first render so re-entering the Scanner route doesn't flash an
    // empty list while the bridge.deviceInventoryList IPC round-trips
    // (typically 50-200ms including the ARP gateway-MAC lookup).
    // The cached snapshot is overwritten with fresh DB data the moment
    // the resolveKey effect resolves, so this is purely a perceptual
    // smoothing layer — never authoritative.
    const [inventory, setInventory] = useState(() => readSessionInventory())
    const [networkId, setNetworkId] = useState(() => readSessionNetworkId())
    const [newDeviceKeys, setNewDeviceKeys] = useState(new Set())
    const [showOffline, setShowOffline] = useState(true)
    const [newOnly, setNewOnly] = useState(false)
    // Column sort state. `key === null` means "default order" (IP asc
    // with gateway/local pinned to top — historical behaviour). When
    // the user clicks a header we cycle: null → asc → desc → null.
    // Direction is respected per-column; switching columns resets to
    // asc. The pinning of gateway/local only applies in the default
    // (null) state — once the user explicitly chooses a sort, every
    // device participates so the chosen ordering is honoured strictly.
    const [sort, setSort] = useState({ key: null, dir: 'asc' })
    const detailScrollRef = useRef(null)
    const prevDetailLoadingRef = useRef(false)
    const scanRunRef = useRef(0)
    const detailRunRef = useRef(0)
    // Tracks the LAST auto-detected subnet so we can distinguish
    // "user typed a custom subnet" from "the network changed under us".
    // - If `baseIP === lastAutoBaseRef.current`, the user has not edited
    //   it, so on Wi-Fi switch we transparently update to the new subnet.
    // - If they differ, the user has manually overridden the auto-pick
    //   (e.g. to scan a peer subnet via VPN), and we leave their value
    //   alone until they reset it themselves. This is what makes
    //   network switching feel coherent for the inventory bug fix:
    //   without it, jumping from 192.168.1.x to 192.168.0.x kept the
    //   scanner pinned to the old subnet and the new network's
    //   inventory could never load.
    const lastAutoBaseRef = useRef(null)
    // Tracks the last gateway IP we observed. Used by the
    // "network-changed" effect below to clear stale per-network state
    // (last scan results, NEW badges, the open detail drawer) without
    // touching values we want to preserve across the switch (config,
    // toggles, etc.).
    const prevGatewayRef = useRef(undefined)
    const showOfflineInitRef = useRef(false)
    const safeModeInitRef = useRef(false)
    // Tracks whether the user has interacted with the Safe Scan or
    // Show-Offline toggles since mount. If a click lands during the
    // ~50ms window where the persisted-config promise is still pending,
    // the late `setSafeMode(savedValue)` call would clobber the user's
    // freshly-toggled state. The dirty refs cancel the loader's effect
    // when the user has already taken control.
    const safeModeUserDirtyRef = useRef(false)
    const showOfflineUserDirtyRef = useRef(false)

    // Persist inventory + networkId snapshots into sessionStorage so a
    // remount of the Scanner route (user navigated away and came back)
    // can hydrate them synchronously and skip the empty-state flash.
    useEffect(() => { writeSessionInventory(inventory) }, [inventory])
    useEffect(() => { writeSessionNetworkId(networkId) }, [networkId])

    // Load Safe Scan preference from persistent config on mount.
    // Explicitly honour the saved boolean (including `false`) rather than
    // implicitly keeping the component default — otherwise turning it OFF
    // and restarting would silently revert to the default.
    useEffect(() => {
        if (safeModeInitRef.current) return
        safeModeInitRef.current = true
        bridge.configGet?.('safeScanDefault').then(v => {
            if (safeModeUserDirtyRef.current) return // user already chose; ignore loader
            if (v === true || v === 'true') setSafeMode(true)
            else if (v === false || v === 'false') setSafeMode(false)
            // null / undefined → keep default (false), never visited this setting
        }).catch(() => { /* noop */ })
    }, [])

    // Load the Show/Hide offline preference on mount. Mirrors the Safe
    // Scan pattern: persist the explicit boolean, restore it on next
    // launch, default to `true` (show offline) the very first time.
    useEffect(() => {
        if (showOfflineInitRef.current) return
        showOfflineInitRef.current = true
        bridge.configGet?.('scanner.showOffline').then(v => {
            if (showOfflineUserDirtyRef.current) return
            if (v === true || v === 'true') setShowOffline(true)
            else if (v === false || v === 'false') setShowOffline(false)
            // null / undefined → keep default (true)
        }).catch(() => { /* noop */ })
    }, [])

    function toggleShowOffline() {
        showOfflineUserDirtyRef.current = true
        setShowOffline(prev => {
            const next = !prev
            bridge.configSet?.('scanner.showOffline', next).catch(() => { /* noop */ })
            return next
        })
    }

    function toggleSafeMode() {
        safeModeUserDirtyRef.current = true
        setSafeMode(prev => {
            const next = !prev
            bridge.configSet?.('safeScanDefault', next).catch(() => { /* noop */ })
            return next
        })
    }

    // Callback fired by DeviceMetaEditor after it persists nickname / type override.
    // Merge the updated record into the in-memory inventory so the list re-renders
    // without a full reload.
    function handleInventoryPatch(updated) {
        if (!updated?.deviceKey) return
        setInventory(prev => {
            const idx = prev.findIndex(item => item.deviceKey === updated.deviceKey)
            if (idx < 0) return [updated, ...prev]
            const next = [...prev]
            next[idx] = { ...next[idx], ...updated }
            return next
        })
        // Also patch the currently-selected device so the editor reflects
        // the save immediately (and deviceType picks up the override).
        setSelected(prev => (prev && prev.deviceKey === updated.deviceKey
            ? { ...prev, nickname: updated.nickname, typeOverride: updated.typeOverride, notes: updated.notes }
            : prev))
    }

    // When the active gateway changes (Wi-Fi switch, VPN connect,
    // ethernet plug/unplug), wipe the in-memory scan artefacts that
    // belong to the OLD network: last-scan device list, NEW badges,
    // and the open detail drawer. We deliberately DON'T touch the
    // persisted inventory or networkId here — the resolveKey effect
    // below will swap those out atomically once it learns the new
    // network's identity from ARP. This prevents the bug the user
    // reported where after scanning Network 2 and switching back to
    // Network 1, the device list still showed Network 2's results
    // mixed in (because `devices` and `newDeviceKeys` were still
    // populated from the previous scan).
    useEffect(() => {
        const currentGw = (net?.gateway || '').trim() || null
        if (prevGatewayRef.current === undefined) {
            // First mount — seed the ref, don't wipe anything (the
            // sessionStorage hydration is what we want to keep showing).
            prevGatewayRef.current = currentGw
            return
        }
        if (prevGatewayRef.current === currentGw) return
        prevGatewayRef.current = currentGw
        // If a scan is in flight when the user switches Wi-Fi networks,
        // abort it. The scan was sweeping the OLD network's subnet and
        // any results that come back (devices, ARP enrichment, mDNS/
        // SSDP discovery) belong to a network we're no longer on —
        // surfacing them on the new network's inventory would be
        // misleading at best. Bumping `scanRunRef.current` is the same
        // mechanism stopScan() uses: every async stage of the scan
        // pipeline checks `scanRunRef.current !== scanId` and bails
        // when it doesn't match, so the in-flight IPC promises resolve
        // into a no-op instead of mutating state.
        scanRunRef.current += 1
        setScanning(false)
        setProgress(0)
        setDevices([])
        setNewDeviceKeys(new Set())
        setSelected(null)
        setDetailData(null)
        setDetailLoading(false)
        // Clear the displayed inventory too — the resolveKey effect
        // below will repopulate it with the new network's saved
        // devices (or leave it empty for an unscanned network) within
        // ~50ms. Without this clear, the user briefly sees the OLD
        // network's inventory after switching, which was a key part
        // of the reported bug ("se queda el inventario de la 2da red").
        setInventory([])
        // Force the inventory effect to re-resolve from ARP rather than
        // trust the cached networkId (which still points at the old
        // network). Setting it to null here makes the resolve effect's
        // ARP-first path the authoritative one for the next round.
        setNetworkId(null)
    }, [net?.gateway])

    // Auto-update baseIP whenever the active network changes. We track
    // the last subnet WE auto-chose; if the current baseIP still matches,
    // the user hasn't overridden it and it's safe to follow the new
    // network. If they differ, the user has manually customized the
    // subnet and we honour that until they edit it back. Without this
    // update path, switching Wi-Fi networks with different subnets left
    // baseIP pinned to the old network's prefix, which broke the
    // per-network inventory lookup downstream.
    useEffect(() => {
        const subnet = extractSubnet(net.gateway) || extractSubnet(net.localIP)
        if (!subnet) return
        if (lastAutoBaseRef.current === null) {
            // First detection — seed the auto-base ref. The useState
            // initializer for baseIP already ran with the same subnet,
            // so no setBaseIP needed unless they happen to differ
            // (rare race where useNetworkStatus loaded after initial
            // render).
            lastAutoBaseRef.current = subnet
            if (subnet !== baseIP) setBaseIP(subnet)
            return
        }
        if (subnet === lastAutoBaseRef.current) return // same network
        // Subnet changed AND baseIP hasn't been manually edited away
        // from the last auto-base → follow the new network.
        if (baseIP === lastAutoBaseRef.current) {
            lastAutoBaseRef.current = subnet
            setBaseIP(subnet)
        } else {
            // User has manually customised baseIP; respect their value
            // but advance the auto-ref so we know what "last detected"
            // looks like for the next change.
            lastAutoBaseRef.current = subnet
        }
    }, [net.gateway, net.localIP, baseIP])

    // Keep the persistent inventory in sync with the currently-selected
    // network. Before the first scan we don't know the gateway's MAC yet,
    // so we use the subnet-based network_id (`ip:<baseIP>`) as a preview.
    // Once the scan completes, deriveNetworkId() gives us the real
    // gateway-MAC identity and this effect re-runs with the new key.
    useEffect(() => {
        if (!baseIP && !networkId) return
        let cancelled = false

        // Resolve which network identity to load.
        //
        // Priority (most authoritative first):
        //   1. ARP lookup of the live default-gateway IP — the OS knows
        //      which router we're connected to RIGHT NOW. This MUST run
        //      first, because the cached `networkId` state can be stale
        //      across Wi-Fi switches: scenario was Network 1 (mac:aaa)
        //      → switch to Network 2 (mac:bbb) → scan → switch back to
        //      Network 1 → resolveKey would return mac:bbb (cached) and
        //      load Network 2's inventory under the assumption the
        //      cache was authoritative. The ARP table is the only
        //      source that updates the moment the OS reassociates with
        //      a new SSID, so it gates everything else.
        //   2. `networkId` state — fallback when ARP returns nothing
        //      (cache cold, no IP yet, etc.). The cached value is at
        //      worst the previous network's identity, which is never
        //      WORSE than the IP-based fallback below — it's just not
        //      verified to be the current network.
        //   3. Persisted `scanner.networkIdByBase.<baseIP>` — long-term
        //      hint persisted across sessions; same caveat as (2).
        //   4. IP-based fallback `ip:<baseIP>` — never collides
        //      identity-wise but mixes networks with same subnet, so
        //      we only land here when (1)-(3) all fail.
        const resolveKey = async () => {
            const gatewayIp = (net?.gateway || '').trim()
            if (gatewayIp && bridge.getArpTable) {
                try {
                    const arp = await bridge.getArpTable()
                    const entry = Array.isArray(arp)
                        ? arp.find(row => row && row.ip === gatewayIp && row.mac)
                        : null
                    if (entry?.mac) {
                        const cleaned = String(entry.mac).toLowerCase().replace(/[^0-9a-f]/g, '')
                        if (cleaned.length === 12 && cleaned !== '000000000000' && cleaned !== 'ffffffffffff') {
                            return `mac:${cleaned}`
                        }
                    }
                } catch { /* fallthrough */ }
            }

            // ARP didn't resolve — try cached identity from this session
            if (networkId) return networkId

            if (baseIP) {
                try {
                    const remembered = await bridge.configGet?.(`scanner.networkIdByBase.${baseIP}`)
                    if (typeof remembered === 'string' && remembered) return remembered
                } catch { /* fallthrough */ }
                return `ip:${baseIP}`
            }
            return null
        }

        resolveKey().then(currentKey => {
            if (!currentKey || cancelled) return
            // Always promote the resolved key into state when it
            // differs — this is what makes network switching reactive.
            // Previously we only set it when networkId was null, which
            // meant a stale value would survive forever once seeded.
            if (currentKey !== networkId && currentKey !== `ip:${baseIP}`) {
                setNetworkId(currentKey)
            }
            return bridge.deviceInventoryList?.(currentKey).then(list => {
                if (cancelled) return
                setInventory(Array.isArray(list) ? list : [])
            })
        }).catch(error => {
            logBridgeWarning('scanner:inventory-load', error)
        })
        return () => { cancelled = true }
        // `net.gateway` is included so changing networks (Wi-Fi switch,
        // VPN connect/disconnect) re-resolves the inventory immediately.
    }, [baseIP, networkId, net?.gateway])

    // Auto-scroll inside device diagnostics when checks are done.
    useEffect(() => {
        const justFinished = prevDetailLoadingRef.current && !detailLoading
        prevDetailLoadingRef.current = detailLoading
        if (!justFinished || !detailData || !detailScrollRef.current) return
        requestAnimationFrame(() => {
            detailScrollRef.current?.scrollTo({
                top: detailScrollRef.current.scrollHeight,
                behavior: 'smooth',
            })
        })
    }, [detailLoading, detailData, selected?.ip])
    function validateInputs() {
        const validated = validateLanScanInputs(baseIP, rangeStart, rangeEnd)
        if (!validated.ok) {
            setInputError(validated.error)
            return null
        }
        setInputError(null)
        return validated
    }

    function enrichForView(device) {
        const cls = classifyDevice(device)
        return {
            ...device,
            deviceType: cls.type,
            devColor: cls.color,
            DevIcon: cls.Icon,
        }
    }

    async function enrichUnknownDevices(seedDevices, scanId, scanNetworkId, subnetForMerge) {
        const candidates = (seedDevices || [])
            .filter(d => d && d.ip && !d.isLocal && (!d.hostname || (!d.vendor && !d.isGateway)))
            .map(d => ({
                ip: d.ip,
                hostname: d.hostname || null,
                nameSource: d.nameSource || 'unknown',
                vendor: d.vendor || null,
                vendorSource: d.vendorSource || 'unknown',
                mac: d.mac || null,
                isLocal: !!d.isLocal,
                isGateway: !!d.isGateway,
                isRandomized: !!d.isRandomized,
                macEmpty: !!d.macEmpty,
            }))

        if (!candidates.length) return

        try {
            const updates = await bridge.lanScanEnrich({ devices: candidates })
            // Guard BEFORE every state mutation: a second scan could have
            // started while we were awaiting the IPC round-trip, and we must
            // never apply stale enrichment to the newer scan's data.
            if (scanRunRef.current !== scanId || !Array.isArray(updates) || updates.length === 0) return

            const byIp = new Map(updates.map(row => [row.ip, row]))

            if (scanRunRef.current !== scanId) return
            setDevices(prev => prev.map(device => {
                const update = byIp.get(device.ip)
                if (!update) return device
                return enrichForView({
                    ...device,
                    ...update,
                    hostname: update.hostname || device.hostname || null,
                    nameSource: update.nameSource || device.nameSource || 'unknown',
                    vendor: update.vendor || device.vendor || null,
                    vendorSource: update.vendorSource || device.vendorSource || 'unknown',
                })
            }))

            if (scanRunRef.current !== scanId) return
            setSelected(prev => {
                if (!prev) return prev
                const update = byIp.get(prev.ip)
                if (!update) return prev
                return enrichForView({
                    ...prev,
                    ...update,
                    hostname: update.hostname || prev.hostname || null,
                    nameSource: update.nameSource || prev.nameSource || 'unknown',
                    vendor: update.vendor || prev.vendor || null,
                    vendorSource: update.vendorSource || prev.vendorSource || 'unknown',
                })
            })

            // Re-merge the freshly-enriched rows into the persistent inventory
            // so the next mount shows the latest resolved hostname/vendor
            // instead of the initial (pre-enrichment) snapshot.
            if (scanNetworkId && subnetForMerge && scanRunRef.current === scanId) {
                const enrichedSlim = seedDevices
                    .map(d => {
                        const update = byIp.get(d.ip)
                        return {
                            ip: d.ip,
                            mac: d.mac || null,
                            hostname: (update?.hostname || d.hostname) || null,
                            vendor: (update?.vendor || d.vendor) || null,
                            deviceType: d.deviceType || null,
                        }
                    })
                try {
                    await bridge.deviceInventoryMerge(scanNetworkId, subnetForMerge, enrichedSlim)
                    if (scanRunRef.current !== scanId) return
                    const refreshed = await bridge.deviceInventoryList(scanNetworkId)
                    if (scanRunRef.current === scanId && Array.isArray(refreshed)) setInventory(refreshed)
                } catch (error) {
                    logBridgeWarning('scanner:enrich-merge', error)
                }
            }
        } catch (error) {
            // Background enrichment is best-effort and should never block scanner UX.
            logBridgeWarning('scanner:enrich', error)
        }
    }

    async function startScan() {
        const validated = validateInputs()
        if (!validated) return
        const scanId = scanRunRef.current + 1
        scanRunRef.current = scanId
        const safeBaseIP = validated.baseIP
        const safeRangeStart = validated.start
        const safeRangeEnd = validated.end
        setBaseIP(safeBaseIP)
        // Clear newDeviceKeys at the start of every scan so devices
        // discovered live during this run aren't re-tagged with stale
        // 'new' badges from the previous scan's merge result. The fresh
        // newKeys set arrives only after deviceInventoryMerge returns
        // at the end of the scan — until then, every device should
        // carry its plain 'online' presence, not 'new'.
        setScanning(true); setDevices([]); setProgress(0); setSelected(null); setDetailData(null); setNewOnly(false); setNewDeviceKeys(new Set())

        // We still want to know whether this is the user's first-ever scan
        // of this subnet — if so, we skip "new device" notifications to avoid
        // flooding them with dozens of alerts on the initial sweep.
        let hasBaseline = false
        try {
            const prev = await bridge.deviceSnapshotLatest(safeBaseIP)
            hasBaseline = !!(prev && Array.isArray(prev.devices) && prev.devices.length)
        } catch { /* no history yet */ }

        const total = safeRangeEnd - safeRangeStart + 1
        const foundRaw = []
        for (let s = safeRangeStart; s <= safeRangeEnd; s += SCAN_BATCH_SIZE) {
            const e = Math.min(s + SCAN_BATCH_SIZE - 1, safeRangeEnd)
            const results = await bridge.lanScan(safeBaseIP, s, e, { safeMode })
            if (scanRunRef.current !== scanId) return
            if (results) {
                const enriched = results.map(r => enrichForView(r))
                foundRaw.push(...enriched); setDevices([...foundRaw])
            }
            setProgress(Math.round(((e - safeRangeStart + 1) / total) * 100))
        }
        if (scanRunRef.current !== scanId) return

        // Ghost filtering happens server-side with a deterministic rule
        // (alive && !mac → ghost). No post-processing needed here.
        const found = foundRaw

        setScanning(false)
        bridge.historyAdd({ module: 'LAN Scanner', type: 'Scan', detail: `${safeBaseIP}.0/24`, results: { found: found.length } })

        // Derive a stable network identity. Prefer the scanned gateway
        // when available; for partial scans that don't include the
        // gateway IP, fall back to looking it up in the OS ARP cache —
        // this prevents two different `192.168.1.x` networks from
        // sharing the same `ip:192.168.1` fallback identity.
        const scanNetworkId = await resolveNetworkId(found, safeBaseIP, net.gateway)
        setNetworkId(scanNetworkId)
        // Remember this mapping so next mount loads the right inventory
        // immediately instead of falling back to `ip:<subnet>` (which can
        // resurface legacy pre-migration phantoms).
        if (scanNetworkId && scanNetworkId.startsWith('mac:')) {
            bridge.configSet?.(`scanner.networkIdByBase.${safeBaseIP}`, scanNetworkId)
                .catch(() => { /* best-effort */ })
        }

        void enrichUnknownDevices(found, scanId, scanNetworkId, safeBaseIP)

        // Persist this scan as a snapshot (used to establish a baseline so we
        // skip first-scan notification floods — no longer diff'd for UI).
        // Then merge into the persistent inventory: the inventory is the
        // single source of truth for "this device is new / offline / known".
        try {
            const slim = found.map(d => ({
                ip: d.ip,
                mac: d.mac || null,
                hostname: d.hostname || null,
                vendor: d.vendor || null,
                deviceType: d.deviceType || null,
            }))

            // The persistence phase runs multiple awaits in sequence. If a
            // newer scan starts or Stop fires between any of them, the
            // rest of this function must NOT mutate React state — that
            // would overwrite the newer run's results with stale data.
            // Guard after every await.

            await bridge.deviceSnapshotAdd(safeBaseIP, slim)
            if (scanRunRef.current !== scanId) return

            const mergeResult = await bridge.deviceInventoryMerge(scanNetworkId, safeBaseIP, slim)
            if (scanRunRef.current !== scanId) return

            const newKeys = Array.isArray(mergeResult?.newKeys) ? mergeResult.newKeys : []
            setNewDeviceKeys(new Set(newKeys))

            // Compute the gateway's scoped device_key from the live scan
            // so the purge can exempt it even when its MAC is also used by
            // proxy-ARP ghosts (classic Tenda/TP-Link signature).
            const gatewayDevice = found.find(d => d && d.isGateway && d.mac)
            const gatewayBaseKey = gatewayDevice ? stableKey(gatewayDevice) : null
            const gatewayDeviceKey = (scanNetworkId && gatewayBaseKey)
                ? `${scanNetworkId}::${gatewayBaseKey}`
                : null

            // Purge ghost entries persisted by earlier (buggy) scans.
            // - Rows with no MAC that weren't seen in the current full scan
            // - Rows sharing one MAC with 4+ other rows (proxy-ARP signature)
            // User-curated entries (nickname/notes/typeOverride) are kept.
            // The gateway's scoped key is exempted explicitly so a
            // proxy-ARPing router doesn't disappear with its ghosts.
            // Only runs when the scan covered the full /24 — otherwise we
            // can't reliably say "not seen = ghost".
            const scanCoveredFullRange = safeRangeStart <= 1 && safeRangeEnd >= 254
            if (scanNetworkId) {
                try {
                    const seenKeys = [
                        ...(Array.isArray(mergeResult?.newKeys) ? mergeResult.newKeys : []),
                        ...(Array.isArray(mergeResult?.updatedKeys) ? mergeResult.updatedKeys : []),
                    ]
                    await bridge.deviceInventoryPurgeGhosts?.(
                        scanNetworkId, seenKeys, scanCoveredFullRange, gatewayDeviceKey,
                    )
                    if (scanRunRef.current !== scanId) return
                } catch (error) {
                    logBridgeWarning('scanner:purge-ghosts', error)
                }
            }

            const refreshed = await bridge.deviceInventoryList(scanNetworkId)
            if (scanRunRef.current !== scanId) return
            if (Array.isArray(refreshed)) setInventory(refreshed)

            // Only notify on truly new devices when a baseline exists. Skips
            // the first-ever scan (otherwise we'd alert on every device).
            if (newKeys.length > 0 && hasBaseline) {
                notifyNewDevicesIfAllowed(newKeys, found)
            }
        } catch { /* tracking is best-effort */ }
    }

    function stopScan() {
        scanRunRef.current += 1
        setScanning(false)
    }
    async function openDetail(device) {
        // Each invocation bumps the run counter — pending diagnostics from
        // previously-selected devices notice this mismatch and bail out
        // before overwriting the fresh state.
        const runId = ++detailRunRef.current
        setSelected(device); setDetailLoading(true); setDetailData(null)
        detailScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })

        const isSeen = device.seenOnly && !device.isLocal
        const extra = { warnings: [], timedOut: false }

        // Helper: race a promise against a timeout
        const withTimeout = (promise, ms, fallback) =>
            Promise.race([promise, new Promise(r => setTimeout(() => r(fallback), ms))])

        try {
            // Ping — use fewer packets for seen-only devices
            const pingCount = isSeen ? DIAG_PING_COUNT_SEEN : DIAG_PING_COUNT_LIVE
            const pingTimeout = isSeen ? DIAG_PING_TIMEOUT_SEEN : DIAG_PING_TIMEOUT_LIVE
            try {
                const pingResult = await withTimeout(
                    bridge.pingHost(device.ip, pingCount),
                    pingTimeout,
                    { timeout: true }
                )
                if (pingResult?.timeout) {
                    extra.ping = null
                    extra.warnings.push({ type: 'ping', msg: `Ping timed out after ${(pingTimeout/1000).toFixed(0)}s — device may be offline or blocking ICMP` })
                } else if (!pingResult?.success && (!pingResult?.times || pingResult.times.length === 0)) {
                    extra.ping = pingResult
                    extra.warnings.push({ type: 'ping', msg: `No ping reply — device is unreachable or has ICMP disabled (${pingResult?.loss ?? 100}% loss)` })
                } else {
                    extra.ping = pingResult
                }
            } catch {
                extra.ping = null
                extra.warnings.push({ type: 'ping', msg: 'Ping failed — could not execute command' })
            }

            // Port scan
            const portTimeout = isSeen ? DIAG_PORTSCAN_TIMEOUT_SEEN : DIAG_PORTSCAN_TIMEOUT_LIVE
            const perPortTimeout = isSeen ? DIAG_PORT_TIMEOUT_SEEN : DIAG_PORT_TIMEOUT_LIVE
            try {
                const r = await withTimeout(
                    Promise.all(DIAG_PORTS.map(p => bridge.checkPort(device.ip, p, perPortTimeout))),
                    portTimeout,
                    null
                )
                if (r === null) {
                    extra.openPorts = []
                    extra.warnings.push({ type: 'ports', msg: `Port scan timed out after ${(portTimeout/1000).toFixed(0)}s — device may be behind a firewall` })
                } else {
                    extra.openPorts = r.filter(p => p.open).map(p => p.port)
                }
            } catch {
                extra.openPorts = []
                extra.warnings.push({ type: 'ports', msg: 'Port scan failed — could not connect' })
            }

            // If seen-only and nothing worked, add general explanation
            if (isSeen && extra.warnings.length > 0 && !extra.ping?.success && extra.openPorts?.length === 0) {
                extra.warnings.push({ type: 'info', msg: 'This device was detected via ARP table but did not respond to any probes. It may be powered off, in sleep mode, or behind a strict firewall.' })
            }
        } catch {
            extra.warnings.push({ type: 'error', msg: 'Diagnostics encountered an unexpected error' })
        }

        // Guard against late-arriving results when the user clicked a
        // different device mid-diagnostics: don't stomp fresh state.
        if (detailRunRef.current !== runId) return
        setDetailData(extra); setDetailLoading(false)
    }

    /* Merge live scan with persistent inventory so offline-but-known devices
       appear alongside online ones. Then apply UI enrichment (icon + colour)
       so every card can render with a consistent visual. */
    const mergedDevices = useMemo(() => {
        const scanOnlySubnet = inventory.filter(i => !baseIP || i.baseIP === baseIP)
        const base = mergeScanWithInventory(devices, scanOnlySubnet, newDeviceKeys)
        return base.map(d => enrichForView(d))
    }, [devices, inventory, newDeviceKeys, baseIP])

    const visibleDevices = useMemo(() => {
        let pool = mergedDevices
        if (!showOffline) pool = pool.filter(d => !isHideableWhenOffline(d))
        if (newOnly) pool = pool.filter(d => d.isNew || d.presence === 'new')
        return pool
    }, [mergedDevices, showOffline, newOnly])

    // Sort the device list. In the default state (sort.key === null)
    // we keep the historical layout: gateway first, "you" second, then
    // ascending by IP last-octet. When the user clicks a column header
    // we honour their explicit sort: gateway/local lose their special
    // pinning so the chosen ordering is unambiguous.
    const listedDevices = useMemo(() => {
        const sorted = [...visibleDevices]
        if (sort.key === null) {
            sorted.sort((a, b) => {
                if (a.isGateway && !b.isGateway) return -1
                if (!a.isGateway && b.isGateway) return 1
                if (a.isLocal && !b.isLocal) return -1
                if (!a.isLocal && b.isLocal) return 1
                const av = parseInt(String(a.ip || '').split('.').pop(), 10)
                const bv = parseInt(String(b.ip || '').split('.').pop(), 10)
                return (isNaN(av) ? 999 : av) - (isNaN(bv) ? 999 : bv)
            })
            return sorted
        }
        const direction = sort.dir === 'desc' ? -1 : 1
        const compare = (() => {
            switch (sort.key) {
                case 'name': return (a, b) => {
                    const an = String(primaryLabel(a) || '').toLowerCase()
                    const bn = String(primaryLabel(b) || '').toLowerCase()
                    return an.localeCompare(bn)
                }
                case 'type': return (a, b) => {
                    const at = String(a.deviceType || 'Unknown').toLowerCase()
                    const bt = String(b.deviceType || 'Unknown').toLowerCase()
                    return at.localeCompare(bt)
                }
                case 'latency': return (a, b) => {
                    // Devices with no latency reading (offline / cached /
                    // ARP-only) always go to the END regardless of
                    // direction — sorting by latency is about ranking
                    // *responsive* devices, putting unknowns at the
                    // bottom is more useful than flipping them to the
                    // top in desc mode.
                    const aHas = typeof a.time === 'number'
                    const bHas = typeof b.time === 'number'
                    if (aHas && !bHas) return -1
                    if (!aHas && bHas) return 1
                    if (!aHas && !bHas) return 0
                    return a.time - b.time
                }
                default: return () => 0
            }
        })()
        sorted.sort((a, b) => compare(a, b) * direction)
        return sorted
    }, [visibleDevices, sort])

    function cycleSort(columnKey) {
        setSort(prev => {
            if (prev.key !== columnKey) return { key: columnKey, dir: 'asc' }
            if (prev.dir === 'asc') return { key: columnKey, dir: 'desc' }
            // Already desc on this column → return to default order.
            return { key: null, dir: 'asc' }
        })
    }

    /* Vendor / type counts for summary pills — based on the currently visible list. */
    const vcounts = {}
    visibleDevices.forEach(d => {
        const key = d.isLocal ? 'This Device'
            : d.isGateway ? 'Gateway'
            : d.vendor || (d.isRandomized ? 'Randomized MAC' : (d.mac && !d.macEmpty ? 'Network Device' : 'Unknown'))
        vcounts[key] = (vcounts[key] || 0) + 1
    })
    const onlineCount = mergedDevices.filter(d => d.presence === 'online' || d.presence === 'new').length
    const cachedCount = mergedDevices.filter(d => d.presence === 'cached').length
    const offlineCount = mergedDevices.filter(d => d.presence === 'offline').length
    const newCount = mergedDevices.filter(d => d.isNew || d.presence === 'new').length

    return (
        <div className="v3-page-layout page-enter">
            <div className="v3-page-header">
                <h1 className="v3-page-title"><Radar size={22} color="var(--color-accent)" /> LAN Scanner</h1>
                <p className="v3-page-subtitle">Discover, identify and inspect all devices on your local network</p>
            </div>

            {/* Config */}
            <div className="scan-config">
                <div className="scan-config-left">
                    <div className={`scan-orb ${scanning ? 'active' : devices.length ? 'done' : ''}`}>
                        <Radar size={22} />
                        {scanning && <div className="scan-orb-ring" />}
                    </div>
                    <div>
                        <div className="scan-status">
                            {scanning ? <><Loader2 size={14} className="spin-icon" /> Scanning {baseIP}.*{safeMode && <span className="safe-mode-tag"> · safe mode (~2 min)</span>}</>
                                : devices.length ? <span style={{color:'var(--color-success)'}}>{devices.length} device{devices.length!==1?'s':''} found</span>
                                : 'Ready to scan'}
                        </div>
                        {scanning && <div className="scan-bar"><div className="scan-bar-fill" style={{width:`${progress}%`}}/></div>}
                        {!scanning && (
                            <button
                                type="button"
                                className={`safe-mode-toggle ${safeMode ? 'on' : ''}`}
                                onClick={toggleSafeMode}
                                title={safeMode
                                    ? 'Safe Scan ON — lower concurrency, longer timeouts, no TCP touch or multicast. About 2 min on a /24 subnet but gentler for legacy networks.'
                                    : 'Safe Scan OFF — full-speed discovery (about 20 s on a /24). Enable for sensitive or legacy networks.'}
                            >
                                <ShieldCheck size={13} />
                                Safe Scan {safeMode ? 'on' : 'off'}
                                {safeMode && <span className="safe-mode-hint">· slower</span>}
                            </button>
                        )}
                    </div>
                </div>
                <div className="scan-config-right">
                    <input className="v3-input sc-ip" value={baseIP} onChange={e=>{ setBaseIP(e.target.value); if (inputError) setInputError(null) }} placeholder="192.168.1" />
                    <span className="sc-sep">.</span>
                    <input className="v3-input sc-range mono" type="number" value={rangeStart} onChange={e=>{ setRangeStart(+e.target.value); if (inputError) setInputError(null) }} min={1} max={254} />
                    <span className="sc-sep">–</span>
                    <input className="v3-input sc-range mono" type="number" value={rangeEnd} onChange={e=>{ setRangeEnd(+e.target.value); if (inputError) setInputError(null) }} min={1} max={254} />
                    {scanning ? (
                        <button className="v3-btn v3-btn-secondary" style={{ color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.3)' }} onClick={stopScan}>
                            <XCircle size={15} /> Stop
                        </button>
                    ) : (
                        <button className="v3-btn v3-btn-primary" onClick={startScan}>
                            <Search size={15} /> Scan
                        </button>
                    )}
                </div>
            </div>
            {inputError && <div className="scan-error"><AlertCircle size={14} />{inputError}</div>}

            {/* Summary — status pills on top, vendor pills below when needed */}
            {mergedDevices.length > 0 && (
                <div className="scan-pills">
                    <span className="spill total"><Signal size={13}/>{mergedDevices.length} Known</span>
                    <span className="spill" style={{color:'var(--color-success)'}}><Clock size={13}/>{onlineCount} Online</span>
                    {cachedCount > 0 && <span className="spill spill-cached">{cachedCount} Cached</span>}
                    {offlineCount > 0 && <span className="spill" style={{color:'var(--text-muted)'}}>{offlineCount} Offline</span>}
                    {newCount > 0 && (
                        <button
                            type="button"
                            className={`spill spill-new ${newOnly ? 'spill-active' : ''}`}
                            onClick={() => setNewOnly(v => !v)}
                            title={newOnly ? 'Show all devices' : 'Filter to only new devices'}
                        >
                            {newCount} New {newOnly && '(filtered)'}
                        </button>
                    )}
                    {Object.entries(vcounts).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([v,c])=>{
                        const dt = DEV_TYPES[v] || SPECIAL_TYPES['_' + v] || DEF
                        const I = dt.Icon || HelpCircle
                        const shortLabel = v.length > 22 ? v.slice(0, 20) + '…' : v
                        return <span className="spill" key={v} title={v}><I size={13}/>{shortLabel} ({c})</span>
                    })}
                </div>
            )}

            {/* Content */}
            {mergedDevices.length > 0 && (
                <div className="scan-body">
                    <div className="dev-list">
                        <div className="dev-list-meta">
                            <span className="dev-list-meta-count">
                                Showing {listedDevices.length}
                                {mergedDevices.length !== visibleDevices.length && ` (of ${mergedDevices.length})`}
                            </span>
                            <div className="dev-list-meta-actions">
                                {offlineCount > 0 && (
                                    <button
                                        type="button"
                                        className="spill-toggle"
                                        onClick={toggleShowOffline}
                                        title={showOffline ? 'Hide offline devices' : 'Show offline devices'}
                                    >
                                        {showOffline ? <EyeOff size={12} /> : <Eye size={12} />}
                                        {showOffline ? 'Hide offline' : 'Show offline'}
                                    </button>
                                )}
                                <ExportMenu
                                    kind="lan-scan"
                                    size="sm"
                                    disabled={scanning}
                                    payload={async () => {
                                        let hostname = ''
                                        try {
                                            const info = await bridge.getSystemInfo?.()
                                            hostname = info?.hostname || ''
                                        } catch { /* noop */ }
                                        // Export mirrors what the user is currently viewing —
                                        // including the same gateway-pinned + alphabetical
                                        // sort the on-screen list uses (listedDevices), not
                                        // just the post-filter pool (visibleDevices). Strip
                                        // UI-only fields (React icon component + colour)
                                        // that can't cross the IPC boundary.
                                        const slimDevices = listedDevices.map(d => {
                                            // eslint-disable-next-line no-unused-vars
                                            const { DevIcon, devColor, ...rest } = d
                                            return rest
                                        })
                                        return {
                                            baseIP,
                                            range: { start: rangeStart, end: rangeEnd },
                                            scannedAt: new Date().toISOString(),
                                            hostname,
                                            devices: slimDevices,
                                        }
                                    }}
                                />
                            </div>
                        </div>
                        <div className="dev-list-header">
                            {[
                                { key: 'name', label: 'Device' },
                                { key: 'type', label: 'Type' },
                                { key: 'latency', label: 'Latency' },
                            ].map(col => {
                                const active = sort.key === col.key
                                const Icon = !active ? ArrowUpDown : (sort.dir === 'asc' ? ArrowUp : ArrowDown)
                                return (
                                    <button
                                        key={col.key}
                                        type="button"
                                        className={`dev-list-sort ${active ? 'active' : ''}`}
                                        onClick={() => cycleSort(col.key)}
                                        title={
                                            !active
                                                ? `Sort by ${col.label}`
                                                : sort.dir === 'asc'
                                                    ? `Sorted by ${col.label} ascending — click for descending`
                                                    : `Sorted by ${col.label} descending — click to reset`
                                        }
                                    >
                                        <span>{col.label}</span>
                                        <Icon size={11} className="dev-list-sort-ico" />
                                    </button>
                                )
                            })}
                            <span />
                        </div>
                        {listedDevices.map((d,i)=>{
                            const sel = selected?.ip===d.ip
                            const DIcon = d.DevIcon || HelpCircle
                            const primaryName = primaryLabel(d)
                            const subName = d.nickname ? (d.hostname || d.displayName || cleanVendorName(d.vendor) || null) : null
                            const latencyColor = d.time == null
                                ? 'var(--text-muted)'
                                : d.time < 10 ? 'var(--color-success)'
                                : d.time < 50 ? 'var(--color-warning)'
                                : 'var(--color-danger)'
                            const latencyLabel = d.presence === 'offline'
                                ? 'offline'
                                : d.presence === 'cached' ? 'cached'
                                : d.time != null ? `${d.time}ms` : d.seenOnly ? 'seen' : '—'
                            return (
                                <div className={`dev-row ${sel?'sel':''} dev-presence-${d.presence}`} key={d.deviceKey || `ip:${d.ip}` || `idx:${i}`} onClick={()=>openDetail(d)}>
                                    <div className="dev-row-main">
                                        <div className="dev-ico" style={{'--dc': d.devColor || '#94a3b8'}}>
                                            <DIcon size={16}/>
                                            <span className={`dev-presence-dot dev-presence-dot-${d.presence}`} />
                                        </div>
                                        <div>
                                            <div className="dev-name">
                                                {primaryName}
                                                {subName && subName !== primaryName && <span className="dev-subname"> · {subName}</span>}
                                                {(d.isNew || d.presence === 'new') && <span className="gw-tag" style={{background:'color-mix(in srgb, var(--color-success) 15%, transparent)',color:'var(--color-success)'}}>NEW</span>}
                                                {d.presence === 'cached' && <span className="gw-tag" style={{background:'rgba(184,148,106,0.16)',color:'#8a6a40'}} title="Seen in ARP/neighbor cache, but did not actively reply">CACHED</span>}
                                                {d.presence === 'offline' && <span className="gw-tag" style={{background:'var(--gray-100)',color:'var(--text-muted)'}}>OFFLINE</span>}
                                                {d.isGateway && <span className="gw-tag">GW</span>}
                                                {d.isLocal && <span className="gw-tag" style={{background:'rgba(59,130,246,0.1)',color:'#3b82f6'}}>YOU</span>}
                                                {d.isRandomized && !d.isLocal && !d.isGateway && <span className="gw-tag" style={{background:'rgba(139,92,246,0.1)',color:'#8b5cf6'}}>RND</span>}
                                                {d.seenOnly && !d.isLocal && d.presence !== 'offline' && d.presence !== 'cached' && <span className="gw-tag" style={{background:'rgba(148,163,184,0.15)',color:'#64748b'}}>ARP</span>}
                                                {d.nameSource && d.nameSource !== 'unknown' && SRC_COLORS[d.nameSource] && (
                                                    <span className="src-badge" style={{background: SRC_COLORS[d.nameSource].bg, color: SRC_COLORS[d.nameSource].fg}}>
                                                        {SRC_COLORS[d.nameSource].label}
                                                    </span>
                                                )}
                                                {!d.hostname && d.vendorSource && d.vendorSource !== 'unknown' && SRC_COLORS[d.vendorSource] && (
                                                    <span className="src-badge" style={{background: SRC_COLORS[d.vendorSource].bg, color: SRC_COLORS[d.vendorSource].fg}}>
                                                        {SRC_COLORS[d.vendorSource].label}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="dev-ip mono">
                                                {d.ip || '—'}
                                                {d.mac && !d.macEmpty && <span className="dev-mac"> · {d.mac}</span>}
                                                {d.vendor && d.hostname && <span className="dev-vendor"> · {d.vendor}</span>}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="dev-type">{d.deviceType}</div>
                                    <div className="dev-ms mono" style={{ color: latencyColor }}>{latencyLabel}</div>
                                    <ChevronRight size={14} className="dev-arr"/>
                                </div>
                            )
                        })}
                    </div>

                    {selected && (
                        <div className="dev-detail" key={selected.ip}>
                            <div className="dd-scroll" ref={detailScrollRef}>
                            <div className="dd-head">
                                <div className="dd-head-left">
                                    <div className="dd-ico" style={{'--dc':selected.devColor || '#94a3b8'}}>
                                        {(()=>{const I=selected.DevIcon || HelpCircle;return<I size={20}/>})()}
                                    </div>
                                    <div>
                                        <div className="dd-name">{primaryLabel(selected)}</div>
                                        <div className="dd-type">{selected.deviceType}</div>
                                    </div>
                                </div>
                                <button className="dd-close" onClick={()=>setSelected(null)}><X size={16}/></button>
                            </div>
                            <DeviceMetaEditor device={selected} onChange={handleInventoryPatch} />
                            <div className="dd-grid">
                                {/*
                                  Layout strategy: short, fixed-format fields go 2-per-row;
                                  long/variable fields (MAC, Hostname, Vendor, Role, Model
                                  name) span the full width so they never get clipped at
                                  ~140px. The 340px-wide panel can't fit a full MAC + a
                                  vendor side-by-side, so we don't force it.
                                */}
                                <DF l="IP Address" v={selected.ip} m copy/>
                                <DF l="Ping" v={selected.time!=null?`${selected.time} ms`:selected.presence === 'cached'?'No active reply (cached)':selected.seenOnly?'No reply (ARP seen)':'—'} m/>
                                <DF l="Type" v={selected.deviceType}/>
                                <DF l="Status" v={presenceLabel(selected)}/>
                                <DF l="MAC Address" v={selected.mac && !selected.macEmpty ? selected.mac : (selected.isLocal ? 'N/A (local)' : 'Not available')} full m copy/>
                                <DF l="Hostname" v={
                                    selected.hostname
                                        ? <span>{selected.hostname} <SrcBadge source={selected.nameSource}/></span>
                                        : <span style={{color:'var(--color-muted)'}}>Not resolved</span>
                                } full/>
                                <DF l="Vendor" v={
                                    selected.vendor
                                        ? <span>{selected.vendor} <SrcBadge source={selected.vendorSource}/></span>
                                        : <span style={{color:'var(--color-muted)'}}>Unknown</span>
                                } full/>
                                <DF l="Role" v={selected.isLocal?'This Device':selected.isGateway?'Default Gateway':selected.isRandomized?'Private/Random MAC':'Client'} full/>
                                <DF l="Discovery" v={discoveryEvidenceLabel(selected)} full/>
                                {selected.modelName && <DF l="Model" v={selected.modelName} full/>}
                                {selected.modelNumber && <DF l="Model #" v={selected.modelNumber} m/>}
                                {selected.serialNumber && <DF l="Serial" v={selected.serialNumber} full m/>}
                                {selected.modelDescription && <DF l="Model info" v={selected.modelDescription} full/>}
                                {serviceSummary(selected) && <DF l="Services" v={serviceSummary(selected)} full/>}
                                {selected.presentationUrl && <DF l="Device URL" v={selected.presentationUrl} full m/>}
                            </div>
                            {detailLoading?(
                                <div className="dd-loading">
                                    <div className="dd-loading-row"><Loader2 size={16} className="spin-icon"/>Running diagnostics…</div>
                                    {selected.seenOnly && !selected.isLocal && <span className="dd-loading-hint">This device was only seen via ARP — probes may take longer</span>}
                                </div>
                            ):detailData?(
                                <>
                                    {/* Warnings / errors */}
                                    {detailData.warnings?.length > 0 && (
                                        <div className="dd-warnings">
                                            {detailData.warnings.map((w, i) => (
                                                <div className={`dd-warn dd-warn-${w.type}`} key={i}>
                                                    <AlertCircle size={13} />
                                                    <span>{w.msg}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {detailData.ping&&detailData.ping.times?.length > 0&&(
                                        <div className="dd-section">
                                            <div className="dd-sec-title"><Signal size={14}/> Ping ({detailData.ping.times?.length || 0} packets)</div>
                                            <div className="dd-stats">
                                                <div className="dds"><span className="dds-v mono" style={{color:'var(--color-success)'}}>{detailData.ping.min??'—'}</span><span className="dds-l">Min</span></div>
                                                <div className="dds"><span className="dds-v mono">{detailData.ping.avg??'—'}</span><span className="dds-l">Avg</span></div>
                                                <div className="dds"><span className="dds-v mono" style={{color:'var(--color-warning)'}}>{detailData.ping.max??'—'}</span><span className="dds-l">Max</span></div>
                                                <div className="dds"><span className="dds-v mono" style={{color:detailData.ping.loss>0?'var(--color-danger)':'var(--color-success)'}}>{detailData.ping.loss}%</span><span className="dds-l">Loss</span></div>
                                            </div>
                                        </div>
                                    )}
                                    {!detailData.timedOut && (
                                        <div className="dd-section">
                                            <div className="dd-sec-title"><Shield size={14}/> Open Ports</div>
                                            {detailData.openPorts?.length>0?(
                                                <div className="dd-ports">
                                                    {detailData.openPorts.map(p=>(
                                                        <span className="port-chip" key={p}><span className="port-dot"/>{p} <span className="port-svc">{({22:'SSH',53:'DNS',80:'HTTP',443:'HTTPS',3389:'RDP',5000:'UPnP',8080:'HTTP*',8443:'HTTPS*',9090:'Admin'})[p]||'tcp'}</span></span>
                                                    ))}
                                                </div>
                                            ):(<div className="dd-empty">No common ports open</div>)}
                                        </div>
                                    )}
                                </>
                            ):null}
                            </div>
                            <div className="dd-footer">
                                <button className="v3-btn v3-btn-secondary dd-rescan" onClick={()=>openDetail(selected)}><RefreshCw size={14}/> Re-scan</button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {!scanning && mergedDevices.length===0 && (
                <div className="scan-empty"><Radar size={48} strokeWidth={1}/><div>Configure your network range and start scanning</div></div>
            )}
        </div>
    )
}

/**
 * Detail field. Pass `copy` to enable click-to-copy on the value with
 * a brief "Copied" flash. The copy target is the literal `v` value
 * (so don't pass JSX nodes when you want to copy — pass a plain
 * string and let DF render it).
 */
function DF({l,v,m,full,copy}){
    const [copied, setCopied] = useState(false)
    const canCopy = copy && typeof v === 'string' && v.length > 0
    const handleCopy = () => {
        if (!canCopy) return
        navigator.clipboard.writeText(v).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
        }).catch(() => { /* clipboard unavailable; silent */ })
    }
    return (
        <div className={`dd-field${full?' dd-field-full':''}`}>
            <div className="dd-fl">{l}</div>
            <div
                className={`dd-fv${m?' mono':''}${canCopy?' dd-fv-copy':''}`}
                onClick={canCopy ? handleCopy : undefined}
                role={canCopy ? 'button' : undefined}
                tabIndex={canCopy ? 0 : undefined}
                onKeyDown={canCopy ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCopy() } } : undefined}
                title={canCopy ? (copied ? 'Copied' : 'Click to copy') : undefined}
            >
                {copied ? <span className="dd-fv-copied">Copied</span> : v}
            </div>
        </div>
    )
}

/** Source badge (PTR, NetBIOS, mDNS, OUI) */
function SrcBadge({ source }) {
    const s = SRC_COLORS[source]
    if (!s) return null
    return <span className="src-badge" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
}

