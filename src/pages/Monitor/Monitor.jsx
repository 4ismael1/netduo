import { useState, useEffect, useRef } from 'react'
import { Activity, Play, Square, Plus, Trash2, Signal, Wifi, Globe, Server, Cloud, Network, Shield } from 'lucide-react'
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
    CartesianGrid, Legend, ReferenceLine
} from 'recharts'
import bridge from '../../lib/electronBridge'
import { normalizeTargetInput, isValidTarget } from '../../lib/validation'
import useNetworkStatus from '../../lib/useNetworkStatus.jsx'
import './Monitor.css'

const COLORS = ['#6366F1', '#22D3EE', '#10B981', '#F59E0B', '#EF4444']
const MAX_PTS = 60

const KNOWN_HOSTS = {
    '1.1.1.1': { icon: Cloud, label: 'Cloudflare' },
    '1.0.0.1': { icon: Cloud, label: 'Cloudflare' },
    '8.8.8.8': { icon: Globe, label: 'Google DNS' },
    '8.8.4.4': { icon: Globe, label: 'Google DNS' },
    '9.9.9.9': { icon: Server, label: 'Quad9' },
    '208.67.222.222': { icon: Server, label: 'OpenDNS' },
    '208.67.220.220': { icon: Server, label: 'OpenDNS' },
}
function hostIcon(h) {
    if (KNOWN_HOSTS[h]) return KNOWN_HOSTS[h].icon
    // Domain → Globe, IP → Server
    return /^[\d.]+$/.test(h) ? Server : Globe
}

function MonitorTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null
    return (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: 10, padding: '12px 16px', fontSize: 13, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>{label}</div>
            {payload.map((point, i) => (
                <div key={i} style={{ color: point.color, display: 'flex', gap: 12, justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{point.name}</span>
                    <span className="mono" style={{ fontWeight: 600 }}>{point.value != null ? `${point.value} ms` : 'Timeout'}</span>
                </div>
            ))}
        </div>
    )
}

export default function Monitor() {
    const net = useNetworkStatus()
    const [hosts, setHosts] = useState(['1.1.1.1', '8.8.8.8'])
    const [newHost, setNewHost] = useState('')
    const [data, setData] = useState([])
    const [running, setRunning] = useState(false)
    const [stats, setStats] = useState({})
    const [interval, setIntervalMs] = useState(2000)
    const [inputError, setInputError] = useState(null)
    const intervalRef = useRef(null)
    const hostsRef = useRef(hosts)

    // Keep ref in sync so the interval callback always sees current hosts
    useEffect(() => { hostsRef.current = hosts }, [hosts])
    useEffect(() => () => clearInterval(intervalRef.current), [])

    function startMonitor() {
        setRunning(true)
        setData([])
        setStats({})
        const tick = async () => {
            try {
                const results = {}
                for (const h of hostsRef.current) {
                    const r = await bridge.pingSingle(h)
                    results[h] = r?.time ?? null
                }
                const t = new Date().toLocaleTimeString('en-US', { hour12: false })
                setData(prev => [...prev, { t, ...results }].slice(-MAX_PTS))
                setStats(prev => {
                    const next = { ...prev }
                    for (const h of hostsRef.current) {
                        const old = prev[h] || { min: Infinity, max: -Infinity, total: 0, count: 0, loss: 0 }
                        if (results[h] != null) {
                            next[h] = { min: Math.min(old.min, results[h]), max: Math.max(old.max, results[h]), total: old.total + results[h], count: old.count + 1, loss: old.loss, last: results[h] }
                        } else {
                            next[h] = { ...old, count: old.count + 1, loss: old.loss + 1, last: null }
                        }
                    }
                    return next
                })
            } catch (e) { console.warn('Monitor tick error:', e) }
        }
        tick()
        intervalRef.current = setInterval(tick, interval)
    }

    function stopMonitor() {
        clearInterval(intervalRef.current)
        setRunning(false)
    }

    function addHost() {
        const h = normalizeTargetInput(newHost)
        if (!h) { setInputError('Enter an IP or domain'); return }
        if (!isValidTarget(h)) { setInputError('Enter a valid IP or domain (e.g. 1.1.1.1 or google.com)'); return }
        if (hosts.includes(h)) { setInputError('Host already added'); return }
        if (hosts.length >= 5) { setInputError('Maximum 5 hosts'); return }

        setInputError(null)
        setHosts(p => [...p, h])
        setNewHost('')
        if (running) {
            clearInterval(intervalRef.current)
            startMonitor()
        }
    }

    function removeHost(h) {
        setHosts(p => p.filter(x => x !== h))
        setStats(p => { const n = { ...p }; delete n[h]; return n })
    }

    return (
        <div className="v3-page-layout page-enter">
            <div className="v3-page-header">
                <h1 className="v3-page-title"><Activity size={24} color="var(--color-accent)" /> Real-time Monitor</h1>
                <p className="v3-page-subtitle">Continuous latency monitoring and packet loss tracking for multiple hosts</p>
            </div>

            <div className="v3-card monitor-net-state-card">
                <div className="monitor-net-state-head">
                    <span className="monitor-net-state-title">
                        {net.isVpn ? <Shield size={15} /> : (net.isEthernet ? <Network size={15} /> : <Wifi size={15} />)}
                        {net.isVpn ? 'VPN tunnel active' : (net.isEthernet ? 'Ethernet link active' : (net.isWifi ? 'Wi-Fi link active' : (net.connected ? 'Network active' : 'Network offline')))}
                    </span>
                    <span className={`v3-badge ${net.connected ? 'success' : 'warning'}`}>
                        {net.connected ? 'Online' : 'Offline'}
                    </span>
                </div>
                <div className="monitor-net-state-meta">
                    <span className="monitor-net-chip">Interface: {net.ifaceName || '-'}</span>
                    <span className="monitor-net-chip mono">Local IP: {net.localIP || '-'}</span>
                    <span className="monitor-net-chip mono">Gateway: {net.isVpn ? 'Paused (VPN)' : (net.gateway || '-')}</span>
                    {net.isVpn && (
                        <span className="monitor-net-chip monitor-net-chip-vpn">
                            VPN path can alter latency vs direct WAN
                        </span>
                    )}
                </div>
            </div>

            {/* Controls */}
            <div className="v3-card" style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
                        <Wifi size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                        <input className="v3-input" style={{ paddingLeft: 38 }} value={newHost}
                            onChange={e => { setNewHost(e.target.value); if (inputError) setInputError(null) }}
                            onKeyDown={e => e.key === 'Enter' && addHost()}
                            placeholder="Add host (IP or domain)" />
                    </div>
                    <button className="v3-btn v3-btn-secondary" onClick={addHost} disabled={hosts.length >= 5}>
                        <Plus size={14} />Add Host
                    </button>
                    <div style={{ width: 1, height: 26, background: 'var(--border-light)' }} />
                    <select className="v3-input" style={{ width: 110, paddingLeft: 12 }} value={interval}
                        onChange={e => setIntervalMs(Number(e.target.value))}>
                        <option value={1000}>1 sec tick</option>
                        <option value={2000}>2 sec tick</option>
                        <option value={5000}>5 sec tick</option>
                        <option value={10000}>10s tick</option>
                    </select>
                    {!running
                        ? <button className="v3-btn v3-btn-primary" onClick={startMonitor}><Play size={16} />Start Monitor</button>
                        : <button className="v3-btn" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)', border: '1px solid rgba(239, 68, 68, 0.3)' }} onClick={stopMonitor}><Square size={16} />Stop</button>}
                </div>
                {inputError && (
                    <div style={{ color: 'var(--color-danger)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                        {inputError}
                    </div>
                )}

                {/* Host tags */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
                    {hosts.map((h, i) => (
                        <div key={h} className="host-tag" style={{ '--tag-color': COLORS[i] }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i], display: 'inline-block', flexShrink: 0, boxShadow: running ? `0 0 8px ${COLORS[i]}` : 'none', transition: 'box-shadow 0.3s' }} />
                            {(() => { const Icon = hostIcon(h); return <Icon size={14} style={{ color: COLORS[i], flexShrink: 0 }} /> })()}
                            <span className="mono" style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{h}</span>
                            <button className="tag-remove" onClick={() => removeHost(h)} title="Remove"><Trash2 size={12} /></button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Stats cards */}
            <div className="monitor-stats-grid" style={{ marginBottom: 24 }}>
                {hosts.map((h, i) => {
                    const s = stats[h]
                    const loss = s?.count ? ((s.loss / s.count) * 100).toFixed(0) : '0'
                    const avg = s?.count - s?.loss ? (s.total / (s.count - s.loss)).toFixed(0) : null
                    const lossColor = parseInt(loss) > 10 ? 'var(--color-danger)' : parseInt(loss) > 0 ? 'var(--color-warning)' : 'var(--color-success)'
                    return (
                        <div className="v3-card" key={h} style={{ borderTop: `3px solid ${COLORS[i]}`, position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 0, right: 0, width: 80, height: 80, background: COLORS[i] + '10', borderRadius: '0 0 0 60px' }} />
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                {(() => { const Icon = hostIcon(h); return <Icon size={14} style={{ color: COLORS[i] }} /> })()}
                                {running && <Signal size={14} style={{ color: COLORS[i], animation: 'pulse-dot 1.5s ease-in-out infinite' }} />}
                                <span className="mono" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{h}</span>
                                {KNOWN_HOSTS[h] && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>{KNOWN_HOSTS[h].label}</span>}
                            </div>
                            <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s?.last != null ? COLORS[i] : 'var(--text-muted)', marginBottom: 16 }}>
                                {s?.last != null ? `${s.last}` : '—'}<span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 4 }}>ms</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 12 }}>
                                <div>
                                    <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Min</div>
                                    <div className="mono" style={{ color: 'var(--color-success)', fontWeight: 600 }}>{s && s.min !== Infinity ? s.min : '—'}</div>
                                </div>
                                <div>
                                    <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg</div>
                                    <div className="mono" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{avg ?? '—'}</div>
                                </div>
                                <div>
                                    <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Loss</div>
                                    <div className="mono" style={{ color: lossColor, fontWeight: 700 }}>{loss}%</div>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Real-time Chart */}
            <div className="v3-card" style={{ flex: 1, minHeight: 350 }}>
                <div className="v3-card-header">
                    <span className="v3-card-title">Latency Graph</span>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        {running && <span className="v3-badge success" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }}>● LIVE</span>}
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Last {MAX_PTS} samples</span>
                    </div>
                </div>
                {data.length === 0 ? (
                    <div className="empty-state" style={{ padding: '80px 0', height: 260, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <Wifi size={48} style={{ color: 'var(--text-muted)', marginBottom: 16, opacity: 0.5 }} />
                        <div style={{ fontSize: 14 }}>Click Start Monitor to begin real-time tracking</div>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" vertical={false} />
                            <XAxis dataKey="t" tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }} unit="ms" axisLine={false} tickLine={false} />
                            <Tooltip content={<MonitorTooltip />} />
                            <Legend wrapperStyle={{ fontSize: 13, paddingTop: 16 }} />
                            {hosts.map((h, i) => (
                                <Line key={h} type="monotone" dataKey={h} stroke={COLORS[i]}
                                    strokeWidth={3} dot={false} isAnimationActive={false}
                                    connectNulls={false} strokeLinecap="round"
                                    activeDot={{ r: 5, fill: COLORS[i], stroke: '#fff', strokeWidth: 2 }} />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    )
}
