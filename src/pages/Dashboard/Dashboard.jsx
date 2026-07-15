import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
    Wifi, Globe, Shield, CheckCircle2, AlertTriangle, XCircle,
    Loader2, Radar, Gauge, Stethoscope, Wrench, ArrowRight,
    TrendingUp, Zap, Router, Signal, Clock, Server, Activity, WifiOff, Network,
    Eye, EyeOff
} from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer, Tooltip, YAxis, ReferenceLine } from 'recharts'
import { useNavigate } from 'react-router-dom'
import bridge from '../../lib/electronBridge'
import useNetworkStatus from '../../lib/useNetworkStatus.jsx'
import { canProbeGateway } from '../../lib/gatewayProbe'
import { DEFAULT_POLL_INTERVAL_SECONDS, normalizePollIntervalMs } from '../../lib/polling.js'
import { measureProbeRound } from '../../lib/probeRound.js'
import { persistPublicIpVisible, readPublicIpVisible } from '../../lib/publicIpPrivacy.js'
import useAppVisibility from '../../lib/useAppVisibility.js'
import DashboardSkeleton from './DashboardSkeleton.jsx'
import { appendDashboardChartSample } from './presentationSeries.js'
import './Dashboard.css'

const MAX_PTS = 30
const HOSTS = ['1.1.1.1', '8.8.8.8', 'google.com']
const HOST_LABELS = { '1.1.1.1': 'Cloudflare', '8.8.8.8': 'Google DNS', 'google.com': 'Google' }
const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b']

/* WiFi generation badge colors */
const GEN_COLORS = { 7: '#a855f7', 6: '#3b82f6', 5: '#10b981', 4: '#f59e0b' }

const healthConfig = {
    good:    { Icon: CheckCircle2,  label: 'Excellent',   sub: 'Low latency - stable connection',   pill: 'Connected' },
    warning: { Icon: AlertTriangle, label: 'Degraded',    sub: 'Elevated latency detected',        pill: 'Degraded' },
    bad:     { Icon: AlertTriangle, label: 'Poor',        sub: 'High latency or packet loss',      pill: 'Poor' },
    offline: { Icon: XCircle,       label: 'Offline',     sub: 'No active local network link',      pill: 'Disconnected' },
    unknown: { Icon: AlertTriangle, label: 'Unverified',  sub: 'External probes did not reply; ICMP may be blocked', pill: 'Check' },
    loading: { Icon: Loader2,       label: 'Detecting...', sub: 'Verifying internet reachability', pill: 'Checking' },
}

/* Session-only telemetry persists across navigation, but never across networks. */
const _pingCacheByEpoch = new Map()
const _signalHistoryByUnderlay = new Map()
const MAX_CACHED_NETWORK_KEYS = 4
const MAX_SIGNAL_PTS = 60

function normalizedEpoch(value) {
    const epoch = Number(value)
    return Number.isInteger(epoch) && epoch >= 0 ? epoch : 0
}

function normalizedUnderlayIdentity(value, routeEpoch) {
    const identity = typeof value === 'string' ? value.trim() : ''
    // Old/mock snapshots may not expose an underlay identity. Keeping the
    // former route-epoch behaviour in that compatibility case is safer than
    // allowing unrelated physical links to share one anonymous history.
    return identity || `route:${routeEpoch}`
}

function emptyPingState() {
    return {
        pingData: Object.fromEntries(HOSTS.map(host => [host, []])),
        pingLatest: {},
        gwPing: null,
        gwPingState: 'idle',
    }
}

function boundedSet(map, key, value) {
    map.delete(key)
    map.set(key, value)
    while (map.size > MAX_CACHED_NETWORK_KEYS) map.delete(map.keys().next().value)
}

function cachedPingState(epoch) {
    return _pingCacheByEpoch.get(epoch) || emptyPingState()
}

/** Convert "76%" to approximate dBm */
function pctToDbm(sig) {
    if (!sig) return null
    const n = parseInt(sig)
    if (isNaN(n)) return null
    return Math.round((n / 2) - 100)
}

function StatTile({ icon, label, value, sub, accent }) {
    const [copied, setCopied] = useState(false)
    function handleCopy() {
        if (!value) return
        navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
        })
    }
    return (
        <div className="stat-tile">
            <div className="stat-tile-icon" style={accent ? { background: `${accent}15`, color: accent } : {}}>
                {icon}
            </div>
            <div className="stat-tile-body">
                <div className="stat-tile-label">{label}</div>
                <div className={`stat-tile-value mono${value ? ' copyable' : ''}`} onClick={handleCopy} title={value ? 'Click to copy' : ''}>
                    <span className="stat-copy-text">{value || '-'}</span>
                    {copied && <span className="copied-flash">Copied!</span>}
                </div>
                <div className="stat-tile-sub">{sub || '\u00A0'}</div>
            </div>
        </div>
    )
}

