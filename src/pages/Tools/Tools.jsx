import { useState, useEffect } from 'react'
import {
    Wrench, Fingerprint, Search, Network, RadioReceiver, Zap,
    Shield, Loader2, CheckCircle, XCircle, AlertTriangle, AlertCircle
} from 'lucide-react'
import bridge from '../../lib/electronBridge'
import { isValidHostname, isValidMac, isValidTarget, normalizeMac, normalizeTargetInput } from '../../lib/validation'
import './Tools.css'

// ─── Shared Tool Layout ───────────────────────────────────────────────────
function ToolCard({ title, icon: Icon, description, children }) {
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

// ─── 1. SSL Certificate Checker ───────────────────────────────────────────
function SslChecker() {
    const [host, setHost] = useState('google.com')
    const [result, setResult] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    async function check() {
        const pureHost = normalizeTargetInput(host)
        if (!isValidHostname(pureHost)) { setError('Enter a valid domain (e.g. google.com)'); return }
        setError(null); setLoading(true); setResult(null)
        const res = await bridge.sslCheck(pureHost)
        setResult(res)
        setLoading(false)
        if (res?.subject) {
            bridge.historyAdd({ module: 'Tools', type: 'SSL Check', detail: pureHost, results: res })
        }
    }

    return (
        <ToolCard title="SSL Checker" icon={Shield} description="Verify HTTPS certificate details, issuance, and expiry dates">
            <div className="tool-controls-row">
                <div style={{ flex: 1, position: 'relative' }}>
                    <Shield size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                    <input className="v3-input" style={{ paddingLeft: 38 }} value={host} onChange={e => setHost(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && check()} placeholder="Domain name (e.g. example.com)" />
                </div>
                <button className="v3-btn v3-btn-primary" onClick={check} disabled={loading || !host.trim()}>
                    {loading ? <Loader2 size={16} className="spin-icon" /> : 'Check SSL'}
                </button>
            </div>

            {error && <div style={{ color:'var(--color-danger)', fontSize:13, display:'flex', alignItems:'center', gap:6, marginBottom:16 }}><AlertCircle size={14}/>{error}</div>}

            {loading && <div style={{ color: 'var(--text-muted)', margin: '20px 0' }}><Loader2 size={16} className="spin-icon" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} /> Inspecting certificate chain...</div>}

            {result?.error && (
                <div className="tool-alert error">
                    <XCircle size={18} style={{ flexShrink: 0 }} />
                    <div><strong>Connection Failed</strong><br />{result.error}</div>
                </div>
            )}

            {result?.subject && (
                <div>
                    <div className={`tool-alert ${result.expired ? 'error' : 'success'}`} style={{ marginBottom: 16 }}>
                        {result.expired ? <XCircle size={24} /> : <CheckCircle size={24} />}
                        <div>
                            <div style={{ fontSize: 15, fontWeight: 600 }}>{result.expired ? 'Certificate Expired' : 'Certificate is Valid'}</div>
                            <div style={{ fontSize: 13, opacity: 0.9 }}>Expires: {new Date(result.validTo).toLocaleString()} ({result.daysLeft} days left)</div>
                        </div>
                    </div>

                    <div className="ssl-grid">
                        {[
                            { l: 'Subject', v: result.subject },
                            { l: 'Issuer', v: result.issuer },
                            { l: 'Valid From', v: new Date(result.validFrom).toLocaleString() },
                            { l: 'Protocol', v: result.protocol },
                            { l: 'Fingerprint', v: result.fingerprint, mono: true },
                            { l: 'Alt Names (SAN)', v: result.san, mono: true }
                        ].map(it => (
                            <div key={it.l} className="ssl-grid-item">
                                <div className="v3-label-sm">{it.l}</div>
                                <div className={`v3-metric-value ${it.mono ? 'mono' : ''}`} style={{ fontSize: 14, fontWeight: it.mono ? 400 : 500 }}>{it.v || '—'}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </ToolCard>
    )
}

// ─── 2. Whois Lookup ──────────────────────────────────────────────────────
function WhoisLookup() {
    const [query, setQuery] = useState('google.com')
    const [result, setResult] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    async function lookup() {
        const pureQuery = normalizeTargetInput(query)
        if (!isValidTarget(pureQuery)) { setError('Enter a valid domain or IP (e.g. google.com or 8.8.8.8)'); return }
        setError(null); setLoading(true); setResult(null)
        const res = await bridge.whois(pureQuery)
        setResult(res)
        setLoading(false)
        bridge.historyAdd({ module: 'Tools', type: 'Whois', detail: pureQuery })
    }

    return (
        <ToolCard title="Whois Lookup" icon={Fingerprint} description="Query domain registration, registrar, and IP ownership records">
            <div className="tool-controls-row">
                <div style={{ flex: 1, position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                    <input className="v3-input" style={{ paddingLeft: 38 }} value={query} onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && lookup()} placeholder="Domain or IP address" />
                </div>
                <button className="v3-btn v3-btn-primary" onClick={lookup} disabled={loading || !query.trim()}>
                    {loading ? <Loader2 size={16} className="spin-icon" /> : 'Lookup Info'}
                </button>
            </div>

            {error && <div style={{ color:'var(--color-danger)', fontSize:13, display:'flex', alignItems:'center', gap:6, marginBottom:16 }}><AlertCircle size={14}/>{error}</div>}

            {loading && <div style={{ color: 'var(--text-muted)' }}><Loader2 size={16} className="spin-icon" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} /> Querying authoritative databases...</div>}

            {result?.error && (
                <div className="tool-alert error"><AlertCircle size={18} /> Error fetching record: {result.error}</div>
            )}

            {result?.raw && (
                <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Source: {result.server}</div>
                    <pre className="terminal-output">{result.raw}</pre>
                </div>
            )}
        </ToolCard>
    )
}

// ─── 3. Local ARP Table ───────────────────────────────────────────────────
function ArpTable() {
    const [table, setTable] = useState(null)
    const [loading, setLoading] = useState(false)

    async function fetchArp() {
        setLoading(true)
        const res = await bridge.getArpTable()
        setTable(res || [])
        setLoading(false)
    }

    useEffect(() => { fetchArp() }, [])

    return (
        <ToolCard title="ARP Cache" icon={Network} description="View all MAC-to-IP resolution mappings currently cached by the OS layer">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                <button className="v3-btn v3-btn-secondary" onClick={fetchArp} disabled={loading}>
                    {loading ? <Loader2 size={14} className="spin-icon" /> : 'Refresh Cache'}
                </button>
            </div>

            {loading && !table ? (
                <div style={{ padding: '20px 0', color: 'var(--text-muted)' }}><Loader2 size={16} className="spin-icon" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} /> Reading ARP tables...</div>
            ) : table?.length ? (
                <div style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                        <thead style={{ background: 'var(--bg-app)', borderBottom: '1px solid var(--border-strong)' }}>
                            <tr>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)' }}>IP Address</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)' }}>Physical Address (MAC)</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)' }}>Allocation</th>
                            </tr>
                        </thead>
                        <tbody>
                            {table.map((row, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--bg-surface)' }}>
                                    <td className="mono" style={{ padding: '12px 16px', color: 'var(--color-info)' }}>{row.ip}</td>
                                    <td className="mono" style={{ padding: '12px 16px' }}>{row.mac}</td>
                                    <td style={{ padding: '12px 16px' }}>
                                        <span className={`v3-badge ${row.type === 'static' ? 'warning' : 'success'}`}>{row.type}</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : table && table.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', padding: '40px', textAlign: 'center', background: 'var(--bg-app)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-light)' }}>
                    <Network size={32} style={{ opacity: 0.3, marginBottom: 16, margin: '0 auto' }} />
                    <div>No ARP entries found in cache.</div>
                </div>
            ) : null}
        </ToolCard>
    )
}

// ─── 4. MTR (My Traceroute) ───────────────────────────────────────────────
function Mtr() {
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
        <ToolCard title="MTR Diagnostic" icon={RadioReceiver} description="Combines traceroute and ping into a continuous connection quality monitor">
            <div className="tool-controls-row">
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
        </ToolCard>
    )
}

// ─── 5. Wake on LAN ───────────────────────────────────────────────────────
function WakeOnLan() {
    const [mac, setMac] = useState('')
    const [result, setResult] = useState(null)
    const [sending, setSending] = useState(false)
    const [error, setError] = useState(null)

    async function sendPacket() {
        const pureMac = normalizeMac(mac)
        if (!isValidMac(pureMac)) { setError('Enter a valid MAC (e.g. 00:1A:2B:3C:4D:5E)'); return }
        setError(null); setSending(true); setResult(null)
        setMac(pureMac)
        const res = await bridge.wakeOnLan(pureMac)
        setResult(res)
        setSending(false)
        if (res?.success) bridge.historyAdd({ module: 'Tools', type: 'Wake-on-LAN', detail: pureMac })
    }

    return (
        <ToolCard title="Wake-on-LAN (WoL)" icon={Zap} description="Broadcast a magic packet to turn on compatible local network devices">
            <div style={{ maxWidth: 400 }}>
                <div style={{ marginBottom: 16 }}>
                    <label className="v3-label-sm" style={{ marginBottom: 8 }}>Target Physical MAC Address</label>
                    <input className="v3-input mono" style={{ width: '100%' }} value={mac} onChange={e => setMac(e.target.value)}
                        placeholder="e.g. 00:1A:2B:3C:4D:5E" onKeyDown={e => e.key === 'Enter' && sendPacket()} />
                </div>
                {error && <div style={{ color:'var(--color-danger)', fontSize:13, display:'flex', alignItems:'center', gap:6, marginBottom:8 }}><AlertCircle size={14}/>{error}</div>}
                <button className="v3-btn v3-btn-primary" style={{ width: '100%' }} onClick={sendPacket} disabled={sending || mac.length < 12}>
                    {sending ? <Loader2 size={16} className="spin-icon" /> : <><Zap size={16} /> Broadcast Magic Packet</>}
                </button>
            </div>

            {result && (
                <div className={`tool-alert ${result.error ? 'error' : 'success'}`} style={{ marginTop: 24 }}>
                    {result.error
                        ? <><AlertCircle size={18} style={{ flexShrink: 0 }} /> Failed to send: {result.error}</>
                        : <><CheckCircle size={18} style={{ flexShrink: 0 }} /> Magic packet successfully broadcasted to {mac}</>}
                </div>
            )}
        </ToolCard>
    )
}

// ─── Main Tools Layout ────────────────────────────────────────────────────
const TOOLS = [
    { id: 'ssl', label: 'SSL Chain Inspector', Icon: Shield, Component: SslChecker },
    { id: 'whois', label: 'Whois Records', Icon: Fingerprint, Component: WhoisLookup },
    { id: 'arp', label: 'Local ARP Cache', Icon: Network, Component: ArpTable },
    { id: 'mtr', label: 'MTR Analysis', Icon: RadioReceiver, Component: Mtr },
    { id: 'wol', label: 'Wake-on-LAN', Icon: Zap, Component: WakeOnLan },
]

export default function Tools() {
    const [active, setActive] = useState('ssl')
    const ActiveComp = TOOLS.find(t => t.id === active)?.Component

    return (
        <div className="v3-page-layout page-enter">
            <div className="v3-page-header">
                <h1 className="v3-page-title"><Wrench size={24} color="var(--color-accent)" /> Protocol Utilities</h1>
                <p className="v3-page-subtitle">Low-level diagnostic tools and packet inspectors</p>
            </div>

            <div className="pill-tabs">
                {TOOLS.map(({ id, label, Icon }) => (
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

            {ActiveComp && <ActiveComp key={active} />}
        </div>
    )
}

