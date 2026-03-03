import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
    AlertTriangle,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Clock3,
    Copy,
    Database,
    Fingerprint,
    Globe,
    History,
    House,
    Info,
    Loader2,
    Play,
    Radar,
    RefreshCw,
    Router,
    Search,
    Shield,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    Trash2,
    TriangleAlert,
    Wifi,
    XCircle,
} from 'lucide-react'
import bridge from '../../lib/electronBridge'
import { validateLanScanInputs } from '../../lib/validation'
import './LanCheck.css'

const PROFILE_PRESETS = {
    quick: {
        title: 'Quick',
        description: 'Critical LAN checks in under ~90s.',
        batchSize: 64,
        hostLimit: 14,
        concurrency: 22,
        timeoutMs: 850,
        ports: [23, 53, 80, 139, 443, 445, 1900, 3389, 7547, 8080, 8443, 5351],
    },
    standard: {
        title: 'Standard',
        description: 'Balanced router + east-west security assessment.',
        batchSize: 52,
        hostLimit: 22,
        concurrency: 30,
        timeoutMs: 900,
        ports: [21, 22, 23, 53, 67, 68, 80, 111, 123, 139, 161, 389, 443, 445, 500, 1900, 3389, 5351, 5985, 6379, 7547, 8080, 8443],
    },
    deep: {
        title: 'Deep',
        description: 'Extended LAN hardening audit with broad service fingerprinting.',
        batchSize: 42,
        hostLimit: 34,
        concurrency: 38,
        timeoutMs: 1050,
        ports: [21, 22, 23, 25, 53, 67, 68, 69, 80, 88, 110, 111, 123, 135, 137, 138, 139, 143, 161, 389, 443, 445, 500, 587, 993, 995, 1433, 1521, 1723, 1900, 2375, 2376, 3306, 3389, 5351, 5432, 5900, 5985, 6379, 7547, 8080, 8443, 9000, 9443, 10000, 15672, 27017],
    },
}

const STEP_KEYS = [
    { id: 'discovery', label: 'Discovery', icon: Radar },
    { id: 'upnp', label: 'UPnP Intel', icon: Wifi },
    { id: 'services', label: 'Service Sweep', icon: Fingerprint },
    { id: 'analysis', label: 'Risk Analysis', icon: Shield },
]

const PORT_LABELS = {
    21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns', 67: 'dhcp',
    68: 'dhcp', 69: 'tftp', 80: 'http', 88: 'kerberos', 110: 'pop3',
    111: 'rpcbind', 123: 'ntp', 135: 'msrpc', 137: 'netbios-ns', 138: 'netbios-dgm',
    139: 'netbios-ssn', 143: 'imap', 161: 'snmp', 389: 'ldap', 443: 'https',
    445: 'microsoft-ds', 500: 'isakmp', 587: 'smtp-submission', 993: 'imaps',
    995: 'pop3s', 1433: 'mssql', 1521: 'oracle', 1723: 'pptp', 1900: 'ssdp',
    2375: 'docker', 2376: 'docker-tls', 3306: 'mysql', 3389: 'rdp', 5351: 'nat-pmp',
    5432: 'postgres', 5900: 'vnc', 5985: 'winrm', 6379: 'redis', 7547: 'cwmp',
    8080: 'http-alt', 8443: 'https-alt', 9000: 'mgmt-alt', 9443: 'mgmt-ssl',
    10000: 'webmin', 15672: 'rabbitmq', 27017: 'mongodb',
}

const SEVERITY_META = {
    critical: { order: 0, icon: XCircle },
    high: { order: 1, icon: TriangleAlert },
    medium: { order: 2, icon: AlertTriangle },
    low: { order: 3, icon: Info },
    info: { order: 4, icon: CheckCircle2 },
}

const REPORT_ROWS_PER_PAGE = 15

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
function byIpAsc(a, b) {
    const av = Number.parseInt(String(a.ip || '').split('.').pop() || '0', 10)
    const bv = Number.parseInt(String(b.ip || '').split('.').pop() || '0', 10)
    return av - bv
}
function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '0s'
    const sec = Math.round(ms / 1000)
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return m ? `${m}m ${s}s` : `${s}s`
}
function formatDateTime(input) {
    if (!input) return '-'
    const date = new Date(input)
    if (Number.isNaN(date.getTime())) return '-'
    return date.toLocaleString()
}
function getRiskBand(score) {
    const safe = clamp(Number(score) || 0, 0, 100)
    if (safe >= 76) return { label: 'Critical', color: '#ef4444' }
    if (safe >= 51) return { label: 'High', color: '#f97316' }
    if (safe >= 26) return { label: 'Medium', color: '#f59e0b' }
    return { label: 'Low', color: '#22c55e' }
}
function mergeDevices(current, incoming) {
    const map = new Map(current.map(d => [d.ip, d]))
    for (const item of incoming || []) map.set(item.ip, { ...map.get(item.ip), ...item })
    return [...map.values()].sort(byIpAsc)
}
function chooseGateway(devices) {
    const gateways = devices.filter(d => d.isGateway)
    return gateways.find(d => d.ip.endsWith('.1')) || gateways.find(d => d.ip.endsWith('.254')) || gateways[0] || null
}
async function runWithConcurrency(tasks, limit, onEach) {
    const outputs = new Array(tasks.length)
    let cursor = 0
    let completed = 0
    async function worker() {
        while (cursor < tasks.length) {
            const index = cursor
            cursor += 1
            try { outputs[index] = await tasks[index]() } catch { outputs[index] = null }
            completed += 1
            onEach?.(completed, tasks.length)
        }
    }
    const size = Math.max(1, Math.min(limit, tasks.length || 1))
    await Promise.all(Array.from({ length: size }, () => worker()))
    return outputs
}
function finding(id, severity, title, evidence, recommendation, category) {
    return { id, severity, title, evidence, recommendation, category }
}
function scoreFromFindings(findings, openCount) {
    const weights = { critical: 28, high: 18, medium: 10, low: 5, info: 2 }
    const base = findings.reduce((acc, item) => acc + (weights[item.severity] || 0), 0)
    return clamp(Math.round(base + Math.min(22, (openCount || 0) * 0.7)), 0, 100)
}
function normalizeHistoryRows(rows) {
    if (!Array.isArray(rows)) return []
    return rows.map(row => {
        const report = row?.report && typeof row.report === 'object' ? row.report : null
        return {
            id: row?.id ?? Date.now(),
            timestamp: row?.timestamp || report?.generatedAt || new Date().toISOString(),
            profile: row?.profile || report?.profile || 'standard',
            scope: row?.scope || report?.range || '-',
            riskScore: Number.isFinite(row?.risk_score)
                ? Number(row.risk_score)
                : (Number.isFinite(report?.summary?.riskScore) ? Number(report.summary.riskScore) : 0),
            findings: Number.isFinite(row?.findings)
                ? Number(row.findings)
                : (Array.isArray(report?.findings) ? report.findings.length : 0),
            openPorts: Number.isFinite(row?.open_ports)
                ? Number(row.open_ports)
                : (Array.isArray(report?.openPorts) ? report.openPorts.length : 0),
            report,
        }
    }).filter(item => item.report && typeof item.report === 'object').sort((a, b) => (b.id || 0) - (a.id || 0))
}