export default function Dashboard() {
    const navigate = useNavigate()
    const net = useNetworkStatus()
    const appVisible = useAppVisibility()
    const networkEpoch = normalizedEpoch(net.networkEpoch)
    const underlayIdentityKey = normalizedUnderlayIdentity(net.underlayIdentityKey, networkEpoch)
    const dashRef = useRef(null)
    const [pingData, setPingData] = useState(() => cachedPingState(networkEpoch).pingData)
    const [pingLatest, setPingLatest] = useState(() => cachedPingState(networkEpoch).pingLatest)
    const [gwPing, setGwPing] = useState(() => cachedPingState(networkEpoch).gwPing)
    const [gwPingState, setGwPingState] = useState(() => cachedPingState(networkEpoch).gwPingState)
    // Never claim an excellent Internet path before the first external probe.
    // The core snapshot establishes the local link; probe results establish health.
    const [health, setHealth] = useState('loading')
    const [signalPts, setSignalPts] = useState(() => [...(_signalHistoryByUnderlay.get(underlayIdentityKey) || [])])
    const [copiedLocalIP, setCopiedLocalIP] = useState(false)
    const [copiedIP, setCopiedIP] = useState(false)
    const [showPublicIP, setShowPublicIP] = useState(readPublicIpVisible)
    const [showExtraDeviceInfo, setShowExtraDeviceInfo] = useState(false)
    const stateRef = useRef({})
    const networkEpochRef = useRef(networkEpoch)
    const underlayIdentityRef = useRef(underlayIdentityKey)
    const probeGenerationRef = useRef(0)
    const samplingVisibleRef = useRef(appVisible)
    const pingTimerRef = useRef(null)
    const [ready, setReady] = useState(!net.loading)
    const [pollMs, setPollMs] = useState(DEFAULT_POLL_INTERVAL_SECONDS * 1000)
    const [latencyThr, setLatencyThr] = useState(150)

    // Load poll interval & latency threshold from config
    useEffect(() => {
        bridge.configGetPublic(['pollInterval', 'latencyThreshold', 'publicIpVisible']).then(cfg => {
            if (!cfg) return
            setPollMs(normalizePollIntervalMs(cfg.pollInterval))
            if (cfg.publicIpVisible !== undefined) {
                const visible = cfg.publicIpVisible === true
                setShowPublicIP(visible)
                persistPublicIpVisible(visible)
            }
            if (cfg.latencyThreshold) {
                const v = Number(cfg.latencyThreshold)
                if (v > 0) setLatencyThr(v)
            }
        }).catch(() => {})

        const off = bridge.onConfigChanged?.(({ key, value, deleted }) => {
            if (key === 'pollInterval') {
                setPollMs(deleted ? DEFAULT_POLL_INTERVAL_SECONDS * 1000 : normalizePollIntervalMs(value))
            }
            if (key === 'publicIpVisible') {
                const visible = !deleted && value === true
                setShowPublicIP(visible)
                persistPublicIpVisible(visible)
            }
            if (key === 'latencyThreshold') {
                const v = deleted ? 150 : Number(value)
                if (v > 0) setLatencyThr(v)
            }
        })
        return () => off?.()
    }, [])

    // Mark ready once loading finishes
    useEffect(() => {
        if (!net.loading && !ready) setReady(true)
    }, [net.loading, ready])

    const shouldProbeGateway = canProbeGateway(net)

    useEffect(() => {
        const previous = stateRef.current
        if (Number.isInteger(previous.epoch) && previous.epoch !== networkEpoch) {
            boundedSet(_pingCacheByEpoch, previous.epoch, {
                pingData: previous.pingData,
                pingLatest: previous.pingLatest,
                gwPing: previous.gwPing,
                gwPingState: previous.gwPingState,
            })
        }

        networkEpochRef.current = networkEpoch
        probeGenerationRef.current += 1
        const cached = cachedPingState(networkEpoch)
        setPingData(cached.pingData)
        setPingLatest(cached.pingLatest)
        setGwPing(cached.gwPing)
        setGwPingState(cached.gwPingState)
        setHealth('loading')
        stateRef.current = { epoch: networkEpoch, ...cached }
    }, [networkEpoch])

    // Wi-Fi signal belongs to the physical underlay, not to the active route.
    // A VPN route epoch therefore keeps the existing series, while a genuine
    // Wi-Fi/Ethernet switch selects a separate bounded history.
    useEffect(() => {
        underlayIdentityRef.current = underlayIdentityKey
        setSignalPts([...(_signalHistoryByUnderlay.get(underlayIdentityKey) || [])])
    }, [underlayIdentityKey])

    useEffect(() => {
        probeGenerationRef.current += 1
        if (net.transitioning) return
        if (net.isVpn) {
            setGwPing(null)
            setGwPingState('vpn')
        } else if (!net.gateway || !net.connected) {
            setGwPing(null)
            setGwPingState('unavailable')
        } else setGwPingState('probing')
    }, [net.connected, net.gateway, net.isVpn, net.transitioning, networkEpoch])

    // Keep stateRef in sync for caching on unmount
    useEffect(() => {
        stateRef.current = { epoch: networkEpoch, pingData, pingLatest, gwPing, gwPingState }
    })

    useEffect(() => () => {
        const current = stateRef.current
        if (!Number.isInteger(current.epoch)) return
        boundedSet(_pingCacheByEpoch, current.epoch, {
            pingData: current.pingData,
            pingLatest: current.pingLatest,
            gwPing: current.gwPing,
            gwPingState: current.gwPingState,
        })
    }, [])

    // Update health when connection state changes
    useEffect(() => {
        if (net.loading) { setHealth('loading'); return }
        if (!net.connected) { setHealth('offline'); return }
        setHealth(current => current === 'offline' ? 'loading' : current)
    }, [net.loading, net.connected])

    // A time series needs samples even when the value is unchanged: repeated
    // values are what make a stable signal visible instead of an empty chart.
    useEffect(() => {
        if (!appVisible) return undefined
        const identity = underlayIdentityKey
        const sampleSignal = () => {
            if (!samplingVisibleRef.current || underlayIdentityRef.current !== identity) return
            const dbm = pctToDbm(net.wifi?.signal)
            if (dbm == null) return
            const next = appendDashboardChartSample(
                _signalHistoryByUnderlay.get(identity) || [],
                { t: Date.now(), dbm },
                { valueKey: 'dbm', maxPoints: MAX_SIGNAL_PTS },
            )
            boundedSet(_signalHistoryByUnderlay, identity, next)
            setSignalPts(next)
        }
        sampleSignal()
        const timer = setInterval(sampleSignal, pollMs)
        return () => clearInterval(timer)
    }, [appVisible, net.wifi?.signal, underlayIdentityKey, pollMs])

    // Every configured tick is one coherent round. All external targets and
    // the gateway start together, then publish atomically with one timestamp.
    const doPingRound = useCallback(async () => {
        if (!samplingVisibleRef.current || net.loading || net.transitioning || !net.connected) return
        const generation = probeGenerationRef.current
        const roundEpoch = networkEpoch
        const round = await measureProbeRound({
            externalTargets: HOSTS,
            gateway: net.gateway,
            includeGateway: shouldProbeGateway,
            ping: target => bridge.pingSingle(target),
        })
        if (
            generation !== probeGenerationRef.current
            || roundEpoch !== networkEpochRef.current
            || !samplingVisibleRef.current
        ) return

        if (round.gatewayMeasured) {
            setGwPing(round.gateway)
            setGwPingState(round.gateway == null ? 'unreachable' : 'ok')
        } else {
            setGwPing(null)
            setGwPingState(net.isVpn ? 'vpn' : 'unavailable')
        }

        setPingLatest(round.external)
        setPingData(previous => ({
            ...Object.fromEntries(HOSTS.map(target => [
                target,
                appendDashboardChartSample(
                    previous[target] || [],
                    { t: round.sampledAt, ms: round.external[target] },
                    { valueKey: 'ms', maxPoints: MAX_PTS },
                ),
            ])),
        }))

        const values = Object.values(round.external).filter(Number.isFinite)
        if (!values.length) setHealth('unknown')
        else {
            const avg = values.reduce((sum, current) => sum + current, 0) / values.length
            const warnAt = latencyThr * 0.4
            setHealth(avg < warnAt ? 'good' : avg < latencyThr ? 'warning' : 'bad')
        }
    }, [net.connected, net.gateway, net.isVpn, net.loading, net.transitioning, networkEpoch, shouldProbeGateway, latencyThr])

    const startPingLoop = useCallback(() => {
        if (pingTimerRef.current) clearTimeout(pingTimerRef.current)
        let stopped = false
        const tick = async () => {
            await doPingRound()
            if (!stopped) pingTimerRef.current = setTimeout(tick, pollMs)
        }
        // Defer the first tick by one task so React Strict Mode can discard its
        // probe effect without starting a duplicate real round in development.
        pingTimerRef.current = setTimeout(tick, 0)
        return () => { stopped = true }
    }, [doPingRound, pollMs])

    useEffect(() => {
        samplingVisibleRef.current = appVisible
        probeGenerationRef.current += 1
        if (!appVisible) {
            if (pingTimerRef.current) clearTimeout(pingTimerRef.current)
            pingTimerRef.current = null
            return undefined
        }
        const stopLoop = startPingLoop()
        return () => {
            stopLoop?.()
            clearTimeout(pingTimerRef.current)
            pingTimerRef.current = null
        }
    }, [appVisible, startPingLoop])

    const hc = healthConfig[health]
    const networkUpdating = net.transitioning === true && net.transitionStatus !== 'degraded'
    const networkDegraded = net.transitionStatus === 'degraded'
        || (net.presentationStale === true && net.transitioning !== true)
    const networkStateMessage = networkDegraded ? 'Network data unavailable' : 'Updating network...'
    const tunnelDataTrusted = !networkUpdating
        && !networkDegraded
        && net.overlay?.authoritative !== false
    const linkType = net.linkType || (net.wifi?.ssid ? 'wifi' : (net.connected ? 'other' : 'other'))
    const isWifiLink = linkType === 'wifi'
    const linkLabel = linkType === 'ethernet' ? 'Ethernet' : (isWifiLink ? 'Wi-Fi' : 'Network')
    const signalDbm = pctToDbm(net.wifi?.signal)
    const bannerBaseLabel = isWifiLink && net.wifi?.ssid
        ? `${net.wifi.ssid} (${net.wifi.signal || '-'})`
        : (net.connected ? `${linkLabel}${net.ifaceName ? ` - ${net.ifaceName}` : ''}` : 'No network connection')
    const bannerNetworkLabel = net.isVpn && !networkUpdating && !networkDegraded ? `${bannerBaseLabel} - VPN active` : bannerBaseLabel
    const bannerHint = networkUpdating || networkDegraded
        ? networkStateMessage
        : net.connected
        ? (net.isVpn ? 'VPN tunnel detected - gateway latency probe paused' : hc.sub)
        : 'Check your Wi-Fi/Ethernet adapter and link status'
    const vpnTunnelInterface = tunnelDataTrusted
        ? (net.overlay?.tunnel?.interfaceName || net.vpnStatus?.tunnel?.interfaceName || 'Unknown')
        : (networkDegraded ? 'Unavailable' : 'Updating...')
    const vpnTunnelLocalIp = tunnelDataTrusted
        ? (net.overlay?.tunnel?.localIp || net.vpnStatus?.tunnel?.localIp || '-')
        : '-'
    const gatewayPending = ['pending', 'loading'].includes(net.enrichmentStatus)

    const quickActions = [
        { icon: Radar,       label: 'Network Scan',  desc: 'Discover LAN devices',   path: '/scanner',     color: '#3b82f6' },
        { icon: Gauge,       label: 'Speed Test',    desc: 'Measure bandwidth',       path: '/speedtest',   color: '#8b5cf6' },
        { icon: Stethoscope, label: 'Diagnostics',   desc: 'Trace & diagnose',        path: '/diagnostics', color: '#10b981' },
        { icon: Wrench,      label: 'Tools',         desc: 'SSL, Whois & more',       path: '/tools',       color: '#f59e0b' },
    ]

    const avgLiveLatency = (() => {
        const values = Object.values(pingLatest).filter(v => Number.isFinite(v))
        if (!values.length) return null
        return Math.round(values.reduce((acc, cur) => acc + cur, 0) / values.length)
    })()

    const latencyYDomain = useMemo(() => {
        const values = HOSTS.flatMap(host =>
            (pingData[host] || [])
                .map(point => point?.ms)
                .filter(value => Number.isFinite(value) && value >= 0)
        )
        if (!values.length) return [0, 40]

        const sorted = [...values].sort((a, b) => a - b)
        const p95Index = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95)))
        const p95 = sorted[p95Index]
        const max = sorted[sorted.length - 1]

        // Keep global comparability but avoid one extreme outlier flattening everything.
        const cappedUpper = max > p95 * 3 ? (p95 * 1.4) : max
        const upper = Math.max(30, Math.ceil((cappedUpper + 5) / 5) * 5)
        return [0, upper]
    }, [pingData])

    const ipv6Address = net.interfaces?.find(item =>
        item?.family === 'IPv6'
        && !item?.internal
        && (!net.ifaceName || item?.name === net.ifaceName)
    )?.address || null

    const recomputeExtraDeviceInfo = useCallback(() => {
        const container = dashRef.current
        if (!container) return
        const overflow = container.scrollHeight > (container.clientHeight + 1)
        const slack = container.clientHeight - container.scrollHeight
        setShowExtraDeviceInfo(prev => {
            if (prev) return !overflow
            return !overflow && slack >= 180
        })
    }, [])

    useEffect(() => {
        const timer = setTimeout(() => recomputeExtraDeviceInfo(), 120)
        return () => clearTimeout(timer)
    }, [
        recomputeExtraDeviceInfo,
        net.loading,
        net.connected,
        net.isVpn,
        net.ifaceName,
        net.localIP,
        net.publicIP,
        net.gateway,
    ])

    useEffect(() => {
        const onResize = () => requestAnimationFrame(recomputeExtraDeviceInfo)
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [recomputeExtraDeviceInfo])

    // Show skeleton while initial data is loading
    if (!ready) return <DashboardSkeleton />

    return (
        <div className="dash dash-ready page-enter" ref={dashRef}>
            {/* Header */}
            <div className="dash-header">
                <div>
                    <h1 className="dash-title">Dashboard</h1>
                    <p className="dash-subtitle">
                        {net.sysInfo?.hostname || 'Network'} - {net.wifi?.ssid || net.ifaceName || 'Loading...'}
                    </p>
                </div>
                <span className={`status-pill ${networkDegraded ? 'warning' : (networkUpdating ? 'loading' : health)}`}>
                    <span className="status-dot" />
                    {networkDegraded ? 'Unavailable' : (networkUpdating ? 'Updating' : hc.pill)}
                </span>
            </div>

            {/* Status Banner */}
            <div className={`dash-banner ${health}`}>
                <div className="banner-left">
                    <div className="banner-icon">
                        <hc.Icon size={22} className={health === 'loading' ? 'spin-icon' : ''} />
                    </div>
                    <div>
                        <div className="banner-status">{networkUpdating || networkDegraded ? networkStateMessage : hc.label}</div>
                        <div className="banner-detail">
                            {bannerNetworkLabel}
                            {' - '}{bannerHint}
                        </div>
                    </div>
                </div>
                <div className="banner-right">
                    {networkUpdating || networkDegraded ? (
                        <div className="banner-ping">
                            <Loader2 size={18} className={networkUpdating ? 'spin-icon' : ''} />
                            <span className="ping-unit">{networkDegraded ? 'last coherent snapshot retained' : 'coherent refresh in progress'}</span>
                        </div>
                    ) : net.isVpn ? (
                        <div className="banner-ping">
                            <span className="ping-val mono">VPN</span>
                            <span className="ping-unit">gateway probe paused</span>
                        </div>
                    ) : gwPingState === 'probing' ? (
                        <Loader2 size={20} className="spin-icon" style={{ color: 'var(--text-muted)' }} />
                    ) : gwPing !== null ? (
                        <div className="banner-ping">
                            <span className="ping-val mono">{gwPing}</span>
                            <span className="ping-unit">ms gateway</span>
                        </div>
                    ) : (
                        <div className="banner-ping">
                            <span className="ping-val mono">--</span>
                            <span className="ping-unit">{net.gateway ? 'gateway unavailable' : (gatewayPending ? 'detecting gateway' : 'no gateway')}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Stats Row */}
            <div className="dash-stats">
                <div className="stat-tile">
                    <div className="stat-tile-icon" style={{ background: '#3b82f615', color: '#3b82f6' }}>
                        {net.isVpn ? <Shield size={18} /> : (linkType === 'ethernet' ? <Network size={18} /> : <Wifi size={18} />)}
                    </div>
                    <div className="stat-tile-body">
                        <div className="stat-tile-label">Local IP</div>
                        <div className={`stat-tile-value mono${net.localIP ? ' copyable' : ''}`}
                            onClick={() => {
                                if (!net.localIP) return
                                navigator.clipboard.writeText(net.localIP).then(() => {
                                    setCopiedLocalIP(true)
                                    setTimeout(() => setCopiedLocalIP(false), 1200)
                                })
                            }}
                            title={net.localIP ? 'Click to copy' : ''}>
                            <span className="stat-copy-text">{net.localIP || '\u2014'}</span>
                            {copiedLocalIP && <span className="copied-flash">Copied!</span>}
                        </div>
                        <div className="stat-tile-sub">{net.ifaceName || '\u00A0'}</div>
                    </div>
                </div>
                <div className="stat-tile">
                    <div className="stat-tile-icon" style={{ background: '#8b5cf615', color: '#8b5cf6' }}>
                        <Globe size={18} />
                    </div>
                    <div className="stat-tile-body">
                        <div className="stat-tile-label">Public IP</div>
                        {/*
                          IP value is rendered as plain text inside the
                          .stat-tile-value div \u2014 exactly the same
                          element type and structure as Local IP /
                          Gateway / DNS Server. Wrapping it in a
                          <button> previously created a 6-8px text-start
                          offset that no padding/margin/appearance
                          tweak could fully override on every browser
                          (user-agent button styling has intrinsic
                          inset metrics). Click-to-copy now happens at
                          the .stat-tile-value level via onClick. The
                          eye toggle is a sibling button \u2014 its
                          onClick stops propagation so toggling
                          visibility doesn't also trigger a copy.
                        */}
                        <div
                            className={`stat-tile-value mono ip-value-row${net.publicIP ? ' copyable' : ''}`}
                            onClick={() => {
                                if (!net.publicIP) return
                                navigator.clipboard.writeText(net.publicIP).then(() => {
                                    setCopiedIP(true)
                                    setTimeout(() => setCopiedIP(false), 1200)
                                })
                            }}
                            role={net.publicIP ? 'button' : undefined}
                            tabIndex={net.publicIP ? 0 : undefined}
                            onKeyDown={(e) => {
                                if (!net.publicIP) return
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    e.currentTarget.click()
                                }
                            }}
                            title={net.publicIP ? 'Click to copy' : ''}
                        >
                            <span className="ip-text">
                                {net.publicIP
                                    ? (showPublicIP ? net.publicIP : net.publicIP.replace(/./g, '\u2022'))
                                    : '\u2014'}
                            </span>
                            {copiedIP && <span className="copied-flash">Copied!</span>}
                            {net.publicIP && (
                                <button
                                    type="button"
                                    className="ip-eye-btn"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setShowPublicIP(current => {
                                            const visible = !current
                                            persistPublicIpVisible(visible)
                                            bridge.configSet('publicIpVisible', visible).catch(() => { /* noop */ })
                                            return visible
                                        })
                                    }}
                                    title={showPublicIP ? 'Hide IP' : 'Show IP'}
                                    aria-label={showPublicIP ? 'Hide public IP' : 'Show public IP'}
                                >
                                    {showPublicIP ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            )}
                        </div>
                        {/*
                          Geo line: prefer the ISO 3166-1 alpha-2 country
                          code (US, DR, ES…) over the full country name so
                          "Santo Domingo, DR" fits the tile without the
                          ellipsis truncation kicking in. Falls back to
                          the full name when the API didn't return a code
                          (older cached responses, unusual locations) so
                          we never drop the country entirely. The full
                          text is exposed via `title` so hover reveals it.
                        */}
                        {(() => {
                            const geo = net.geo
                            if (!geo) return <div className="stat-tile-sub">{'\u00A0'}</div>
                            const city = (geo.city || '').trim()
                            const code = (geo.countryCode || '').trim().toUpperCase()
                            const country = (geo.country || '').trim()
                            const shortLocale = code || country
                            const display = [city, shortLocale].filter(Boolean).join(', ')
                            const fullDisplay = [city, country].filter(Boolean).join(', ') || display
                            return (
                                <div
                                    className="stat-tile-sub"
                                    title={fullDisplay}
                                >
                                    {display || '\u00A0'}
                                </div>
                            )
                        })()}
                    </div>
                </div>
                <StatTile icon={<Router size={18} />} label="Gateway" value={net.gateway}
                    sub={networkUpdating || networkDegraded ? networkStateMessage : (net.isVpn ? 'VPN tunnel active' : (gatewayPending ? 'Detecting route...' : (isWifiLink ? (net.wifi?.band || null) : (net.ifaceName ? `via ${net.ifaceName}` : null))))} accent="#10b981" />
                <StatTile icon={<Shield size={18} />} label="DNS Server" value={net.dns[0]}
                    sub={net.dns.length > 1 ? `+${net.dns.length - 1} more` : null} accent="#f59e0b" />
            </div>

            {/* Connection details chips */}
            <div className="dash-details-row">
                {!net.connected && (
                    <span className="detail-chip" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>
                        <WifiOff size={13} />Disconnected
                    </span>
                )}
                {net.connected && net.isEthernet && (
                    <span className="detail-chip">
                        <Network size={13} />Ethernet link
                    </span>
                )}
                {net.connected && net.isVpn && (
                    <span className="detail-chip">
                        <Shield size={13} />{networkUpdating || networkDegraded ? networkStateMessage : 'VPN tunnel active'}
                    </span>
                )}
                {isWifiLink && net.wifi?.wifiGen && (
                    <span className="detail-chip" style={{ background: `${GEN_COLORS[net.wifi.wifiGen.gen] || 'var(--gray-100)'}15`, color: GEN_COLORS[net.wifi.wifiGen.gen] || 'var(--text-secondary)', borderColor: `${GEN_COLORS[net.wifi.wifiGen.gen] || 'var(--border-light)'}30` }}>
                        <Wifi size={13} />{net.wifi.wifiGen.label}
                    </span>
                )}
                {isWifiLink && net.wifi?.freqBand && <span className="detail-chip"><Signal size={13} />{net.wifi.freqBand}</span>}
                {isWifiLink && net.wifi?.channel && <span className="detail-chip"><Activity size={13} />CH {net.wifi.channel}</span>}
                {isWifiLink && net.wifi?.rxSpeed && <span className="detail-chip"><TrendingUp size={13} />RX {net.wifi.rxSpeed}</span>}
                {isWifiLink && net.wifi?.txSpeed && <span className="detail-chip"><TrendingUp size={13} />TX {net.wifi.txSpeed}</span>}
                {isWifiLink && net.wifi?.auth && <span className="detail-chip"><Shield size={13} />{net.wifi.auth}</span>}
                {isWifiLink && net.wifi?.cipher && <span className="detail-chip"><Shield size={13} />{net.wifi.cipher}</span>}
                {isWifiLink && net.wifi?.signal && <span className="detail-chip"><Signal size={13} />{net.wifi.signal} signal</span>}
            </div>

            {/* Live Latency Charts */}
            <div className="dash-cards-row">

            {/* Link quality / signal */}
            <div className="dash-card dash-card-signal">
                <div className="dash-card-head">
                    <div className="dash-card-left">
                        {net.isVpn ? <Shield size={16} /> : (isWifiLink ? <Signal size={16} /> : <Network size={16} />)}
                        <span>{net.isVpn ? 'VPN Tunnel' : (isWifiLink ? 'Wi-Fi Signal' : 'Link Status')}</span>
                    </div>
                    <span className="dash-card-meta">
                        {net.isVpn ? (
                            <span className="signal-badge" data-quality={net.connected ? 'good' : 'weak'}>
                                {networkUpdating || networkDegraded ? (networkDegraded ? 'Unavailable' : 'Updating') : 'Active'}
                            </span>
                        ) : isWifiLink ? (
                            net.wifi?.signal ? (
                                <span className="signal-badge" data-quality={signalDbm >= -50 ? 'excellent' : signalDbm >= -65 ? 'good' : signalDbm >= -75 ? 'fair' : 'weak'}>
                                    {signalDbm} dBm
                                </span>
                            ) : '-'
                        ) : (
                            <span className="signal-badge" data-quality={net.connected ? 'good' : 'weak'}>
                                {net.connected ? 'Active' : 'Offline'}
                            </span>
                        )}
                    </span>
                </div>
                <div className="signal-chart-wrap">
                    {net.isVpn ? (
                        <div className="link-status-panel">
                            <div className="link-status-row"><span>Tunnel</span><strong>{networkUpdating || networkDegraded ? networkStateMessage : 'VPN active'}</strong></div>
                            <div className="link-status-row"><span>Interface</span><strong>{vpnTunnelInterface}</strong></div>
                            <div className="link-status-row"><span>Tunnel IP</span><strong className="mono">{vpnTunnelLocalIp}</strong></div>
                            <div className="link-status-row"><span>VPN Public IP</span><strong className="mono">{tunnelDataTrusted && net.publicIP && net.publicIP !== 'Unavailable' ? net.publicIP : '-'}</strong></div>
                            <div className="link-status-row"><span>Gateway Probe</span><strong>Paused</strong></div>
                        </div>
                    ) : isWifiLink ? (
                        <>
                            {(() => {
                                const curDbm = pctToDbm(net.wifi?.signal)
                                const pts = signalPts.length > 0 ? signalPts : (curDbm != null ? [{ t: 0, dbm: curDbm }] : [])
                                if (pts.length === 0) return (
                                    <div className="signal-empty"><Signal size={18} /><span>No Wi-Fi signal</span></div>
                                )
                                const vals = pts.map(p => p.dbm)
                                const min = Math.min(...vals)
                                const max = Math.max(...vals)
                                const span = Math.max(max - min, 6)  // at least 6 dBm visible range
                                const mid = (min + max) / 2
                                const yMin = Math.floor(mid - span / 2 - 4)
                                const yMax = Math.ceil(mid + span / 2 + 4)
                                return (
                                    <div className="signal-chart-frame">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={pts} margin={{ top: 4, right: 6, bottom: 2, left: 0 }}>
                                                <YAxis domain={[yMin, yMax]} hide />
                                                <ReferenceLine y={-50} stroke="var(--color-success)" strokeDasharray="4 4" strokeOpacity={0.35} />
                                                <ReferenceLine y={-75} stroke="var(--color-warning)" strokeDasharray="4 4" strokeOpacity={0.35} />
                                                <Tooltip
                                                    contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}
                                                    labelFormatter={() => ''}
                                                    formatter={v => [`${v} dBm`, 'Signal']}
                                                />
                                                <Area type="monotone" dataKey="dbm" stroke="#06b6d4"
                                                    strokeWidth={2} fill="none" dot={false}
                                                    activeDot={{ r: 3, strokeWidth: 2, fill: '#fff', stroke: '#06b6d4' }}
                                                    isAnimationActive={false}
                                                    connectNulls />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                )
                            })()}
                            {/* Quality legend */}
                            <div className="signal-quality-row">
                                <span className="sq-dot" data-q="excellent" /><span className="sq-label">Excellent</span>
                                <span className="sq-dot" data-q="good" /><span className="sq-label">Good</span>
                                <span className="sq-dot" data-q="fair" /><span className="sq-label">Fair</span>
                                <span className="sq-dot" data-q="weak" /><span className="sq-label">Weak</span>
                            </div>
                        </>
                    ) : (
                        <div className="link-status-panel">
                            <div className="link-status-row"><span>Transport</span><strong>{linkLabel}</strong></div>
                            <div className="link-status-row"><span>Interface</span><strong>{net.ifaceName || 'Unknown'}</strong></div>
                            <div className="link-status-row"><span>Local IP</span><strong className="mono">{net.localIP || '-'}</strong></div>
                            <div className="link-status-row"><span>Gateway</span><strong className="mono">{net.gateway || (gatewayPending ? 'Detecting...' : '-')}</strong></div>
                        </div>
                    )}
                </div>
            </div>

            {/* Live Latency Charts */}
            <div className="dash-card dash-card-latency">
                <div className="dash-card-head">
                    <div className="dash-card-left">
                        <TrendingUp size={16} />
                        <span>Live Latency</span>
                    </div>
                    <span className="dash-card-meta">
                        {health !== 'loading' && <span className={`live-dot ${health}`} />}
                        every {pollMs / 1000}s - {MAX_PTS} synchronized samples
                    </span>
                </div>
                <div className="chart-grid">
                    {HOSTS.map((h, i) => (
                        <div className="chart-cell" key={h}>
                            <div className="chart-label">
                                <span className="chart-dot" style={{ background: CHART_COLORS[i] }} />
                                <span className="chart-host">{HOST_LABELS[h]}</span>
                                <span className="chart-ms mono">
                                    {pingLatest[h] != null ? `${pingLatest[h]} ms` : '-'}
                                </span>
                            </div>
                            <div className="chart-area">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={pingData[h]} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                                        <defs>
                                            <linearGradient id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor={CHART_COLORS[i]} stopOpacity={0.2} />
                                                <stop offset="100%" stopColor={CHART_COLORS[i]} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <YAxis domain={latencyYDomain} hide />
                                        <Tooltip
                                            contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}
                                            labelFormatter={() => ''}
                                            formatter={v => v != null ? [`${v} ms`, 'Ping'] : ['-', 'Ping']}
                                        />
                                        <Area type="linear" dataKey="ms" stroke={CHART_COLORS[i]}
                                            strokeWidth={2} fill={`url(#grad-${i})`} dot={false}
                                            activeDot={{ r: 3, strokeWidth: 2, fill: '#fff', stroke: CHART_COLORS[i] }}
                                            isAnimationActive={false}
                                            connectNulls />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            </div>{/* end dash-cards-row */}

            {/* Quick Actions */}
            <div className="dash-card">
                <div className="dash-card-head">
                    <div className="dash-card-left">
                        <Zap size={16} />
                        <span>Quick Tools</span>
                    </div>
                </div>
                <div className="action-grid">
                    {quickActions.map(a => (
                        <button key={a.path} className="action-card" onClick={() => navigate(a.path)}>
                            <div className="action-icon" style={{ color: a.color, background: `${a.color}12` }}>
                                <a.icon size={20} />
                            </div>
                            <div className="action-body">
                                <div className="action-label">{a.label}</div>
                                <div className="action-desc">{a.desc}</div>
                            </div>
                            <ArrowRight size={14} className="action-arrow" />
                        </button>
                    ))}
                </div>
            </div>

            {showExtraDeviceInfo && (
                <div className="dash-card dash-extra-info">
                    <div className="dash-card-head">
                        <div className="dash-card-left">
                            <Server size={16} />
                            <span>Device Context</span>
                        </div>
                        <span className="dash-card-meta">Auto-shown on spacious layouts</span>
                    </div>
                    <div className="dash-extra-grid">
                        <div className="dash-extra-item">
                            <div className="dash-extra-label">Link Profile</div>
                            <div className="dash-extra-value">{linkLabel}</div>
                            <div className="dash-extra-sub">{net.ifaceName || 'Unknown interface'}</div>
                        </div>
                        <div className="dash-extra-item">
                            <div className="dash-extra-label">Addressing</div>
                            <div className="dash-extra-value mono">{net.localIP || '-'}</div>
                            <div className="dash-extra-sub mono">{ipv6Address || 'No IPv6 on active link'}</div>
                        </div>
                        <div className="dash-extra-item">
                            <div className="dash-extra-label">Resolver Set</div>
                            <div className="dash-extra-value">{net.dns?.length || 0} DNS</div>
                            <div className="dash-extra-sub mono">{net.dns?.[0] || '-'}</div>
                        </div>
                        <div className="dash-extra-item">
                            <div className="dash-extra-label">Path Quality</div>
                            <div className="dash-extra-value mono">{avgLiveLatency != null ? `${avgLiveLatency} ms` : '-'}</div>
                            <div className="dash-extra-sub">
                                {net.isVpn ? 'VPN tunnel path' : (gwPing != null ? `Gateway ${gwPing} ms` : 'Gateway probe unavailable')}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}








