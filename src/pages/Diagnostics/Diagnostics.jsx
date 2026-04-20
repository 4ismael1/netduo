import { useState, useRef, useEffect } from 'react'
import {
    Activity, Shield, Server, Globe, Search, ChevronRight,
    CheckCircle, XCircle, Loader2, TerminalSquare, Rss, AlertCircle, RadioReceiver, ArrowRight
} from 'lucide-react'
import bridge from '../../lib/electronBridge'
import { isValidHostname, isValidPortRange, isValidTarget, normalizeTargetInput, parseInteger } from '../../lib/validation'
import './Diagnostics.css'

const DNS_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME']

// ─── Shared Diagnostic Panel ──────────────────────────────────────────────────
function DiagPanel({ title, icon: Icon, description, children }) {
    return (
        <div className="v3-card page-enter">
            <div className="v3-card-header">
                <div className="v3-card-title">
                    <Icon size={18} style={{ color: 'var(--color-accent)' }} />
                    {title}
                </div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>{description}</p>
            {children}
        </div>
    )
}

// ─── Traceroute Panel ─────────────────────────────────────────────────────
function TraceroutePanel() {
    const [host, setHost] = useState('google.com')
    const [hops, setHops] = useState([])
    const [running, setRunning] = useState(false)
    const [done, setDone] = useState(false)
    const [error, setError] = useState(null)

    function start() {
        const h = normalizeTargetInput(host)
        if (!isValidTarget(h)) { setError('Enter a valid IP or domain (e.g. 8.8.8.8 or google.com)'); return }
        setError(null); setHops([]); setDone(false); setRunning(true)
        bridge.startTraceroute(
            h,
            hop => setHops(prev => {
                const updated = [...prev]
                const idx = updated.findIndex(h => h.hop === hop.hop)
                if (idx >= 0) updated[idx] = hop; else updated.push(hop)
                return updated.sort((a, b) => a.hop - b.hop)
            }),
            () => { setRunning(false); setDone(true) }
        )
    }

    function stop() {
        bridge.offTraceroute()
        setRunning(false)
        setDone(true)
    }

    useEffect(() => () => { bridge.offTraceroute() }, [])

    function latencyColor(avg) {
        if (!avg) return 'var(--text-muted)'
        const v = parseFloat(avg)
        if (v < 40) return 'var(--color-success)'
        if (v < 150) return 'var(--color-warning)'
        return 'var(--color-danger)'
    }

    return (
        <DiagPanel title="Traceroute Explorer" icon={Rss} description="Map the network path packets take to reach a specific destination host">
            <div className="diag-controls-row">
                <div style={{ flex: 1, position: 'relative' }}>
                    <Globe size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                    <input className="v3-input" style={{ paddingLeft: 38 }} value={host} onChange={e => setHost(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !running && start()}
                        placeholder="Target Host or IP address" />
                </div>
                {running ? (
                    <button className="v3-btn v3-btn-secondary" style={{ color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.3)' }} onClick={stop}>
                        <XCircle size={16} /> Stop Trace
                    </button>
                ) : (
                    <button className="v3-btn v3-btn-primary" onClick={start} disabled={!host.trim()}>
                        <Rss size={16} /> Start Trace
                    </button>
                )}
            </div>

            {error && <div style={{ color:'var(--color-danger)', fontSize:13, display:'flex', alignItems:'center', gap:6, marginBottom:16 }}><AlertCircle size={14}/>{error}</div>}

            {(hops.length > 0 || done) && (
                <div className="diag-hop-list">
                    <div className="diag-hop-header">
                        <span>#</span><span>IP Address</span><span>Times (ms)</span><span>Average</span>
                    </div>
                    {hops.map(hop => (
                        <div className="diag-hop-row" key={hop.hop} style={{ animationDelay: `${(hop.hop - 1) * 30}ms` }}>
                            <span className="mono" style={{ color: 'var(--text-muted)' }}>{hop.hop}</span>
                            <span className="mono" style={{ color: 'var(--color-info)', fontWeight: 500 }}>
                                {hop.ip === '*' ? <span style={{ color: 'var(--text-muted)' }}>* * *</span> : hop.ip}
                            </span>
                            <span className="mono" style={{ color: 'var(--text-muted)' }}>
                                {hop.times?.map((t, i) => <span key={i} style={{ marginRight: 8 }}>{t}</span>)}
                                {!hop.times?.length && <span>timeout</span>}
                            </span>
                            <span className="mono" style={{ color: latencyColor(hop.avg), fontWeight: 700 }}>
                                {hop.avg ? `${hop.avg}ms` : '—'}
                            </span>
                        </div>
                    ))}
                    {running && (
                        <div className="diag-hop-row" style={{ opacity: 0.5, gridTemplateColumns: '1fr', textAlign: 'center' }}>
                            <div style={{ color: 'var(--text-muted)' }}>
                                <Loader2 size={14} className="spin-icon" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle', color: 'var(--color-accent)' }} />
                                Awaiting next hop response...
                            </div>
                        </div>
                    )}
                    {done && hops.length > 0 && (
                        <div style={{ marginTop: 16, fontSize: 13, color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px' }}>
                            <CheckCircle size={14} /> Traceroute successfully reached destination in {hops.length} hops.
                        </div>
                    )}
                </div>
            )}
        </DiagPanel>
    )
}

// ─── Live Ping Panel ──────────────────────────────────────────────────────
function PingPanel() {
    const [host, setHost] = useState('1.1.1.1')
    const [count, setCount] = useState(15)
    const [replies, setReplies] = useState([])
    const [running, setRunning] = useState(false)
    const [stats, setStats] = useState(null)
    const [error, setError] = useState(null)
    const replyRef = useRef(null)

    useEffect(() => {
        if (replyRef.current) replyRef.current.scrollTop = replyRef.current.scrollHeight
    }, [replies])

    useEffect(() => () => { bridge.offPingLive() }, [])

    function stop() {
        bridge.offPingLive()
        setRunning(false)
    }

    function start() {
        const h = normalizeTargetInput(host)
        if (!isValidTarget(h)) { setError('Enter a valid IP or domain (e.g. 1.1.1.1 or google.com)'); return }
        setError(null); setReplies([]); setStats(null); setRunning(true)
        bridge.startPingLive(
            h, count,
            reply => setReplies(prev => [...prev, reply]),
            ({ seqNum }) => {
                setRunning(false)
                setReplies(prev => {
                    const times = prev.filter(r => r.time != null).map(r => r.time)
                    if (times.length) {
                        setStats({
                            sent: seqNum,
                            received: times.length,
                            loss: (((seqNum - times.length) / seqNum) * 100).toFixed(0),
                            min: Math.min(...times).toFixed(1),
                            avg: (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1),
                            max: Math.max(...times).toFixed(1),
                        })
                    }
                    return prev
                })
            }
        )
    }

    return (
        <DiagPanel title="Live Ping Terminal" icon={TerminalSquare} description="Stream ICMP echo requests and monitor raw packet latency in real-time">
            <div className="diag-controls-row">
                <div style={{ flex: 1, position: 'relative' }}>
                    <Activity size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                    <input className="v3-input" style={{ paddingLeft: 38 }} value={host} onChange={e => setHost(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !running && start()}
                        placeholder="Target Host or IP address" />
                </div>
                <select className="v3-input" style={{ width: 120, paddingLeft: 12 }} value={count} onChange={e => setCount(Number(e.target.value))}>
                    {[5, 10, 15, 30, 50, 100].map(n => <option key={n} value={n}>{n} packets</option>)}
                </select>
                {running ? (
                    <button className="v3-btn v3-btn-secondary" style={{ color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.3)' }} onClick={stop}>
                        <XCircle size={16} /> Stop Ping
                    </button>
                ) : (
                    <button className="v3-btn v3-btn-primary" onClick={start} disabled={!host.trim()}>
                        <Activity size={16} /> Start Ping
                    </button>
                )}
            </div>

            {error && <div style={{ color:'var(--color-danger)', fontSize:13, display:'flex', alignItems:'center', gap:6, marginBottom:16 }}><AlertCircle size={14}/>{error}</div>}

            {stats && (
                <div className="ping-stats-row">
                    {[
                        { label: 'Packets Sent', v: stats.sent },
                        { label: 'Received', v: stats.received, color: 'var(--color-success)' },
                        { label: 'Packet Loss', v: `${stats.loss}%`, color: parseInt(stats.loss) > 0 ? 'var(--color-danger)' : 'var(--color-success)' },
                        { label: 'Minimum', v: `${stats.min}ms`, color: 'var(--color-info)' },
                        { label: 'Average', v: `${stats.avg}ms` },
                        { label: 'Maximum', v: `${stats.max}ms`, color: 'var(--color-warning)' },
                    ].map(({ label, v, color }) => (
                        <div key={label} className="ping-stat">
                            <div className="ping-stat-label">{label}</div>
                            <div className="ping-stat-val" style={{ color: color || 'var(--text-primary)' }}>{v}</div>
                        </div>
                    ))}
                </div>
            )}

            {replies.length > 0 && (
                <div ref={replyRef} className="ping-terminal">
                    {replies.map((r, i) => (
                        <div key={i} className="ping-line" style={{ animationDelay: `${i * 10}ms` }}>
                            <span style={{ color: 'var(--text-muted)', minWidth: 32 }}>[{r.seq}]</span>
                            {r.timeout
                                ? <span style={{ color: 'var(--color-danger)' }}>Request timed out...</span>
                                : <>
                                    <span style={{ color: 'var(--text-secondary)' }}>Reply from</span>
                                    <span style={{ color: 'var(--color-info)' }}>{host}</span>
                                    <span style={{ color: 'var(--text-secondary)' }}>time=</span>
                                    <span style={{ color: r.time < 50 ? 'var(--color-success)' : r.time < 150 ? 'var(--color-warning)' : 'var(--color-danger)', fontWeight: 600 }}>
                                        {r.time}ms
                                    </span>
                                </>
                            }
                        </div>
                    ))}
                    {running && <div style={{ color: 'var(--color-accent)', marginTop: 8 }}><Loader2 size={12} className="spin-icon" style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} /> awaiting reply...</div>}
                </div>
            )}
        </DiagPanel>
    )
}

// ─── DNS Lookup Panel ─────────────────────────────────────────────────────
function DnsPanel() {
    const [host, setHost] = useState('google.com')
    const [results, setResults] = useState({})
    const [loading, setLoading] = useState({})
    const [ran, setRan] = useState(false)
    const [error, setError] = useState(null)

    function lookup() {
        const h = normalizeTargetInput(host)
        if (!isValidHostname(h)) { setError('Enter a valid domain (e.g. google.com or example.org)'); return }
        setError(null); setResults({}); setRan(true)
        const loadingState = {}
        DNS_TYPES.forEach(t => { loadingState[t] = true })
        setLoading(loadingState)

        DNS_TYPES.forEach(type => {
            bridge.dnsLookup(h, type).then(res => {
                setResults(prev => ({ ...prev, [type]: res }))
                setLoading(prev => ({ ...prev, [type]: false }))
            }).catch(err => {
                setResults(prev => ({ ...prev, [type]: { type, addresses: [], error: err.message, time: 0 } }))
                setLoading(prev => ({ ...prev, [type]: false }))
            })
        })
    }

    const typeColors = { A: 'var(--color-info)', AAAA: 'var(--color-accent)', MX: 'var(--color-success)', TXT: 'var(--color-warning)', NS: '#f97316', CNAME: 'var(--color-danger)' }

    return (
        <DiagPanel title="Parallel DNS Resolution" icon={Globe} description="Query multiple DNS record types simultaneously for a domain">
            <div className="diag-controls-row">
                <div style={{ flex: 1, position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                    <input className="v3-input" style={{ paddingLeft: 38 }} value={host} onChange={e => setHost(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && lookup()}
                        placeholder="Domain name (e.g. example.com)" />
                </div>
                <button className="v3-btn v3-btn-primary" onClick={lookup} disabled={!host.trim()}>
                    <Search size={16} /> Resolve Records
                </button>
            </div>

            {error && <div style={{ color:'var(--color-danger)', fontSize:13, display:'flex', alignItems:'center', gap:6, marginBottom:16 }}><AlertCircle size={14}/>{error}</div>}

            {ran && (
                <div className="dns-grid">
                    {DNS_TYPES.map(type => {
                        const res = results[type]
                        const isLoading = loading[type]
                        return (
                            <div className="dns-card" key={type}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span className="dns-type-badge" style={{ color: typeColors[type] || 'var(--color-accent)' }}>
                                        {type} Record
                                    </span>
                                    {!isLoading && res && (
                                        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{res.time}ms</span>
                                    )}
                                </div>
                                {isLoading ? (
                                    <div style={{ color: 'var(--text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                                        <Loader2 size={14} className="spin-icon" /> Resolving...
                                    </div>
                                ) : res?.error ? (
                                    <div style={{ color: 'var(--color-danger)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <XCircle size={14} />{res.error.includes('ENOTFOUND') ? 'No record found' : res.error}
                                    </div>
                                ) : res?.addresses?.length ? (
                                    <div className="dns-answers">
                                        {res.addresses.map((addr, i) => (
                                            <div key={i} className="dns-answer">{addr}</div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </DiagPanel>
    )
}

// ─── Port Scanner Panel ───────────────────────────────────────────────────
function PortScanPanel() {
    const [host, setHost] = useState('192.168.1.1')
    const [startP, setStartP] = useState(1)
    const [endP, setEndP] = useState(1024)
    const [results, setResults] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const COMMON = [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 993, 3306, 3389, 5432, 8080]

    async function scan() {
        const h = normalizeTargetInput(host)
        const start = parseInteger(startP)
        const end = parseInteger(endP)
        if (!isValidTarget(h)) { setError('Enter a valid IP or host (e.g. 192.168.1.1)'); return }
        if (!isValidPortRange(start, end)) { setError('Port range must be 1-65535 and start <= end'); return }
        setError(null); setResults([]); setLoading(true)
        const r = await bridge.scanPorts(h, start, end)
        setResults(r)
        setLoading(false)
    }

    return (
        <DiagPanel title="TCP Port Scanner" icon={Server} description="Scan host IP for open TCP ports sequentially">
            <div className="diag-controls-row" style={{ flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
                    <Server size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                    <input className="v3-input" style={{ paddingLeft: 38 }} value={host} onChange={e => setHost(e.target.value)} placeholder="Target IP or Host" />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input className="v3-input mono" type="number" value={startP} onChange={e => setStartP(+e.target.value)} style={{ width: 80, paddingLeft: 12 }} min={1} max={65535} />
                    <span style={{ color: 'var(--text-muted)' }}>to</span>
                    <input className="v3-input mono" type="number" value={endP} onChange={e => setEndP(+e.target.value)} style={{ width: 80, paddingLeft: 12 }} min={1} max={65535} />
                </div>
                {loading ? (
                    <button className="v3-btn v3-btn-secondary" style={{ color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.3)' }} onClick={() => bridge.stopPortScan?.()}>
                        <XCircle size={16} /> Stop Scan
                    </button>
                ) : (
                    <button className="v3-btn v3-btn-primary" onClick={scan}>
                        <Search size={16} /> Scan Ports
                    </button>
                )}
            </div>

            {error && <div style={{ color:'var(--color-danger)', fontSize:13, display:'flex', alignItems:'center', gap:6, marginBottom:16 }}><AlertCircle size={14}/>{error}</div>}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
                <span className="v3-label-sm" style={{ marginRight: 8, marginTop: 4 }}>Common Targets:</span>
                {COMMON.map(p => (
                    <button key={p} className="v3-btn v3-btn-secondary" style={{ padding: '4px 10px', fontSize: 11, height: 'auto', borderRadius: '16px' }}
                        onClick={() => { setStartP(p); setEndP(p); setHost(host) }}>
                        Port {p}
                    </button>
                ))}
            </div>

            {results.length > 0 && (
                <div style={{ border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', padding: 20, background: 'var(--bg-app)' }}>
                    <div style={{ fontSize: 13, color: 'var(--color-success)', marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <CheckCircle size={16} />Found {results.length} open port{results.length !== 1 ? 's' : ''} on {host}
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {results.map(r => (
                            <div key={r.port} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-light)', padding: '6px 12px', borderRadius: '9999px' }}>
                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-success)' }} />
                                <span className="mono" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.port}</span>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                    {({ 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 443: 'HTTPS', 3306: 'MySQL', 3389: 'RDP', 5432: 'PgSQL', 8080: 'HTTP*' })[r.port] || 'tcp'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!loading && results.length === 0 && host && (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>Define a range and scan to list open TCP ports mapping to active services.</div>
            )}
        </DiagPanel>
    )
}

// ─── MTR (My Traceroute) ─────────────────────────────────────────────────
function MtrPanel() {
    const [host, setHost] = useState('8.8.8.8')
    const [hops, setHops] = useState([])
    const [session, setSession] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    useEffect(() => {
        return () => { if (session) bridge.stopMtr(session) }
    }, [session])

    function start() {
        if (session) { bridge.stopMtr(session); setSession(null); return }
        const h = normalizeTargetInput(host)
        if (!isValidTarget(h)) { setError('Enter a valid IP or domain (e.g. 8.8.8.8)'); return }
        setError(null); setHops([]); setLoading(true)
        bridge.startMtr(
            h, 1000,
            initialHops => { setHops(initialHops); setLoading(false) },
            updatedHops => setHops(updatedHops),
            sid => setSession(sid)
        )
    }

    return (
        <DiagPanel title="MTR Analysis" icon={RadioReceiver} description="Combines traceroute and ping into a continuous connection quality monitor">
            <div className="diag-controls-row">
                <div style={{ flex: 1, position: 'relative' }}>
                    <RadioReceiver size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                    <input className="v3-input" style={{ paddingLeft: 38 }} value={host} onChange={e => setHost(e.target.value)}
                        disabled={!!session} onKeyDown={e => e.key === 'Enter' && !session && start()}
                        placeholder="Target Host or IP" />
                </div>
                <button className={`v3-btn ${session ? 'v3-btn-secondary' : 'v3-btn-primary'}`} style={session ? { color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.3)' } : {}} onClick={start} disabled={loading || !host.trim()}>
                    {loading ? <Loader2 size={16} className="spin-icon" /> : session ? 'Stop Analysis' : 'Start Analysis'}
                </button>
            </div>

            {error && <div style={{ color:'var(--color-danger)', fontSize:13, display:'flex', alignItems:'center', gap:6, marginBottom:16 }}><AlertCircle size={14}/>{error}</div>}

            {loading && <div style={{ color: 'var(--text-muted)', paddingBottom: 20 }}><Loader2 size={16} className="spin-icon" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} /> Mapping route hops before ping cycle...</div>}

            {hops.length > 0 && (
                <div style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                        <thead style={{ background: 'var(--bg-app)', borderBottom: '1px solid var(--border-strong)' }}>
                            <tr>
                                <th style={{ padding: '10px', color: 'var(--text-muted)' }}>#</th>
                                <th style={{ padding: '10px', color: 'var(--text-muted)' }}>Host Node</th>
                                <th style={{ padding: '10px', color: 'var(--text-muted)' }}>Loss</th>
                                <th style={{ padding: '10px', color: 'var(--text-muted)' }}>Sent</th>
                                <th style={{ padding: '10px', color: 'var(--text-muted)' }}>Last</th>
                                <th style={{ padding: '10px', color: 'var(--text-muted)' }}>Avg</th>
                                <th style={{ padding: '10px', color: 'var(--text-muted)' }}>Best</th>
                                <th style={{ padding: '10px', color: 'var(--text-muted)' }}>Wrst</th>
                            </tr>
                        </thead>
                        <tbody className="mono" style={{ background: 'var(--bg-surface)' }}>
                            {hops.map(h => (
                                <tr key={h.hop} style={{ borderBottom: '1px solid var(--border-light)' }}>
                                    <td style={{ padding: '10px', color: 'var(--text-muted)' }}>{h.hop}</td>
                                    <td style={{ padding: '10px', color: 'var(--color-info)' }}>{h.ip === '*' ? 'Unknown Gateway' : h.ip}</td>
                                    <td style={{ padding: '10px', color: parseFloat(h.loss) > 0 ? 'var(--color-danger)' : 'var(--color-success)', fontWeight: 600 }}>{h.loss}%</td>
                                    <td style={{ padding: '10px' }}>{h.sent}</td>
                                    <td style={{ padding: '10px' }}>{h.times.length ? `${h.times[h.times.length - 1]}ms` : '—'}</td>
                                    <td style={{ padding: '10px' }}>{h.avg ? `${h.avg}ms` : '—'}</td>
                                    <td style={{ padding: '10px', color: 'var(--color-success)' }}>{h.min !== Infinity ? `${h.min}ms` : '—'}</td>
                                    <td style={{ padding: '10px', color: 'var(--color-warning)' }}>{h.max ? `${h.max}ms` : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </DiagPanel>
    )
}

// ─── Port Checker (single port) ──────────────────────────────────────────
const COMMON_PORTS = [
    { p: 21, l: 'FTP' }, { p: 22, l: 'SSH' }, { p: 25, l: 'SMTP' },
    { p: 53, l: 'DNS' }, { p: 80, l: 'HTTP' }, { p: 443, l: 'HTTPS' },
    { p: 3306, l: 'MySQL' }, { p: 3389, l: 'RDP' }, { p: 5432, l: 'Postgres' },
    { p: 8080, l: 'Alt HTTP' },
]

function PortCheckPanel() {
    const [host, setHost] = useState('')
    const [port, setPort] = useState('443')
    const [result, setResult] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    async function check() {
        const pureHost = normalizeTargetInput(host)
        const portNum = parseInt(port, 10)
        if (!isValidTarget(pureHost)) { setError('Enter a valid host or IP'); return }
        if (!portNum || portNum < 1 || portNum > 65535) { setError('Enter a valid port (1-65535)'); return }
        setError(null); setLoading(true); setResult(null)
        try {
            const res = await bridge.checkPort(pureHost, portNum, 5000)
            setResult({ host: pureHost, port: portNum, ...res })
        } catch (err) {
            setResult({ host: pureHost, port: portNum, open: false, error: err?.message })
        }
        setLoading(false)
    }

    return (
        <DiagPanel title="Port Checker" icon={ArrowRight} description="Quick connectivity test for a specific port on any host">
            <div className="diag-controls-row">
                <div style={{ flex: 1, position: 'relative' }}>
                    <Server size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                    <input className="v3-input" style={{ paddingLeft: 38 }} value={host} onChange={e => setHost(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && check()} placeholder="Host or IP (e.g. google.com)" />
                </div>
                <input className="v3-input mono" style={{ width: 90 }} value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={e => e.key === 'Enter' && check()} placeholder="Port" />
                <button className="v3-btn v3-btn-primary" onClick={check} disabled={loading || !host.trim() || !port}>
                    {loading ? <Loader2 size={16} className="spin-icon" /> : 'Check'}
                </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {COMMON_PORTS.map(cp => (
                    <button key={cp.p}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '4px 10px', fontSize: 12, fontFamily: 'var(--font-mono)',
                            border: `1px solid ${port === String(cp.p) ? 'var(--color-accent)' : 'var(--border-light)'}`,
                            borderRadius: 'var(--radius-full)',
                            background: port === String(cp.p) ? 'var(--color-accent-ghost)' : 'var(--bg-surface)',
                            color: port === String(cp.p) ? 'var(--color-accent)' : 'var(--text-secondary)',
                            cursor: 'pointer', transition: 'all 120ms ease',
                        }}
                        onClick={() => setPort(String(cp.p))}>
                        {cp.p} <span style={{ opacity: 0.6 }}>{cp.l}</span>
                    </button>
                ))}
            </div>

            {error && <div style={{ color:'var(--color-danger)', fontSize:13, display:'flex', alignItems:'center', gap:6, marginBottom:16 }}><AlertCircle size={14}/>{error}</div>}

            {loading && <div style={{ color: 'var(--text-muted)', margin: '12px 0' }}><Loader2 size={16} className="spin-icon" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} /> Testing {host}:{port}...</div>}

            {result && (
                <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 18px',
                    borderRadius: 'var(--radius-md)', fontSize: 13, lineHeight: 1.5,
                    background: result.open ? 'var(--color-success-bg)' : 'var(--color-danger-bg)',
                    color: result.open ? '#15803d' : '#dc2626',
                    border: `1px solid ${result.open ? 'var(--color-success-border)' : 'var(--color-danger-border)'}`,
                }}>
                    {result.open ? <CheckCircle size={20} /> : <XCircle size={20} />}
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{result.host}:{result.port} is {result.open ? 'Open' : 'Closed / Filtered'}</div>
                        {result.time != null && <div style={{ fontSize: 13, opacity: 0.9 }}>Response in {result.time} ms</div>}
                        {result.error && <div style={{ fontSize: 13, opacity: 0.9 }}>{result.error}</div>}
                    </div>
                </div>
            )}
        </DiagPanel>
    )
}

// ─── Main Page ────────────────────────────────────────────────────────────
const SECTIONS = [
    { id: 'traceroute', label: 'Traceroute Explorer', Icon: Rss, Panel: TraceroutePanel },
    { id: 'ping', label: 'Live Ping Terminal', Icon: TerminalSquare, Panel: PingPanel },
    { id: 'mtr', label: 'MTR Analysis', Icon: RadioReceiver, Panel: MtrPanel },
    { id: 'dns', label: 'DNS Resolution', Icon: Globe, Panel: DnsPanel },
    { id: 'portcheck', label: 'Port Checker', Icon: ArrowRight, Panel: PortCheckPanel },
    { id: 'ports', label: 'Port Scanner', Icon: Server, Panel: PortScanPanel },
]

export default function Diagnostics() {
    const [active, setActive] = useState('traceroute')
    const ActivePanel = SECTIONS.find(s => s.id === active)?.Panel

    return (
        <div className="v3-page-layout page-enter">
            <div className="v3-page-header">
                <h1 className="v3-page-title"><Activity size={24} color="var(--color-accent)" /> Active Diagnostics</h1>
                <p className="v3-page-subtitle">Real-time troubleshooting engines and trace logs</p>
            </div>

            <div className="pill-tabs">
                {SECTIONS.map(({ id, label, Icon }) => (
                    <button
                        key={id}
                        className={`pill-tab ${active === id ? 'active' : ''}`}
                        onClick={() => setActive(id)}
                    >
                        <Icon size={16} />
                        <span>{label}</span>
                    </button>
                ))}
            </div>

            {ActivePanel && <ActivePanel key={active} />}
        </div>
    )
}