function StepPill({ step, status }) {
    const Icon = step.icon
    return (
        <div className={`lchk-step-pill ${status}`}>
            <div className="lchk-step-dot">
                {status === 'done' ? <CheckCircle2 size={13} /> : status === 'running' ? <Loader2 size={13} className="spin-icon" /> : <Icon size={13} />}
            </div>
            <span>{step.label}</span>
        </div>
    )
}

export default function LanCheck() {
    const [profile, setProfile] = useState('standard')
    const [baseIP, setBaseIP] = useState('192.168.1')
    const [rangeStart, setRangeStart] = useState(1)
    const [rangeEnd, setRangeEnd] = useState(254)
    const [inputError, setInputError] = useState('')

    const [stage, setStage] = useState('setup')
    const [running, setRunning] = useState(false)
    const [progress, setProgress] = useState(0)
    const [stepState, setStepState] = useState({ discovery: 'idle', upnp: 'idle', services: 'idle', analysis: 'idle' })
    const [activity, setActivity] = useState([])
    const [discovered, setDiscovered] = useState([])
    const [report, setReport] = useState(null)
    const [scanStartedAt, setScanStartedAt] = useState(null)
    const [scanFinishedAt, setScanFinishedAt] = useState(null)
    const [reportPage, setReportPage] = useState(1)

    const [historyRows, setHistoryRows] = useState([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [historyQuery, setHistoryQuery] = useState('')

    const preset = PROFILE_PRESETS[profile]

    async function loadHistory() {
        setHistoryLoading(true)
        try {
            const rows = await bridge.lanCheckHistoryGet()
            setHistoryRows(normalizeHistoryRows(rows))
        } catch {
            setHistoryRows([])
        } finally {
            setHistoryLoading(false)
        }
    }

    useEffect(() => {
        bridge.configGet('lancheck.settings').then(saved => {
            if (!saved || typeof saved !== 'object') return
            if (PROFILE_PRESETS[saved.profile]) setProfile(saved.profile)
            if (typeof saved.baseIP === 'string') setBaseIP(saved.baseIP)
            if (Number.isInteger(saved.rangeStart)) setRangeStart(saved.rangeStart)
            if (Number.isInteger(saved.rangeEnd)) setRangeEnd(saved.rangeEnd)
        }).catch(() => {})
        loadHistory().catch(() => {})
    }, [])

    useEffect(() => {
        bridge.getNetworkInterfaces().then(list => {
            const ipv4 = (list || []).find(item => item.family === 'IPv4' && !item.internal)
            if (!ipv4?.address) return
            const parts = ipv4.address.split('.')
            if (parts.length !== 4) return
            parts.pop()
            const autoBase = parts.join('.')
            setBaseIP(prev => (prev === '192.168.1' ? autoBase : prev))
        }).catch(() => {})
    }, [])
    const severityCounts = useMemo(() => {
        const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
        for (const item of report?.findings || []) counts[item.severity] = (counts[item.severity] || 0) + 1
        return counts
    }, [report])

    const openRows = useMemo(() => {
        const rows = [...(report?.openPorts || [])]
        rows.sort((a, b) => {
            const av = SEVERITY_META[a.severity]?.order ?? 99
            const bv = SEVERITY_META[b.severity]?.order ?? 99
            if (av !== bv) return av - bv
            if (a.ip !== b.ip) return byIpAsc(a, b)
            return a.port - b.port
        })
        return rows
    }, [report])

    const totalPages = Math.max(1, Math.ceil(openRows.length / REPORT_ROWS_PER_PAGE))
    const pagedRows = openRows.slice((reportPage - 1) * REPORT_ROWS_PER_PAGE, reportPage * REPORT_ROWS_PER_PAGE)

    useEffect(() => {
        if (reportPage > totalPages) setReportPage(totalPages)
    }, [reportPage, totalPages])

    const filteredHistory = useMemo(() => {
        const q = historyQuery.trim().toLowerCase()
        if (!q) return historyRows
        return historyRows.filter(item => {
            const riskBand = getRiskBand(item.riskScore).label.toLowerCase()
            return String(item.scope || '').toLowerCase().includes(q)
                || String(item.profile || '').toLowerCase().includes(q)
                || riskBand.includes(q)
        })
    }, [historyRows, historyQuery])

    function pushActivity(message, tone = 'info') {
        setActivity(prev => [{
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            message,
            tone,
            at: new Date().toISOString(),
        }, ...prev].slice(0, 140))
    }

    function resetRuntimeState() {
        setRunning(false)
        setProgress(0)
        setStepState({ discovery: 'idle', upnp: 'idle', services: 'idle', analysis: 'idle' })
        setActivity([])
        setDiscovered([])
        setScanStartedAt(null)
        setScanFinishedAt(null)
        setReportPage(1)
    }

    function startNewScanFlow() {
        setReport(null)
        setInputError('')
        resetRuntimeState()
        setStage('setup')
    }

    async function deleteHistoryEntry(id) {
        try {
            const updated = await bridge.lanCheckHistoryDelete(id)
            setHistoryRows(normalizeHistoryRows(updated))
        } catch {
            await loadHistory()
        }
    }

    async function clearHistoryEntries() {
        try {
            const updated = await bridge.lanCheckHistoryClear()
            setHistoryRows(normalizeHistoryRows(updated))
        } catch {
            setHistoryRows([])
        }
    }

    function openHistoryReport(entry) {
        if (!entry?.report) return
        setReport(entry.report)
        setReportPage(1)
        setStage('report')
        setScanStartedAt(entry.report.generatedAt ? Date.parse(entry.report.generatedAt) : null)
        setScanFinishedAt(entry.timestamp ? Date.parse(entry.timestamp) : null)
        setInputError('')
    }

    async function copyReportJson(payload = report) {
        if (!payload) return
        try {
            await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
            pushActivity('Report JSON copied to clipboard', 'ok')
        } catch {
            pushActivity('Clipboard unavailable on this environment', 'warn')
        }
    }

    function buildFindings({ devices, gateway, openPorts, upnp, profileId }) {
        const findings = []
        const byPort = new Map()
        for (const row of openPorts) {
            if (!byPort.has(row.port)) byPort.set(row.port, [])
            byPort.get(row.port).push(row)
        }

        if ((byPort.get(23) || []).length) {
            findings.push(finding('lan-telnet-exposed', 'critical', 'Telnet exposed inside LAN', `Detected ${(byPort.get(23) || []).length} telnet exposures on tcp/23.`, 'Disable Telnet and replace with SSH. Restrict administration interfaces by ACL.', 'remote-management'))
        }
        const smb = [...(byPort.get(139) || []), ...(byPort.get(445) || [])]
        if (smb.length) {
            findings.push(finding('lan-smb-surface', 'high', 'SMB file-sharing surface detected', `Found ${smb.length} SMB-related open service entries (tcp/139 or tcp/445).`, 'Limit SMB to trusted hosts, disable legacy SMB and enforce credential hardening.', 'lateral-movement'))
        }
        const rdp = byPort.get(3389) || []
        if (rdp.length) {
            findings.push(finding('lan-rdp-open', 'high', 'RDP service exposed', `Detected ${rdp.length} reachable RDP endpoint(s) on tcp/3389.`, 'Restrict RDP access, require NLA/MFA and keep management on isolated VLAN.', 'remote-management'))
        }

        const dbRows = [3306, 5432, 6379, 27017, 15672, 11211].flatMap(port => byPort.get(port) || [])
        if (dbRows.length) {
            findings.push(finding('lan-db-exposure', 'high', 'Data services open on LAN', `Detected database/queue services on ${new Set(dbRows.map(v => v.port)).size} sensitive ports.`, 'Segment these services, enforce auth/TLS and remove broad LAN bindings.', 'data-exposure'))
        }

        const mgmtRows = [7547, 8080, 8443, 9000, 9443, 10000].flatMap(port => byPort.get(port) || [])
        if (mgmtRows.length) {
            findings.push(finding('lan-router-mgmt-surface', 'medium', 'Management interface surface detected', `Detected ${mgmtRows.length} management-like service hits on local assets.`, 'Disable unused management endpoints and restrict admin plane to dedicated devices.', 'router-hardening'))
        }

        if (gateway) {
            const gwHttp = openPorts.some(row => row.ip === gateway.ip && row.port === 80)
            const gwHttps = openPorts.some(row => row.ip === gateway.ip && row.port === 443)
            if (gwHttp && !gwHttps) {
                findings.push(finding('lan-router-http-only', 'medium', 'Gateway panel appears reachable over plain HTTP', `Gateway ${gateway.ip} responds on tcp/80 while secure tcp/443 was not observed.`, 'Prefer HTTPS-only admin and disable remote admin unless strictly required.', 'router-hardening'))
            }
        }

        const upnpSummary = upnp?.summary || { igdCount: 0, ssdpResponders: 0, gatewayIgdCount: 0 }
        if (upnpSummary.igdCount > 0) {
            findings.push(finding('lan-upnp-igd', upnpSummary.gatewayIgdCount > 0 ? 'high' : 'medium', 'UPnP IGD capability detected', `Detected ${upnpSummary.igdCount} IGD-capable UPnP responder(s).`, 'Disable UPnP where possible and monitor NAT mapping behavior.', 'upnp'))
        } else if (upnpSummary.ssdpResponders > 0) {
            findings.push(finding('lan-ssdp-surface', 'medium', 'SSDP discovery surface present', `Detected ${upnpSummary.ssdpResponders} SSDP responder(s).`, 'Isolate IoT/UPnP-capable devices and reduce unnecessary multicast exposure.', 'upnp'))
        }

        const unknownAssets = devices.filter(d => !d.isLocal && !d.isGateway && !d.vendor && !d.hostname && !d.displayName).length
        if (unknownAssets >= 3) {
            findings.push(finding('lan-unknown-assets', 'low', 'Multiple unidentified assets', `${unknownAssets} hosts have weak inventory fingerprinting.`, 'Tag unknown devices and move non-trusted assets to guest/IoT segments.', 'asset-inventory'))
        }

        const randomized = devices.filter(d => d.isRandomized && !d.isLocal).length
        if (randomized >= 2) {
            findings.push(finding('lan-randomized-mac', 'info', 'Private MAC devices detected', `${randomized} devices are using randomized/private MAC addresses.`, 'Usually expected for privacy; maintain baseline inventory to reduce blind spots.', 'inventory'))
        }

        if (!findings.length) {
            findings.push(finding('lan-no-critical', 'info', 'No high-risk indicators in scanned scope', `No major high-risk signatures were found with profile ${PROFILE_PRESETS[profileId]?.title || profileId}.`, 'Keep periodic scans active and compare against historical baseline.', 'posture'))
        }

        findings.sort((a, b) => (SEVERITY_META[a.severity]?.order ?? 99) - (SEVERITY_META[b.severity]?.order ?? 99))
        return findings
    }

    async function startLanSecurityScan() {
        const validated = validateLanScanInputs(baseIP, rangeStart, rangeEnd)
        if (!validated.ok) {
            setInputError(validated.error)
            return
        }

        setInputError('')
        setStage('scan')
        setRunning(true)
        setProgress(0)
        setReport(null)
        setDiscovered([])
        setActivity([])
        setScanStartedAt(Date.now())
        setScanFinishedAt(null)
        setReportPage(1)
        setStepState({ discovery: 'running', upnp: 'idle', services: 'idle', analysis: 'idle' })

        const cfg = PROFILE_PRESETS[profile]
        const { baseIP: safeBase, start, end } = validated
        const scanStarted = Date.now()

        bridge.configSet('lancheck.settings', { profile, baseIP: safeBase, rangeStart: start, rangeEnd: end }).catch(() => {})
        pushActivity(`LAN check initialized for ${safeBase}.${start}-${end}`, 'info')
        try {
            let discoveredHosts = []
            const span = end - start + 1
            for (let cursor = start; cursor <= end; cursor += cfg.batchSize) {
                const chunkStart = cursor
                const chunkEnd = Math.min(cursor + cfg.batchSize - 1, end)
                pushActivity(`Discovery sweep: ${safeBase}.${chunkStart}-${chunkEnd}`, 'info')
                const chunk = await bridge.lanScan(safeBase, chunkStart, chunkEnd)
                discoveredHosts = mergeDevices(discoveredHosts, chunk || [])
                setDiscovered(discoveredHosts)
                const doneRatio = (chunkEnd - start + 1) / span
                setProgress(clamp(Math.round(doneRatio * 34), 1, 34))
            }

            pushActivity(`Discovery completed: ${discoveredHosts.length} hosts detected`, 'ok')
            setStepState(prev => ({ ...prev, discovery: 'done', upnp: 'running' }))

            const upnpIntel = await bridge.lanUpnpScan(safeBase, start, end).catch(() => ({ ok: false, summary: null, devices: [] }))
            const upnpResponders = upnpIntel?.summary?.ssdpResponders || 0
            pushActivity(upnpResponders > 0 ? `UPnP/SSDP responders detected: ${upnpResponders}` : 'No UPnP/SSDP responders detected in selected scope', upnpResponders > 0 ? 'warn' : 'ok')
            setProgress(50)
            setStepState(prev => ({ ...prev, upnp: 'done', services: 'running' }))

            const gateway = chooseGateway(discoveredHosts)
            pushActivity(gateway ? `Gateway candidate: ${gateway.ip}` : 'Gateway not identified in discovered scope', gateway ? 'info' : 'warn')

            const targetHosts = [...discoveredHosts]
                .filter(d => !d.isLocal)
                .sort((a, b) => {
                    if (a.isGateway && !b.isGateway) return -1
                    if (!a.isGateway && b.isGateway) return 1
                    if (a.alive && !b.alive) return -1
                    if (!a.alive && b.alive) return 1
                    return byIpAsc(a, b)
                })
                .slice(0, cfg.hostLimit)

            const tasks = []
            for (const host of targetHosts) {
                for (const port of cfg.ports) {
                    tasks.push(async () => {
                        const res = await bridge.checkPort(host.ip, port, cfg.timeoutMs)
                        if (!res?.open) return null
                        return {
                            ip: host.ip,
                            displayName: host.displayName || host.hostname || host.vendor || 'Unknown device',
                            isGateway: !!host.isGateway,
                            port,
                            service: PORT_LABELS[port] || `tcp/${port}`,
                            severity: port === 23 ? 'critical' : [3389, 445, 139, 2375, 7547].includes(port) ? 'high' : [8080, 8443, 1900, 161, 53, 22].includes(port) ? 'medium' : 'low',
                            time: res.time ?? null,
                        }
                    })
                }
            }

            const openPortRows = []
            const checked = await runWithConcurrency(tasks, cfg.concurrency, (completed, total) => {
                const p = 50 + Math.round((completed / Math.max(total, 1)) * 42)
                setProgress(clamp(p, 50, 92))
            })
            for (const row of checked) if (row) openPortRows.push(row)

            pushActivity(`Service sweep completed: ${openPortRows.length} open service hits`, openPortRows.length ? 'warn' : 'ok')
            setStepState(prev => ({ ...prev, services: 'done', analysis: 'running' }))
            setProgress(94)

            const findings = buildFindings({ devices: discoveredHosts, gateway, openPorts: openPortRows, upnp: upnpIntel, profileId: profile })
            const riskScore = scoreFromFindings(findings, openPortRows.length)
            const riskBand = getRiskBand(riskScore)
            const finishedAt = Date.now()

            const reportPayload = {
                profile,
                generatedAt: new Date().toISOString(),
                range: `${safeBase}.${start}-${end}`,
                gateway,
                devices: discoveredHosts,
                upnp: upnpIntel,
                openPorts: openPortRows,
                findings,
                summary: {
                    riskScore,
                    riskBand,
                    devicesTotal: discoveredHosts.length,
                    targetsScanned: targetHosts.length,
                    openServices: openPortRows.length,
                    upnpResponders: upnpIntel?.summary?.ssdpResponders || 0,
                    durationMs: Math.max(0, finishedAt - scanStarted),
                },
            }

            setReport(reportPayload)
            setProgress(100)
            setStepState(prev => ({ ...prev, analysis: 'done' }))
            setRunning(false)
            setScanFinishedAt(finishedAt)
            setStage('report')
            pushActivity(`Analysis completed: risk ${riskBand.label} (${riskScore}/100)`, riskScore >= 51 ? 'warn' : 'ok')

            const savedRows = await bridge.lanCheckHistoryAdd({ report: reportPayload }).catch(() => null)
            if (Array.isArray(savedRows)) {
                setHistoryRows(normalizeHistoryRows(savedRows))
            } else {
                await loadHistory()
            }
        } catch (error) {
            setRunning(false)
            setInputError(error?.message || 'LAN security scan failed unexpectedly')
            setStage('setup')
            pushActivity(`Scan failed: ${error?.message || 'unexpected error'}`, 'error')
        }
    }

    const progressRingStyle = useMemo(() => ({
        background: `conic-gradient(var(--color-accent) ${progress * 3.6}deg, color-mix(in srgb, var(--color-accent) 16%, transparent) 0deg)`,
    }), [progress])

    const recentHistory = historyRows.slice(0, 4)

    const stageChips = [
        { id: 'setup', label: 'Setup', icon: Sparkles, disabled: running },
        { id: 'scan', label: 'Scanning', icon: Radar, disabled: !running },
        { id: 'report', label: 'Report', icon: ShieldCheck, disabled: !report },
        { id: 'history', label: 'History', icon: History, disabled: false },
    ]

    return (
        <div className="v3-page-layout lchk-page page-enter">
            <div className="v3-page-header lchk-header">
                <div>
                    <h1 className="v3-page-title"><ShieldCheck size={24} color="var(--color-accent)" /> LAN Check</h1>
                    <p className="v3-page-subtitle">LAN security in 3 phases: setup, execution and report with persistent history.</p>
                </div>
                <div className="lchk-header-actions">
                    <button className="v3-btn v3-btn-secondary" onClick={startNewScanFlow} disabled={running}>
                        <RefreshCw size={14} />
                        New Scan
                    </button>
                    <button className="v3-btn v3-btn-secondary" onClick={() => setStage('history')}>
                        <History size={14} />
                        History
                    </button>
                    <button className="v3-btn v3-btn-primary" onClick={startLanSecurityScan} disabled={running || stage !== 'setup'}>
                        {running ? <Loader2 size={14} className="spin-icon" /> : <Play size={14} />}
                        {running ? 'Scanning...' : 'Start Scan'}
                    </button>
                </div>
            </div>

            <div className="lchk-stage-strip">
                {stageChips.map(item => {
                    const Icon = item.icon
                    const active = stage === item.id
                    return (
                        <button
                            key={item.id}
                            className={`lchk-stage-chip ${active ? 'active' : ''}`}
                            disabled={item.disabled}
                            onClick={() => setStage(item.id)}
                        >
                            <Icon size={14} />
                            {item.label}
                        </button>
                    )
                })}
            </div>

            <AnimatePresence mode="wait">
                {stage === 'setup' && (
                    <motion.section key="setup-screen" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="lchk-screen lchk-setup-screen">
                        <div className="v3-card lchk-setup-card">
                            <div className="v3-card-header">
                                <div className="v3-card-title"><Sparkles size={16} color="var(--color-accent)" /> Scan Blueprint</div>
                            </div>
                            <div className="lchk-profile-grid">
                                {Object.entries(PROFILE_PRESETS).map(([key, value]) => (
                                    <button key={key} className={`lchk-profile ${profile === key ? 'active' : ''}`} onClick={() => setProfile(key)} disabled={running}>
                                        <div className="lchk-profile-head">{value.title}</div>
                                        <p>{value.description}</p>
                                        <span>{value.ports.length} ports - up to {value.hostLimit} hosts</span>
                                    </button>
                                ))}
                            </div>

                            <div className="lchk-range-row">
                                <label className="lchk-label">Subnet Scope</label>
                                <div className="lchk-range-inputs">
                                    <input className="v3-input mono" value={baseIP} onChange={e => setBaseIP(e.target.value)} disabled={running} />
                                    <span className="lchk-dot">.</span>
                                    <input className="v3-input mono" type="number" min={1} max={254} value={rangeStart} onChange={e => setRangeStart(Number(e.target.value))} disabled={running} />
                                    <span className="lchk-dot">-</span>
                                    <input className="v3-input mono" type="number" min={1} max={254} value={rangeEnd} onChange={e => setRangeEnd(Number(e.target.value))} disabled={running} />
                                </div>
                            </div>

                            {inputError && (
                                <div className="lchk-inline-alert">
                                    <AlertTriangle size={14} />
                                    {inputError}
                                </div>
                            )}

                            <div className="lchk-scope-meta">
                                <span><Search size={13} /> Ports in profile: {preset.ports.length}</span>
                                <span><Router size={13} /> Max hosts inspected: {preset.hostLimit}</span>
                                <span><Clock3 size={13} /> Concurrency: {preset.concurrency}</span>
                            </div>
                        </div>

                        <div className="v3-card lchk-plan-card">
                            <div className="v3-card-header">
                                <div className="v3-card-title"><Radar size={16} color="var(--color-accent)" /> Execution Plan</div>
                            </div>
                            <div className="lchk-step-strip">
                                {STEP_KEYS.map(step => <StepPill key={step.id} step={step} status="idle" />)}
                            </div>
                            <div className="lchk-plan-metrics">
                                <div className="lchk-kpi"><span>Profile</span><strong>{preset.title}</strong></div>
                                <div className="lchk-kpi"><span>Scope</span><strong className="mono">{baseIP}.{rangeStart}-{rangeEnd}</strong></div>
                                <div className="lchk-kpi"><span>History</span><strong>{historyRows.length} reports</strong></div>
                            </div>
                            <button className="v3-btn v3-btn-primary lchk-main-btn" onClick={startLanSecurityScan} disabled={running}>
                                <Play size={15} />
                                Execute LAN Check
                            </button>
                        </div>
                        <div className="v3-card lchk-recent-card">
                            <div className="v3-card-header">
                                <div className="v3-card-title"><History size={16} color="var(--color-accent)" /> Recent Reports</div>
                                <button className="v3-btn v3-btn-secondary" onClick={() => setStage('history')}>View all</button>
                            </div>
                            {!recentHistory.length ? (
                                <div className="lchk-empty-box">
                                    <Info size={14} />
                                    No LAN reports saved yet.
                                </div>
                            ) : (
                                <div className="lchk-recent-list">
                                    {recentHistory.map(item => {
                                        const band = getRiskBand(item.riskScore)
                                        return (
                                            <button key={item.id} className="lchk-recent-item" onClick={() => openHistoryReport(item)}>
                                                <div>
                                                    <strong>{String(item.profile || '').toUpperCase()} - {item.scope}</strong>
                                                    <p>{formatDateTime(item.timestamp)}</p>
                                                </div>
                                                <span className="lchk-risk-pill" style={{ color: band.color }}>{band.label} {item.riskScore}</span>
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </motion.section>
                )}

                {stage === 'scan' && (
                    <motion.section key="scan-screen" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="lchk-screen lchk-scan-screen">
                        <div className="v3-card lchk-live-card">
                            <div className="lchk-live-top">
                                <div className="lchk-progress-ring" style={progressRingStyle}>
                                    <div className="lchk-progress-center">
                                        <strong>{progress}%</strong>
                                        <span>{running ? 'In progress' : 'Completed'}</span>
                                    </div>
                                </div>
                                <div className="lchk-live-kpi">
                                    <div className="lchk-kpi"><span>Discovered</span><strong>{discovered.length}</strong></div>
                                    <div className="lchk-kpi"><span>Profile</span><strong>{PROFILE_PRESETS[profile].title}</strong></div>
                                    <div className="lchk-kpi"><span>Range</span><strong className="mono">{baseIP}.{rangeStart}-{rangeEnd}</strong></div>
                                </div>
                            </div>

                            <div className="lchk-step-strip">
                                {STEP_KEYS.map(step => <StepPill key={step.id} step={step} status={stepState[step.id]} />)}
                            </div>

                            <div className="lchk-activity-list">
                                <AnimatePresence initial={false}>
                                    {activity.length === 0 ? (
                                        <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="lchk-activity-empty">
                                            <Info size={14} />
                                            Activity feed will appear during scan execution.
                                        </motion.div>
                                    ) : activity.map(item => (
                                        <motion.div key={item.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`lchk-activity-item ${item.tone}`}>
                                            <span className="mono">{new Date(item.at).toLocaleTimeString()}</span>
                                            <p>{item.message}</p>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        </div>

                        <div className="v3-card lchk-scan-assets">
                            <div className="v3-card-header">
                                <div className="v3-card-title"><House size={16} color="var(--color-accent)" /> Discovered Hosts</div>
                                <span className="v3-badge accent">{discovered.length} detected</span>
                            </div>
                            {!discovered.length ? (
                                <div className="lchk-empty-box">
                                    <Loader2 size={14} className="spin-icon" />
                                    Discovering hosts in selected subnet...
                                </div>
                            ) : (
                                <div className="lchk-assets-list">
                                    {discovered.slice(0, 30).map(device => (
                                        <div key={device.ip} className="lchk-asset-row">
                                            <div>
                                                <strong>{device.displayName || device.hostname || device.vendor || 'Unknown device'}</strong>
                                                <p className="mono">{device.ip}{device.mac ? ` - ${device.mac}` : ''}</p>
                                            </div>
                                            <div className="lchk-asset-tags">
                                                {device.isGateway && <span className="lchk-role-chip"><Router size={11} /> GW</span>}
                                                {device.isLocal && <span className="lchk-role-chip"><Shield size={11} /> You</span>}
                                                {device.isRandomized && <span className="lchk-sev-chip info">RND</span>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.section>
                )}

                {stage === 'report' && (
                    <motion.section key="report-screen" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="lchk-screen lchk-report-screen">
                        {!report ? (
                            <div className="v3-card lchk-empty-report">
                                <Info size={16} />
                                <p>No report loaded. Run a scan or open one from History.</p>
                                <div className="lchk-empty-actions">
                                    <button className="v3-btn v3-btn-primary" onClick={() => setStage('setup')}>Go to Setup</button>
                                    <button className="v3-btn v3-btn-secondary" onClick={() => setStage('history')}>Open History</button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="lchk-report-actions">
                                    <button className="v3-btn v3-btn-secondary" onClick={() => setStage('setup')}>
                                        <Play size={14} />
                                        Scan Again
                                    </button>
                                    <button className="v3-btn v3-btn-secondary" onClick={() => setStage('history')}>
                                        <History size={14} />
                                        Open History
                                    </button>
                                    <button className="v3-btn v3-btn-secondary" onClick={() => copyReportJson(report)}>
                                        <Copy size={14} />
                                        Copy JSON
                                    </button>
                                </div>

                                <div className="lchk-summary-grid">
                                    <div className="v3-card lchk-summary-risk">
                                        <div className="v3-label-sm"><ShieldAlert size={12} /> Overall Risk</div>
                                        <div className="lchk-risk-main">
                                            <strong>{report.summary.riskScore}</strong>
                                            <span style={{ color: report.summary.riskBand.color }}>{report.summary.riskBand.label}</span>
                                        </div>
                                        <p className="lchk-summary-meta">{report.findings.length} findings in selected LAN scope.</p>
                                    </div>
                                    <div className="v3-card lchk-summary-card">
                                        <div className="v3-label-sm"><Globe size={12} /> Hosts</div>
                                        <strong>{report.summary.devicesTotal}</strong>
                                        <span className="lchk-summary-sub">Total discovered hosts</span>
                                        <span className="lchk-summary-meta">Actively fingerprinted: {report.summary.targetsScanned}</span>
                                    </div>
                                    <div className="v3-card lchk-summary-card">
                                        <div className="v3-label-sm"><Database size={12} /> Open Services</div>
                                        <strong>{report.summary.openServices}</strong>
                                        <span className="lchk-summary-sub">Reachable services found</span>
                                        <span className="lchk-summary-meta">SSDP responders: {report.summary.upnpResponders}</span>
                                    </div>
                                    <div className="v3-card lchk-summary-card">
                                        <div className="v3-label-sm"><Clock3 size={12} /> Duration</div>
                                        <strong>{formatDuration((scanFinishedAt || Date.now()) - (scanStartedAt || Date.now()))}</strong>
                                        <span className="lchk-summary-sub">Total scan runtime</span>
                                        <span className="mono lchk-summary-meta">Scope: {report.range}</span>
                                    </div>
                                </div>
                                <div className="v3-card lchk-findings-card">
                                    <div className="v3-card-header">
                                        <div className="v3-card-title"><Shield size={16} color="var(--color-accent)" /> Findings</div>
                                        <div className="lchk-severity-counters">
                                            {Object.entries(severityCounts).map(([level, count]) => (
                                                <span key={level} className={`lchk-sev-chip ${level}`}>{level} {count}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="lchk-findings-list">
                                        {report.findings.map(item => {
                                            const ItemIcon = SEVERITY_META[item.severity]?.icon || Info
                                            return (
                                                <div key={item.id} className={`lchk-finding ${item.severity}`}>
                                                    <div className="lchk-finding-head">
                                                        <span className="lchk-finding-severity"><ItemIcon size={13} /> {item.severity}</span>
                                                        <strong>{item.title}</strong>
                                                    </div>
                                                    <p>{item.evidence}</p>
                                                    <div className="lchk-finding-rec">{item.recommendation}</div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>

                                <div className="v3-card lchk-open-ports-card">
                                    <div className="v3-card-header">
                                        <div className="v3-card-title"><Fingerprint size={16} color="var(--color-accent)" /> Open Service Evidence</div>
                                        <span className="v3-badge accent">{openRows.length} total</span>
                                    </div>
                                    {!openRows.length ? (
                                        <div className="lchk-no-open">
                                            <CheckCircle2 size={16} color="var(--color-success)" />
                                            No open service evidence found in selected profile scope.
                                        </div>
                                    ) : (
                                        <>
                                            <div className="lchk-table-wrap">
                                                <table className="np-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Host</th>
                                                            <th>Port</th>
                                                            <th>Service</th>
                                                            <th>Role</th>
                                                            <th>Severity</th>
                                                            <th>RTT</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {pagedRows.map((row, idx) => (
                                                            <tr key={`${row.ip}-${row.port}-${idx}`}>
                                                                <td className="mono">{row.ip}</td>
                                                                <td className="mono">{row.port}</td>
                                                                <td>{row.service}</td>
                                                                <td>{row.isGateway ? <span className="lchk-role-chip"><Router size={11} /> Gateway</span> : row.displayName}</td>
                                                                <td><span className={`lchk-sev-chip ${row.severity}`}>{row.severity}</span></td>
                                                                <td className="mono">{row.time != null ? `${row.time}ms` : '-'}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <div className="lchk-pagination">
                                                <button className="v3-btn v3-btn-secondary" onClick={() => setReportPage(v => Math.max(1, v - 1))} disabled={reportPage <= 1}>
                                                    <ChevronLeft size={13} />
                                                    Prev
                                                </button>
                                                <span className="mono">Page {reportPage} / {totalPages}</span>
                                                <button className="v3-btn v3-btn-secondary" onClick={() => setReportPage(v => Math.min(totalPages, v + 1))} disabled={reportPage >= totalPages}>
                                                    Next
                                                    <ChevronRight size={13} />
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className="lchk-bottom-grid">
                                    <div className="v3-card lchk-upnp-card">
                                        <div className="v3-card-header">
                                            <div className="v3-card-title"><Wifi size={16} color="var(--color-accent)" /> UPnP / SSDP Intel</div>
                                            <span className="v3-badge info">{report.upnp?.summary?.ssdpResponders || 0} responders</span>
                                        </div>
                                        {!(report.upnp?.devices || []).length ? (
                                            <div className="lchk-no-open">
                                                <ShieldCheck size={15} color="var(--color-success)" />
                                                No SSDP responders were discovered in selected subnet scope.
                                            </div>
                                        ) : (
                                            <div className="lchk-upnp-list">
                                                {report.upnp.devices.slice(0, 12).map(item => (
                                                    <div key={`${item.ip}-${item.usn || item.st || 'ssdp'}`} className="lchk-upnp-row">
                                                        <div>
                                                            <strong className="mono">{item.ip}</strong>
                                                            <p>{item.friendlyName || item.modelName || item.server || 'SSDP responder'}</p>
                                                        </div>
                                                        <div className="lchk-upnp-tags">
                                                            {item.isIgd && <span className="lchk-sev-chip high">IGD</span>}
                                                            {item.isRootDevice && <span className="lchk-sev-chip medium">rootdevice</span>}
                                                            {item.manufacturer && <span className="lchk-sev-chip info">{item.manufacturer}</span>}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="v3-card lchk-assets-card">
                                        <div className="v3-card-header">
                                            <div className="v3-card-title"><House size={16} color="var(--color-accent)" /> Asset Snapshot</div>
                                            <span className="v3-badge accent">{report.devices.length} hosts</span>
                                        </div>
                                        <div className="lchk-assets-list">
                                            {report.devices.slice(0, 20).map(device => (
                                                <div key={device.ip} className="lchk-asset-row">
                                                    <div>
                                                        <strong>{device.displayName || device.hostname || device.vendor || 'Unknown device'}</strong>
                                                        <p className="mono">{device.ip}{device.mac ? ` - ${device.mac}` : ''}</p>
                                                    </div>
                                                    <div className="lchk-asset-tags">
                                                        {device.isGateway && <span className="lchk-role-chip"><Router size={11} /> GW</span>}
                                                        {device.isLocal && <span className="lchk-role-chip"><Shield size={11} /> You</span>}
                                                        {device.isRandomized && <span className="lchk-sev-chip info">RND</span>}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </motion.section>
                )}

                {stage === 'history' && (
                    <motion.section key="history-screen" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="lchk-screen lchk-history-screen">
                        <div className="v3-card lchk-history-card">
                            <div className="v3-card-header">
                                <div className="v3-card-title"><History size={16} color="var(--color-accent)" /> Report History</div>
                                <div className="lchk-history-actions">
                                    <button className="v3-btn v3-btn-secondary" onClick={loadHistory} disabled={historyLoading}>
                                        <RefreshCw size={14} className={historyLoading ? 'spin-icon' : ''} />
                                        Refresh
                                    </button>
                                    <button className="v3-btn v3-btn-secondary lchk-danger-btn" onClick={clearHistoryEntries} disabled={!historyRows.length || historyLoading}>
                                        <Trash2 size={14} />
                                        Clear All
                                    </button>
                                </div>
                            </div>

                            <div className="lchk-history-filter">
                                <Search size={14} />
                                <input className="v3-input" placeholder="Search by scope, profile or risk..." value={historyQuery} onChange={e => setHistoryQuery(e.target.value)} />
                            </div>

                            {historyLoading ? (
                                <div className="lchk-empty-box">
                                    <Loader2 size={14} className="spin-icon" />
                                    Loading report history...
                                </div>
                            ) : !filteredHistory.length ? (
                                <div className="lchk-empty-box">
                                    <Info size={14} />
                                    No reports found with current filters.
                                </div>
                            ) : (
                                <div className="lchk-history-list">
                                    {filteredHistory.map(item => {
                                        const band = getRiskBand(item.riskScore)
                                        const profileLabel = PROFILE_PRESETS[item.profile]?.title || String(item.profile || '').toUpperCase()
                                        return (
                                            <div key={item.id} className="lchk-history-item">
                                                <div className="lchk-history-main">
                                                    <div>
                                                        <strong>{profileLabel} - {item.scope}</strong>
                                                        <p>{formatDateTime(item.timestamp)}</p>
                                                    </div>
                                                    <div className="lchk-history-badges">
                                                        <span className="lchk-risk-pill" style={{ color: band.color }}>{band.label} {item.riskScore}</span>
                                                        <span className="lchk-role-chip">{item.findings} findings</span>
                                                        <span className="lchk-role-chip">{item.openPorts} open services</span>
                                                    </div>
                                                </div>
                                                <div className="lchk-history-ops">
                                                    <button className="v3-btn v3-btn-secondary" onClick={() => openHistoryReport(item)}>Open</button>
                                                    <button className="v3-btn v3-btn-secondary" onClick={() => copyReportJson(item.report)}>
                                                        <Copy size={13} />
                                                        Copy
                                                    </button>
                                                    <button className="v3-btn v3-btn-secondary lchk-danger-btn" onClick={() => deleteHistoryEntry(item.id)}>
                                                        <Trash2 size={13} />
                                                        Delete
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </motion.section>
                )}
            </AnimatePresence>
        </div>
    )
}
