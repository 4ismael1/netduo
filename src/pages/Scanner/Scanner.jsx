import { useState, useEffect, useRef } from 'react'
import {
    Radar, Search, Router, Monitor, Smartphone, Laptop, Printer,
    Tv, HardDrive, Cpu, Wifi, Server, HelpCircle, Loader2,
    X, Globe, Clock, Signal, Shield, ChevronRight, RefreshCw,
    Shuffle, Home, AlertCircle, Tag
} from 'lucide-react'
import bridge from '../../lib/electronBridge'
import { validateLanScanInputs } from '../../lib/validation'
import './Scanner.css'

/* ═══════════════════════════════════════
   Device type catalogue — maps vendor or
   classification key → icon / color / type string.
   OUI lookup now happens on the backend via
   the comprehensive oui-db.js module.
   ═══════════════════════════════════════ */
const DEV_TYPES = {
    'Apple':     { type: 'Phone / Laptop', Icon: Laptop, color: '#0ea5e9' },
    'Samsung':   { type: 'Phone / TV', Icon: Smartphone, color: '#6366f1' },
    'Google':    { type: 'Smart Device', Icon: Wifi, color: '#22c55e' },
    'Xiaomi':    { type: 'Smart Device', Icon: Smartphone, color: '#f97316' },
    'Intel':     { type: 'Computer', Icon: Cpu, color: '#3b82f6' },
    'TP-Link':   { type: 'Router / AP', Icon: Router, color: '#0ea5e9' },
    'TP-Link Kasa': { type: 'Smart Plug', Icon: Wifi, color: '#0ea5e9' },
    'Cisco':     { type: 'Network Infra', Icon: Server, color: '#64748b' },
    'ASUS':      { type: 'Router / PC', Icon: Router, color: '#8b5cf6' },
    'Netgear':   { type: 'Router / AP', Icon: Router, color: '#f59e0b' },
    'Huawei':    { type: 'Phone / Router', Icon: Smartphone, color: '#ef4444' },
    'Microsoft': { type: 'PC / Hyper-V', Icon: Monitor, color: '#0ea5e9' },
    'Amazon':    { type: 'Echo / Fire', Icon: Tv, color: '#f59e0b' },
    'Dell':      { type: 'Computer', Icon: Monitor, color: '#3b82f6' },
    'HP':        { type: 'Computer / Printer', Icon: Printer, color: '#3b82f6' },
    'Espressif': { type: 'IoT / ESP Board', Icon: Cpu, color: '#22c55e' },
    'Raspberry Pi': { type: 'Raspberry Pi', Icon: HardDrive, color: '#dc2626' },
    'LG':        { type: 'TV / Appliance', Icon: Tv, color: '#64748b' },
    'Sony':      { type: 'TV / Console', Icon: Tv, color: '#1e293b' },
    'Roku':      { type: 'Streaming', Icon: Tv, color: '#8b5cf6' },
    'Ring':      { type: 'Security Cam', Icon: Shield, color: '#0ea5e9' },
    'Sonos':     { type: 'Speaker', Icon: Wifi, color: '#000000' },
    'Nest':      { type: 'Smart Home', Icon: Wifi, color: '#22c55e' },
    'D-Link':    { type: 'Router / AP', Icon: Router, color: '#f59e0b' },
    'Ubiquiti':  { type: 'Network Infra', Icon: Server, color: '#0ea5e9' },
    'Aruba':     { type: 'Network Infra', Icon: Server, color: '#f59e0b' },
    'Lenovo':    { type: 'Computer', Icon: Monitor, color: '#e11d48' },
    'Motorola':  { type: 'Phone / Modem', Icon: Smartphone, color: '#3b82f6' },
    'Nintendo':  { type: 'Game Console', Icon: Tv, color: '#dc2626' },
    'Philips Hue': { type: 'Smart Light', Icon: Wifi, color: '#f59e0b' },
    'Bose':      { type: 'Speaker', Icon: Wifi, color: '#1e293b' },
    'Synology':  { type: 'NAS', Icon: HardDrive, color: '#3b82f6' },
    'QNAP':      { type: 'NAS', Icon: HardDrive, color: '#0ea5e9' },
    'VMware':    { type: 'Virtual Machine', Icon: Server, color: '#64748b' },
    'Realtek':   { type: 'Network Adapter', Icon: Cpu, color: '#94a3b8' },
    'Broadcom':  { type: 'Network Chip', Icon: Cpu, color: '#94a3b8' },
    'ZTE':       { type: 'Router / Modem', Icon: Router, color: '#3b82f6' },
    'Technicolor': { type: 'Router / Modem', Icon: Router, color: '#8b5cf6' },
    'OnePlus':   { type: 'Phone', Icon: Smartphone, color: '#ef4444' },
    'OPPO':      { type: 'Phone', Icon: Smartphone, color: '#22c55e' },
    'Belkin':    { type: 'Router / AP', Icon: Router, color: '#64748b' },
    'Tuya':      { type: 'Smart Device', Icon: Wifi, color: '#f59e0b' },
    'Shelly':    { type: 'Smart Relay', Icon: Wifi, color: '#3b82f6' },
    'Dyson':     { type: 'Smart Appliance', Icon: Wifi, color: '#8b5cf6' },
    'Wyze':      { type: 'Smart Camera', Icon: Shield, color: '#22c55e' },
    'MediaTek':  { type: 'Network Chip', Icon: Cpu, color: '#94a3b8' },
    'Qualcomm':  { type: 'Network Chip', Icon: Cpu, color: '#94a3b8' },
}

