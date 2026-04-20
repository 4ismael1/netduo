import { useState, useEffect, useRef, useCallback } from 'react'
import {
    Gauge, Play, RotateCcw, ArrowDown, ArrowUp, Clock,
    Waves, Loader2, CheckCircle, Zap, Server, Activity,
    Trophy, RefreshCw, ChevronDown, Globe, MapPin, Trash2,
    ChevronLeft, ChevronRight, XCircle
} from 'lucide-react'
import bridge from '../../lib/electronBridge'
import { logBridgeWarning } from '../../lib/devLog.js'
import { deriveProgressMbps, isStalePhaseEvent } from '../../lib/speedMetrics'
import './SpeedTest.css'

/* ── Date helpers ── */
function fmtDate(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    if (isNaN(d)) return iso
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtTime(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d)) return ''
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}
/* ── Grades ── */
function getGrade(mbps) {
    if (!mbps) return null
    if (mbps >= 100) return { label: 'Excellent', color: '#22c55e' }
    if (mbps >= 50) return { label: 'Very Good', color: '#10b981' }
    if (mbps >= 25) return { label: 'Good', color: '#3b82f6' }
    if (mbps >= 10) return { label: 'Fair', color: '#f59e0b' }
    if (mbps >= 5) return { label: 'Slow', color: '#f97316' }
    return { label: 'Poor', color: '#ef4444' }
}

/* ── Smooth RAF hook (stable loop, no restart on value change) ── */
function useSmooth(target, lerp = 0.15) {
    const cur = useRef(0)
    const tRef = useRef(target)
    const [v, setV] = useState(0)
    useEffect(() => {
        tRef.current = target
    }, [target])
    useEffect(() => {
        let go = true
        function tick() {
            if (!go) return
            const t = tRef.current
            const d = t - cur.current
            if (Math.abs(d) < 0.05) {
                cur.current = t
            } else {
                // Proportional step with reasonable cap
                cur.current += d * lerp
            }
            setV(cur.current)
            requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        return () => { go = false }
    }, [lerp])
    return v
}

/* ══════════════════════════════════
   SPEEDTEST — MAIN
   ══════════════════════════════════ */
const MAX_SPEED = 300 // Gauge scale max

export default function SpeedTest() {
    const [phase, setPhase] = useState('idle')
    const [server, setServer] = useState(null)
    const [latency, setLatency] = useState(null)
    const [jitter, setJitter] = useState(null)
    const [liveSpeed, setLiveSpeed] = useState(0)
    const [avgSpeed, setAvgSpeed] = useState(0)
    const [progress, setProgress] = useState(0)
    const [dlSpeed, setDlSpeed] = useState(null)
    const [ulSpeed, setUlSpeed] = useState(null)
    const [error, setError] = useState(null)
    const [history, setHistory] = useState([])
    const [cancelling, setCancelling] = useState(false)
    const cleanupRef = useRef(null)
    const phaseRef = useRef('idle')

    // Server selector state
    const [servers, setServers] = useState([])
    const [selectedServerId, setSelectedServerId] = useState('mlab')
    const [showServerPicker, setShowServerPicker] = useState(false)
    const [testInfo, setTestInfo] = useState(null) // { probeSpeed, dlTarget, ulTarget }
    const [histPage, setHistPage] = useState(0)
    const HIST_PER_PAGE = 10

    // Load persisted history + servers on mount
    useEffect(() => {
        bridge.speedHistoryGet().then(h => {
            if (Array.isArray(h)) setHistory(h.slice(0, 50))
        }).catch(error => {
            logBridgeWarning('speedtest:history-load', error)
        })
        bridge.speedGetServers().then(s => {
            if (s?.length) setServers(s)
        }).catch(error => {
            logBridgeWarning('speedtest:servers-load', error)
        })
    }, [])

    const onProgress = useCallback((d) => {
        const p = d?.phase
        if (!p) return
        if (isStalePhaseEvent(phaseRef.current, p)) return

        const progressVal = Math.max(0, Math.min(100, Math.round(Number(d.progress) || 0)))

        if (p === 'init') {
            phaseRef.current = 'init'
            setPhase('init')
            return
        }
        if (p === 'latency') {
            phaseRef.current = 'latency'
            setPhase('latency')
            setLatency(d.latency)
            setJitter(d.jitter)
            setServer(d.server)
            return
        }
        if (p === 'calibrating') {
            phaseRef.current = 'calibrating'
            setPhase('calibrating')
            return
        }
        if (p === 'calibrated') {
            phaseRef.current = 'calibrated'
            setPhase('calibrated')
            setTestInfo({ probeSpeed: d.probeSpeed, dlTarget: d.dlTarget, ulTarget: d.ulTarget })
            return
        }
        if (p === 'download-start') {
            phaseRef.current = 'download-start'
            setPhase('download-start')
            setLiveSpeed(0)
            setAvgSpeed(0)
            setProgress(0)
            return
        }
        if (p === 'downloading') {
            const displayMbps = deriveProgressMbps(d)
            phaseRef.current = 'downloading'
            setPhase('downloading')
            setLiveSpeed(displayMbps)
            setAvgSpeed(displayMbps)
            setProgress(progressVal)
            return
        }
        if (p === 'download-done') {
            phaseRef.current = 'download-done'
            setPhase('download-done')
            setDlSpeed(d.speed)
            setLiveSpeed(d.speed ?? 0)
            setAvgSpeed(d.speed ?? 0)
            setProgress(100)
            return
        }
        if (p === 'upload-start') {
            phaseRef.current = 'upload-start'
            setPhase('upload-start')
            setLiveSpeed(0)
            setAvgSpeed(0)
            setProgress(0)
            return
        }
        if (p === 'uploading') {
            const displayMbps = deriveProgressMbps(d)
            phaseRef.current = 'uploading'
            setPhase('uploading')
            setLiveSpeed(displayMbps)
            setAvgSpeed(displayMbps)
            setProgress(progressVal)
            return
        }
        if (p === 'upload-done') {
            phaseRef.current = 'upload-done'
            setPhase('upload-done')
            setUlSpeed(d.speed)
            setLiveSpeed(d.speed ?? 0)
            setAvgSpeed(d.speed ?? 0)
            setProgress(100)
            return
        }
        if (p === 'done') {
            phaseRef.current = 'done'
            setPhase('done')
            setProgress(100)
            if (d.result) {
                setDlSpeed(d.result.download)
                setUlSpeed(d.result.upload)
                setLatency(prev => prev ?? d.result.latency)
                setJitter(prev => prev ?? d.result.jitter)
                setServer(prev => prev ?? d.result.server)
            }
            return
        }
        if (p === 'cancelled') {
            phaseRef.current = 'idle'
            setPhase('idle')
            setCancelling(false)
            setError(null)
            setServer(null)
            setLatency(null); setJitter(null)
            setLiveSpeed(0); setAvgSpeed(0); setProgress(0)
            setDlSpeed(null); setUlSpeed(null); setTestInfo(null)
            return
        }
        if (p === 'error') {
            phaseRef.current = 'error'
            setPhase('error')
            setError(d.message || 'Failed')
        }
    }, [])

    async function runTest() {
        // Clean up any previous listener first
        if (typeof cleanupRef.current === 'function') cleanupRef.current()
        cleanupRef.current = null

        // Full state reset
        phaseRef.current = 'init'
        setPhase('init'); setError(null); setServer(null); setCancelling(false)
        setLatency(null); setJitter(null); setLiveSpeed(0); setAvgSpeed(0); setProgress(0)
        setDlSpeed(null); setUlSpeed(null); setTestInfo(null)

        const unsub = bridge.onSpeedProgress(onProgress)
        cleanupRef.current = unsub
        try {
            const r = await bridge.speedTestFull(selectedServerId)
            // Only apply result if listener hasn't already pushed us to 'done'
            if (r?.error === 'cancelled') { /* cancellation handled via 'cancelled' progress event */ }
            else if (r?.error) { phaseRef.current = 'error'; setError('Speed test failed — check your connection.'); setPhase('error') }
            else if (r) {
                phaseRef.current = 'done'
                setPhase('done')
                setDlSpeed(prev => prev ?? r.download)
                setUlSpeed(prev => prev ?? r.upload)
                setLatency(prev => prev ?? r.latency)
                setJitter(prev => prev ?? r.jitter)
                setServer(prev => prev ?? r.server)
                setProgress(100)
                const h = {
                    download: r.download, upload: r.upload, latency: r.latency, jitter: r.jitter,
                    server: r.server?.name || selectedServerId,
                    timestamp: new Date().toISOString(),
                }
                bridge.speedHistoryAdd(h).then(full => {
                    if (Array.isArray(full)) setHistory(full.slice(0, 50))
                    else setHistory(prev => [h, ...prev].slice(0, 50))
                }).catch(error => {
                    logBridgeWarning('speedtest:history-add', error)
                    setHistory(prev => [h, ...prev].slice(0, 50))
                })
                bridge.historyAdd({ module: 'Speed Test', type: 'Full Test', detail: `↓${r.download} ↑${r.upload} Mbps`, results: h })
            }
        } catch (error) {
            logBridgeWarning('speedtest:run', error)
            phaseRef.current = 'error'
            setError('An error occurred.')
            setPhase('error')
        }
        finally {
            if (typeof unsub === 'function') unsub()
            cleanupRef.current = null
            setCancelling(false)
        }
    }

    useEffect(() => () => { if (typeof cleanupRef.current === 'function') cleanupRef.current() }, [])

    function reset() {
        if (typeof cleanupRef.current === 'function') cleanupRef.current()
        cleanupRef.current = null
        phaseRef.current = 'idle'
        setPhase('idle'); setError(null); setServer(null); setLatency(null); setJitter(null)
        setLiveSpeed(0); setAvgSpeed(0); setProgress(0); setDlSpeed(null); setUlSpeed(null)
        setTestInfo(null)
    }

    const running = !['idle', 'done', 'error'].includes(phase)
    const isDl = phase === 'download-start' || phase === 'downloading'
    const isUl = phase === 'upload-start' || phase === 'uploading'
    const isDone = phase === 'done'
    const isDlDone = phase === 'download-done'
    const isUlDone = phase === 'upload-done'
    const selectedServer = servers.find(s => s.id === selectedServerId) || servers[0]
    const needleVal = isDl
        ? liveSpeed
        : isUl
            ? liveSpeed
            : isDlDone
                ? (dlSpeed ?? 0)
                : isUlDone
                    ? (ulSpeed ?? 0)
                    : isDone
                        ? (dlSpeed ?? ulSpeed ?? 0)
                        : 0
    const dlG = getGrade(dlSpeed)
    const ulG = getGrade(ulSpeed)

    // Pagination
    const totalPages = Math.max(1, Math.ceil(history.length / HIST_PER_PAGE))
    const pagedHistory = history.slice(histPage * HIST_PER_PAGE, (histPage + 1) * HIST_PER_PAGE)

    return (
        <div className="v3-page-layout page-enter st-page">
            <div className="v3-page-header">
                <h1 className="v3-page-title"><Gauge size={24} color="var(--color-accent)" /> Speed Test</h1>
                <p className="v3-page-subtitle">Real-time download & upload measurement</p>
            </div>

            {/* ── Server Selector ── */}
            {servers.length > 1 && (
                <div className="st-server-picker">
                    <button className="st-server-btn" onClick={() => setShowServerPicker(!showServerPicker)} disabled={running}>
                        <Globe size={14} />
                        <span className="st-server-btn-name">{selectedServer?.name || 'Select Server'}</span>
                        <span className="st-server-btn-loc">{selectedServer?.location}</span>
                        <ChevronDown size={14} className={`st-chevron ${showServerPicker ? 'open' : ''}`} />
                    </button>
                    {showServerPicker && (
                        <div className="st-server-dropdown">
                            {servers.map(s => (
                                <button key={s.id}
                                    className={`st-server-opt ${s.id === selectedServerId ? 'active' : ''}`}
                                    onClick={() => { setSelectedServerId(s.id); setShowServerPicker(false) }}
                                >
                                    <div className="st-server-opt-info">
                                        <span className="st-server-opt-name">{s.name}</span>
                                        <span className="st-server-opt-loc"><MapPin size={10} /> {s.location}</span>
                                    </div>
                                    {s.id === selectedServerId && <CheckCircle size={14} className="st-server-opt-check" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="st-main v3-card">
                {/* ── Speedometer Area ── */}
                <div className="st-gauge-area">
                    <Speedometer
                        value={needleVal}
                        phase={phase}
                        isDl={isDl}
                        isUl={isUl}
                        isDone={isDone}
                        running={running}
                        avgSpeed={avgSpeed}
                    />

                    {/* Live progress row — fixed-height placeholder so layout doesn't jump */}
                    <div className="st-live-slot">
                        {(isDl || isUl) ? (
                            <div className="st-live-row">
                                <div className={`st-live-tag ${isUl ? 'ul' : 'dl'}`}>
                                    {isDl ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
                                    {isDl ? 'Download' : 'Upload'}
                                </div>
                                <div className="st-prog-track">
                                    <div className={`st-prog-fill ${isUl ? 'ul' : 'dl'}`} style={{ width: `${progress}%` }} />
                                </div>
                                <span className="st-prog-pct mono">{progress}%</span>
                            </div>
                        ) : null}
                    </div>

                    {/* Phase stepper */}
                    <div className="st-phases">
                        <PhaseChip label="Ping" icon={<Clock size={12} />} active={phase === 'init' || phase === 'latency'} done={idx(phase) >= 3} />
                        <div className={`st-ph-line ${idx(phase) >= 3 ? 'done' : ''}`} />
                        <PhaseChip label="Calibrate" icon={<Activity size={12} />} active={phase === 'calibrating' || phase === 'calibrated'} done={idx(phase) >= 5} />
                        <div className={`st-ph-line ${idx(phase) >= 5 ? 'done' : ''}`} />
                        <PhaseChip label="Download" icon={<ArrowDown size={12} />} active={isDl || phase === 'download-start'} done={idx(phase) >= 8} />
                        <div className={`st-ph-line ${idx(phase) >= 8 ? 'done' : ''}`} />
                        <PhaseChip label="Upload" icon={<ArrowUp size={12} />} active={isUl || phase === 'upload-start'} done={idx(phase) >= 10} />
                    </div>

                    {/* Test info badge (after calibration) — fixed height slot */}
                    <div className="st-info-slot">
                        {testInfo && running && testInfo.probeSpeed != null && (
                            <div className="st-test-info">
                                <span>Probe: {testInfo.probeSpeed} Mbps</span>
                                <span className="st-test-info-sep">·</span>
                                <span>↓ {(testInfo.dlTarget / 1024 / 1024).toFixed(0)} MB</span>
                                <span className="st-test-info-sep">·</span>
                                <span>↑ {(testInfo.ulTarget / 1024 / 1024).toFixed(0)} MB</span>
                            </div>
                        )}
                    </div>

                    {/* CTA — always visible */}
                    <div className="st-cta">
                        {running ? (
                            <>
                                <button className="st-btn st-btn-testing" disabled>
                                    <Loader2 size={16} className="st-spin" />{cancelling ? 'Cancelling…' : phaseText(phase)}
                                </button>
                                <button className="st-btn-icon" onClick={() => { setCancelling(true); bridge.stopSpeedTest?.() }} disabled={cancelling} title="Cancel test" style={{ color: 'var(--color-danger)' }}>
                                    <XCircle size={14} />
                                </button>
                            </>
                        ) : (
                            <button className="st-btn st-btn-start" onClick={runTest}>
                                <Play size={16} />{isDone || phase === 'error' ? 'Test Again' : 'Start Test'}
                            </button>
                        )}
                        {phase !== 'idle' && !running && (
                            <button className="st-btn-icon" onClick={reset}><RotateCcw size={14} /></button>
                        )}
                    </div>
                    {error && <p className="st-err">{error}</p>}
                </div>

                {/* ── Results Row ── */}
                <div className={`st-results ${isDone ? 'done' : ''} ${(dlSpeed != null || ulSpeed != null || latency != null) ? 'visible' : 'hidden'}`}>
                    <StatCard icon={<ArrowDown size={20} />} label="Download" color={dlG?.color}
                        val={dlSpeed} live={isDl ? liveSpeed : null} unit="Mbps" active={isDl} />
                    <StatCard icon={<ArrowUp size={20} />} label="Upload" color={ulG?.color}
                        val={ulSpeed} live={isUl ? liveSpeed : null} unit="Mbps" active={isUl} />
                    <StatCard icon={<Clock size={18} />} label="Ping" val={latency} unit="ms" small
                        color={latency != null ? (latency < 30 ? '#22c55e' : latency < 80 ? '#f59e0b' : '#ef4444') : null} />
                    <StatCard icon={<Waves size={18} />} label="Jitter" val={jitter} unit="ms" small
                        color={jitter != null ? (jitter < 5 ? '#22c55e' : '#f59e0b') : null} />
                </div>

                {/* ── Completion banner ── */}
                {isDone && dlG && (
                    <div className="st-done-banner" style={{ '--gc': dlG.color }}>
                        <div className="st-done-left">
                            <Trophy size={18} />
                            <span className="st-done-grade">{dlG.label}</span>
                        </div>
                        <div className="st-done-right mono">
                            <span className="st-done-dl">↓ {dlSpeed?.toFixed(1)}</span>
                            <span className="st-done-sep">/</span>
                            <span className="st-done-ul">↑ {ulSpeed?.toFixed(1)}</span>
                            <span className="st-done-unit">Mbps</span>
                        </div>
                    </div>
                )}

                {/* ── Server info ── */}
                <div className="st-server-bar">
                    <Server size={12} />
                    <span>{server?.name || selectedServer?.name || 'Cloudflare'}</span>
                    <span className="st-srv-sep">·</span>
                    <span className="st-srv-loc">{server?.location || selectedServer?.location || 'Global CDN'}</span>
                    {latency != null && <span className="st-srv-ms mono"><Activity size={10} />{latency}ms</span>}
                </div>
            </div>

            {/* ── History ── */}
            {history.length > 0 && (
                <div className="v3-card st-hist-wrap">
                    <div className="v3-card-header">
                        <span className="v3-card-title">History</span>
                        <span className="v3-badge accent">{history.length}</span>
                        <button className="st-hist-clear" onClick={() => { bridge.speedHistoryClear().then(() => { setHistory([]); setHistPage(0) }).catch(error => { logBridgeWarning('speedtest:history-clear', error); setHistory([]); setHistPage(0) }) }} title="Clear history">
                            <Trash2 size={13} /> Clear All
                        </button>
                    </div>
                    <div className="st-hist-body">
                        {pagedHistory.map((h, i) => {
                            const g = getGrade(h.download)
                            const ts = h.timestamp || (h.date ? `${h.date} ${h.ts}` : h.ts)
                            return (
                                <div className="st-hist-row" key={h.id || i}>
                                    <span className="st-h-ts">
                                        <span className="st-h-date">{fmtDate(ts)}</span>
                                        <span className="st-h-time">{fmtTime(ts)}</span>
                                    </span>
                                    <span className="mono st-h-dl" style={{ color: g?.color }}>
                                        <ArrowDown size={12} />
                                        {h.download?.toFixed(1)}
                                        <span className="st-h-unit">Mbps</span>
                                    </span>
                                    <span className="mono st-h-ul" style={{ color: getGrade(h.upload)?.color }}>
                                        <ArrowUp size={12} />
                                        {h.upload?.toFixed(1)}
                                        <span className="st-h-unit">Mbps</span>
                                    </span>
                                    <span className="mono st-h-ping">{h.latency != null ? `${h.latency}` : '—'}<span className="st-h-unit">ms</span></span>
                                    <span className="st-h-grade" style={{ color: g?.color }}>{g?.label}</span>
                                </div>
                            )
                        })}
                    </div>
                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="st-pagination">
                            <button className="st-page-btn" disabled={histPage === 0} onClick={() => setHistPage(p => p - 1)}>
                                <ChevronLeft size={14} />
                            </button>
                            <span className="st-page-info">{histPage + 1} / {totalPages}</span>
                            <button className="st-page-btn" disabled={histPage >= totalPages - 1} onClick={() => setHistPage(p => p + 1)}>
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

/* ── Phase order index ── */
const PH = ['idle', 'init', 'latency', 'calibrating', 'calibrated', 'download-start', 'downloading', 'download-done', 'upload-start', 'uploading', 'upload-done', 'done']
function idx(p) { return PH.indexOf(p) }
function phaseText(p) {
    if (p === 'init' || p === 'latency') return 'Measuring ping…'
    if (p === 'calibrating' || p === 'calibrated') return 'Calibrating…'
    if (p === 'downloading' || p === 'download-start') return 'Downloading…'
    if (p === 'download-done') return 'Preparing upload…'
    if (p === 'uploading' || p === 'upload-start') return 'Uploading…'
    return 'Testing…'
}

/* ── Phase chip ── */
function PhaseChip({ label, icon, active, done }) {
    return (
        <div className={`st-ph ${active ? 'active' : ''} ${done ? 'done' : ''}`}>
            {done ? <CheckCircle size={12} /> : active ? <Loader2 size={12} className="st-spin" /> : icon}
            <span>{label}</span>
        </div>
    )
}

/* ── Stat card ── */
function StatCard({ icon, label, val, live, unit, color, active, small }) {
    const display = val != null ? val.toFixed(1) : (live != null ? live.toFixed(1) : '—')
    return (
        <div className={`st-stat ${small ? 'small' : ''} ${active ? 'active' : ''}`}>
            <div className="st-stat-ic" style={color ? { color } : {}}>{icon}</div>
            <div className="st-stat-body">
                <span className="st-stat-lbl">{label}</span>
                <span className="st-stat-val mono" style={color ? { color } : {}}>
                    {display}<span className="st-stat-unit">{unit}</span>
                </span>
            </div>
        </div>
    )
}

/* ══════════════════════════════════
   SPEEDOMETER — Semicircle + Needle
   Like a real car speedometer
   ══════════════════════════════════ */
function Speedometer({ value, phase, isDl, isUl, isDone, running, avgSpeed }) {
    const smooth = useSmooth(value, 0.13)
    const pct = Math.min(1, Math.max(0, smooth / MAX_SPEED))

    // Semicircle: 180° from left (-180°) to right (0°)
    // In our coordinate system: needle at -90° is center (pointing up)
    // Left = 180°, Right = 0°, we sweep from 180° to 360° (=0°).
    // Using: startAngle = -180, endAngle = 0 → needle range: -180 to 0
    const needleAngle = -180 + pct * 180 // degrees

    // Colors
    let accentColor = 'var(--gray-300)'
    if (isDl) accentColor = '#3b82f6'
    else if (isUl) accentColor = '#8b5cf6'
    else if (isDone) accentColor = getGrade(value)?.color || '#22c55e'
    else if (running) accentColor = 'var(--color-accent)'

    const showNum = running || isDone
    const displayNum = showNum ? smooth.toFixed(1) : '0.0'
    const displayLabel = (isDl || phase === 'download-done')
        ? 'DOWNLOAD'
        : (isUl || phase === 'upload-done')
            ? 'UPLOAD'
            : 'Mbps'

    // Scale ticks & labels
    const scaleMarks = [0, 25, 50, 100, 150, 200, 300]
    const majorTicks = 30 // number of tick marks
    const R = 80 // gauge radius
    const CX = 100, CY = 92

    // Arc path (semicircle from left to right, opening upward)
    const arcR = R
    const arcStartX = CX - arcR // leftmost point
    const arcEndX = CX + arcR   // rightmost point
    const arcPath = `M ${arcStartX} ${CY} A ${arcR} ${arcR} 0 0 1 ${arcEndX} ${CY}`

    // Filled arc path (partial, based on pct)
    // Parametric: angle from π (left) to 0 (right), we go π to π*(1-pct)
    const fillAngle = Math.PI * (1 - pct)
    const fillX = CX + arcR * Math.cos(fillAngle)
    const fillY = CY - arcR * Math.sin(fillAngle)
    // Always 0: the fill arc within a 180° semicircle is always the short arc
    const fillPath = pct > 0.002
        ? `M ${arcStartX} ${CY} A ${arcR} ${arcR} 0 0 1 ${fillX} ${fillY}`
        : ''

    // Needle endpoint
    const needleLen = R - 8
    const nRad = (needleAngle) * Math.PI / 180
    const nX = CX + needleLen * Math.cos(nRad)
    const nY = CY + needleLen * Math.sin(nRad)

    return (
        <div className={`st-speedo ${running ? 'running' : ''} ${isDone ? 'complete' : ''}`}>
            <svg viewBox="0 0 200 120" className="st-speedo-svg">
                <defs>
                    <filter id="needleShadow">
                        <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={accentColor} floodOpacity="0.4" />
                    </filter>
                    <filter id="arcGlow2">
                        <feGaussianBlur stdDeviation="3" result="b" />
                        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    <linearGradient id="arcGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#ef4444" />
                        <stop offset="25%" stopColor="#f59e0b" />
                        <stop offset="50%" stopColor="#3b82f6" />
                        <stop offset="75%" stopColor="#10b981" />
                        <stop offset="100%" stopColor="#22c55e" />
                    </linearGradient>
                </defs>

                {/* BG arc */}
                <path d={arcPath} fill="none" stroke="var(--gray-200)" strokeWidth="7" strokeLinecap="round" />

                {/* Colored glow behind fill */}
                {(running || isDone) && pct > 0.005 && (
                    <path d={fillPath} fill="none" stroke={accentColor} strokeWidth="14" strokeLinecap="round"
                        opacity="0.08" filter="url(#arcGlow2)" />
                )}

                {/* Filled arc */}
                {pct > 0.002 && (
                    <path d={fillPath} fill="none" stroke={accentColor} strokeWidth="7" strokeLinecap="round" />
                )}

                {/* Scale labels */}
                {scaleMarks.map(m => {
                    const f = Math.min(1, m / MAX_SPEED)
                    const a = Math.PI * (1 - f)
                    const lx = CX + (R + 13) * Math.cos(a)
                    const ly = CY - (R + 13) * Math.sin(a)
                    return (
                        <text key={m} x={lx} y={ly} textAnchor="middle" dominantBaseline="central"
                            className="st-scale-text">{m}</text>
                    )
                })}

                {/* Tick marks */}
                {Array.from({ length: majorTicks + 1 }, (_, i) => {
                    const f = i / majorTicks
                    const a = Math.PI * (1 - f)
                    const isMaj = i % 5 === 0
                    const inner = isMaj ? R - 6 : R - 3
                    const outer = R + 1
                    return (
                        <line key={i}
                            x1={CX + inner * Math.cos(a)} y1={CY - inner * Math.sin(a)}
                            x2={CX + outer * Math.cos(a)} y2={CY - outer * Math.sin(a)}
                            stroke={f <= pct && (running || isDone) ? accentColor : 'var(--gray-300)'}
                            strokeWidth={isMaj ? 1.8 : 0.8} strokeLinecap="round" />
                    )
                })}

                {/* Needle */}
                <line x1={CX} y1={CY} x2={nX} y2={nY}
                    stroke={accentColor} strokeWidth="2.5" strokeLinecap="round"
                    filter={(running || isDone) ? 'url(#needleShadow)' : undefined} />
                {/* Center hub */}
                <circle cx={CX} cy={CY} r="5" fill={accentColor} />
                <circle cx={CX} cy={CY} r="2.5" fill="var(--bg-surface)" />
            </svg>

            {/* Speed display below */}
            <div className="st-speedo-readout">
                <span className="st-speedo-num mono" style={{ color: (running || isDone) ? accentColor : 'var(--text-muted)' }}>
                    {displayNum}
                </span>
                <span className="st-speedo-label">{displayLabel}</span>
            </div>

            {/* AVG badge */}
            {(isDl || isUl) && (
                <div className="st-speedo-avg mono">
                    overall {avgSpeed?.toFixed(1) || '0.0'} Mbps
                </div>
            )}
        </div>
    )
}