const SPECIAL_TYPES = {
    '_Gateway':    { type: 'Gateway / Router', Icon: Router, color: '#10b981' },
    '_ThisDevice': { type: 'This Device', Icon: Home, color: '#3b82f6' },
    '_Randomized': { type: 'Randomized MAC', Icon: Shuffle, color: '#8b5cf6' },
    '_NetworkDev': { type: 'Network Device', Icon: Globe, color: '#64748b' },
}
const DEF = { type: 'Unknown', Icon: HelpCircle, color: '#94a3b8' }

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

    if (d.isGateway) {
        if (d.vendor && DEV_TYPES[d.vendor]) return { ...SPECIAL_TYPES['_Gateway'], type: `Gateway (${d.vendor})` }
        return { ...SPECIAL_TYPES['_Gateway'] }
    }

    if (d.vendor) {
        if (DEV_TYPES[d.vendor]) return { ...DEV_TYPES[d.vendor] }
        return { ...SPECIAL_TYPES['_NetworkDev'], type: `${d.vendor} Device` }
    }

    if (d.isRandomized) return { ...SPECIAL_TYPES['_Randomized'] }

    if (d.mac && !d.macEmpty) return { ...SPECIAL_TYPES['_NetworkDev'] }

    return { ...DEF }
}

export default function Scanner() {
    const [scanning, setScanning] = useState(false)
    const [devices, setDevices] = useState([])
    const [progress, setProgress] = useState(0)
    const [baseIP, setBaseIP] = useState('192.168.1')
    const [rangeStart, setRangeStart] = useState(1)
    const [rangeEnd, setRangeEnd] = useState(254)
    const [selected, setSelected] = useState(null)
    const [detailLoading, setDetailLoading] = useState(false)
    const [detailData, setDetailData] = useState(null)
    const [inputError, setInputError] = useState(null)
    const detailScrollRef = useRef(null)
    const prevDetailLoadingRef = useRef(false)
    const scanRunRef = useRef(0)

    useEffect(() => {
        bridge.getNetworkInterfaces().then(ifaces => {
            const ipv4 = ifaces?.find(i => i.family === 'IPv4' && !i.internal)
            if (ipv4?.address) {
                const p = ipv4.address.split('.'); p.pop(); setBaseIP(p.join('.'))
            }
        }).catch(() => {})
    }, [])

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

    async function enrichUnknownDevices(seedDevices, scanId) {
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
            if (scanRunRef.current !== scanId || !Array.isArray(updates) || updates.length === 0) return

            const byIp = new Map(updates.map(row => [row.ip, row]))
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
        } catch {
            // Background enrichment is best-effort and should never block scanner UX.
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
        setScanning(true); setDevices([]); setProgress(0); setSelected(null); setDetailData(null)
        const total = safeRangeEnd - safeRangeStart + 1
        const BATCH = 30
        const found = []
        for (let s = safeRangeStart; s <= safeRangeEnd; s += BATCH) {
            const e = Math.min(s + BATCH - 1, safeRangeEnd)
            const results = await bridge.lanScan(safeBaseIP, s, e)
            if (scanRunRef.current !== scanId) return
            if (results) {
                const enriched = results.map(r => enrichForView(r))
                found.push(...enriched); setDevices([...found])
            }
            setProgress(Math.round(((e - safeRangeStart + 1) / total) * 100))
        }
        if (scanRunRef.current !== scanId) return
        setScanning(false)
        bridge.historyAdd({ module: 'LAN Scanner', type: 'Scan', detail: `${safeBaseIP}.0/24`, results: { found: found.length } })
        void enrichUnknownDevices(found, scanId)
    }
    async function openDetail(device) {
        setSelected(device); setDetailLoading(true); setDetailData(null)
        detailScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })

        const isSeen = device.seenOnly && !device.isLocal
        const extra = { warnings: [], timedOut: false }

        // Helper: race a promise against a timeout
        const withTimeout = (promise, ms, fallback) =>
            Promise.race([promise, new Promise(r => setTimeout(() => r(fallback), ms))])

        try {
            // Ping — use fewer packets for seen-only devices
            const pingCount = isSeen ? 2 : 5
            const pingTimeout = isSeen ? 5000 : 12000
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
            const portTimeout = isSeen ? 4000 : 8000
            try {
                const ports = [22, 53, 80, 443, 3389, 5000, 8080, 8443, 9090]
                const r = await withTimeout(
                    Promise.all(ports.map(p => bridge.checkPort(device.ip, p, isSeen ? 800 : 1500))),
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

        setDetailData(extra); setDetailLoading(false)
    }

    /* Vendor / type counts for summary pills */
    const vcounts = {}
    devices.forEach(d => {
        const key = d.isLocal ? 'This Device'
            : d.isGateway ? 'Gateway'
            : d.vendor || (d.isRandomized ? 'Randomized MAC' : (d.mac && !d.macEmpty ? 'Network Device' : 'Unknown'))
        vcounts[key] = (vcounts[key] || 0) + 1
    })
    const responsiveCount = devices.filter(d => d.alive).length

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
                            {scanning ? <><Loader2 size={14} className="spin-icon" /> Scanning {baseIP}.*</>
                                : devices.length ? <span style={{color:'var(--color-success)'}}>{devices.length} device{devices.length!==1?'s':''} found</span>
                                : 'Ready to scan'}
                        </div>
                        {scanning && <div className="scan-bar"><div className="scan-bar-fill" style={{width:`${progress}%`}}/></div>}
                    </div>
                </div>
                <div className="scan-config-right">
                    <input className="v3-input sc-ip" value={baseIP} onChange={e=>{ setBaseIP(e.target.value); if (inputError) setInputError(null) }} placeholder="192.168.1" />
                    <span className="sc-sep">.</span>
                    <input className="v3-input sc-range mono" type="number" value={rangeStart} onChange={e=>{ setRangeStart(+e.target.value); if (inputError) setInputError(null) }} min={1} max={254} />
                    <span className="sc-sep">–</span>
                    <input className="v3-input sc-range mono" type="number" value={rangeEnd} onChange={e=>{ setRangeEnd(+e.target.value); if (inputError) setInputError(null) }} min={1} max={254} />
                    <button className="v3-btn v3-btn-primary" onClick={startScan} disabled={scanning}>
                        {scanning ? <Loader2 size={15} className="spin-icon" /> : <Search size={15} />}
                        {scanning ? 'Scanning…' : 'Scan'}
                    </button>
                </div>
            </div>
            {inputError && <div className="scan-error"><AlertCircle size={14} />{inputError}</div>}

            {/* Summary */}
            {devices.length > 0 && (
                <div className="scan-pills">
                    <span className="spill total"><Signal size={13}/>{devices.length} Discovered</span>
                    <span className="spill"><Clock size={13}/>{responsiveCount} Ping Replies</span>
                    {Object.entries(vcounts).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([v,c])=>{
                        const dt = DEV_TYPES[v] || SPECIAL_TYPES['_' + v] || DEF
                        const I = dt.Icon || HelpCircle
                        return <span className="spill" key={v}><I size={13}/>{v} ({c})</span>
                    })}
                </div>
            )}

            {/* Content */}
            {devices.length > 0 && (
                <div className="scan-body">
                    <div className="dev-list">
                        <div className="dev-list-meta">
                            <span>{devices.length} total</span>
                            <span>Scroll to view all</span>
                        </div>
                        <div className="dev-list-header">
                            <span>Device</span><span>Type</span><span>Latency</span><span></span>
                        </div>
                        {devices.map((d,i)=>{
                            const sel = selected?.ip===d.ip
                            const DIcon = d.DevIcon || HelpCircle
                            const primaryName = d.displayName || d.vendor || 'Unknown Device'
                            const latencyColor = d.time == null
                                ? 'var(--text-muted)'
                                : d.time < 10 ? 'var(--color-success)'
                                : d.time < 50 ? 'var(--color-warning)'
                                : 'var(--color-danger)'
                            const latencyLabel = d.time != null ? `${d.time}ms` : d.seenOnly ? 'seen' : '—'
                            return (
                                <div className={`dev-row ${sel?'sel':''}`} key={d.ip} onClick={()=>openDetail(d)} style={{animationDelay:`${i*20}ms`}}>
                                    <div className="dev-row-main">
                                        <div className="dev-ico" style={{'--dc': d.devColor || '#94a3b8'}}><DIcon size={16}/></div>
                                        <div>
                                            <div className="dev-name">
                                                {primaryName}
                                                {d.isGateway && <span className="gw-tag">GW</span>}
                                                {d.isLocal && <span className="gw-tag" style={{background:'rgba(59,130,246,0.1)',color:'#3b82f6'}}>YOU</span>}
                                                {d.isRandomized && !d.isLocal && !d.isGateway && <span className="gw-tag" style={{background:'rgba(139,92,246,0.1)',color:'#8b5cf6'}}>RND</span>}
                                                {d.seenOnly && !d.isLocal && <span className="gw-tag" style={{background:'rgba(148,163,184,0.15)',color:'#64748b'}}>ARP</span>}
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
                                                {d.ip}
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
                                        <div className="dd-name">{selected.displayName || selected.vendor || 'Unknown Device'}</div>
                                        <div className="dd-type">{selected.deviceType}</div>
                                    </div>
                                </div>
                                <button className="dd-close" onClick={()=>setSelected(null)}><X size={16}/></button>
                            </div>
                            <div className="dd-grid">
                                <DF l="IP Address" v={selected.ip} m/>
                                <DF l="MAC Address" v={selected.mac && !selected.macEmpty ? selected.mac : 'N/A (local)'} m/>
                                <DF l="Hostname" v={
                                    selected.hostname
                                        ? <span>{selected.hostname} <SrcBadge source={selected.nameSource}/></span>
                                        : <span style={{color:'var(--color-muted)'}}>Not resolved</span>
                                }/>
                                <DF l="Vendor" v={
                                    selected.vendor
                                        ? <span>{selected.vendor} <SrcBadge source={selected.vendorSource}/></span>
                                        : <span style={{color:'var(--color-muted)'}}>Unknown</span>
                                }/>
                                <DF l="Ping" v={selected.time!=null?`${selected.time} ms`:selected.seenOnly?'No reply (ARP seen)':'—'} m/>
                                <DF l="Type" v={selected.deviceType}/>
                                <DF l="Role" v={selected.isLocal?'This Device':selected.isGateway?'Default Gateway':selected.isRandomized?'Private/Random MAC':'Client'}/>
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

            {!scanning && devices.length===0 && (
                <div className="scan-empty"><Radar size={48} strokeWidth={1}/><div>Configure your network range and start scanning</div></div>
            )}
        </div>
    )
}

/** Detail field */
function DF({l,v,m}){return(<div className="dd-field"><div className="dd-fl">{l}</div><div className={`dd-fv${m?' mono':''}`}>{v}</div></div>)}

/** Source badge (PTR, NetBIOS, mDNS, OUI) */
function SrcBadge({ source }) {
    const s = SRC_COLORS[source]
    if (!s) return null
    return <span className="src-badge" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
}

