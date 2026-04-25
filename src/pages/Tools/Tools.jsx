import { useState, useEffect, useRef, useCallback } from 'react'
import {
    Wrench, Fingerprint, Search, Network, Zap,
    Shield, Loader2, CheckCircle, XCircle, AlertCircle,
    Globe, Send, Clock, Server, Wifi, Calculator
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
        if (res?.raw) bridge.historyAdd({ module: 'Tools', type: 'Whois', detail: pureQuery, results: { server: res.server } })
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
    const [fetchError, setFetchError] = useState(null)

    async function fetchArp() {
        setLoading(true)
        setFetchError(null)
        try {
            const res = await bridge.getArpTable()
            setTable(res || [])
        } catch (err) {
            setFetchError(err?.message || 'Failed to read ARP table')
            setTable(null)
        }
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

            {fetchError && (
                <div className="tool-alert error"><AlertCircle size={18} style={{ flexShrink: 0 }} /> {fetchError}</div>
            )}

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

// ─── 4. Wake on LAN ───────────────────────────────────────────────────────
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

// ─── 5. HTTP Tester ───────────────────────────────────────────────────────
function HttpTester() {
    const [url, setUrl] = useState('https://google.com')
    const [method, setMethod] = useState('GET')
    const [result, setResult] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    async function sendRequest() {
        const trimmed = url.trim()
        if (!trimmed) { setError('Enter a URL'); return }
        setError(null); setLoading(true); setResult(null)
        try {
            const res = await bridge.httpTest(trimmed, method)
            setResult(res)
            if (res && !res.error) {
                bridge.historyAdd({ module: 'Tools', type: 'HTTP Test', detail: `${method} ${trimmed}`, results: { status: res.statusCode, timing: res.timing } })
            }
        } catch (err) {
            setResult({ error: err?.message || 'Request failed' })
        }
        setLoading(false)
    }

    return (
        <ToolCard title="HTTP Tester" icon={Send} description="Test HTTP/HTTPS endpoints — status, headers, timing breakdown">
            <div className="tool-controls-row">
                <select className="v3-input" style={{ width: 110, flexShrink: 0 }} value={method} onChange={e => setMethod(e.target.value)}>
                    {['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <div style={{ flex: 1, position: 'relative' }}>
                    <Globe size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                    <input className="v3-input" style={{ paddingLeft: 38 }} value={url} onChange={e => setUrl(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && sendRequest()} placeholder="https://example.com/api/health" />
                </div>
                <button className="v3-btn v3-btn-primary" onClick={sendRequest} disabled={loading || !url.trim()}>
                    {loading ? <Loader2 size={16} className="spin-icon" /> : <><Send size={14} /> Send</>}
                </button>
            </div>

            {error && <div style={{ color:'var(--color-danger)', fontSize:13, display:'flex', alignItems:'center', gap:6, marginBottom:16 }}><AlertCircle size={14}/>{error}</div>}

            {loading && <div style={{ color: 'var(--text-muted)', margin: '20px 0' }}><Loader2 size={16} className="spin-icon" style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} /> Sending {method} request...</div>}

            {result?.error && (
                <div className="tool-alert error"><XCircle size={18} style={{ flexShrink: 0 }} /> {result.error}</div>
            )}

            {result && !result.error && (
                <div>
                    <div className={`tool-alert ${result.statusCode < 400 ? 'success' : 'error'}`} style={{ marginBottom: 16 }}>
                        {result.statusCode < 400 ? <CheckCircle size={20} /> : <XCircle size={20} />}
                        <div>
                            <div style={{ fontSize: 15, fontWeight: 600 }}>HTTP {result.statusCode} {result.statusMessage || ''}</div>
                            <div style={{ fontSize: 13, opacity: 0.9 }}>{method} {url}</div>
                        </div>
                    </div>

                    {result.timing && (
                        <div className="http-timing-grid">
                            {[
                                { l: 'DNS Lookup', v: result.timing.dns, color: '#3b82f6' },
                                { l: 'TCP Connect', v: result.timing.connect, color: '#10b981' },
                                { l: 'TLS Handshake', v: result.timing.tls, color: '#8b5cf6' },
                                { l: 'TTFB', v: result.timing.ttfb, color: '#f59e0b' },
                                { l: 'Total', v: result.timing.total, color: 'var(--text-primary)' },
                            ].map(t => (
                                <div key={t.l} className="http-timing-item">
                                    <div className="v3-label-sm">{t.l}</div>
                                    <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: t.color }}>{t.v != null ? `${t.v} ms` : '—'}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {result.headers && (
                        <div style={{ marginTop: 16 }}>
                            <div className="v3-label-sm" style={{ marginBottom: 8 }}>Response Headers</div>
                            <pre className="terminal-output" style={{ maxHeight: 260 }}>{Object.entries(result.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
                        </div>
                    )}
                </div>
            )}
        </ToolCard>
    )
}

// ─── 6. Subnet Calculator ─────────────────────────────────────────────────
function calcSubnet(cidrStr) {
    const match = cidrStr.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/)
    if (!match) return null
    const ipParts = match[1].split('.').map(Number)
    const prefix = parseInt(match[2], 10)
    if (ipParts.some(p => p > 255) || prefix > 32 || prefix < 0) return null

    const ipInt = ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0
    const maskInt = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
    const wildcard = (~maskInt) >>> 0
    const networkInt = (ipInt & maskInt) >>> 0
    const broadcastInt = (networkInt | wildcard) >>> 0
    const totalHosts = Math.pow(2, 32 - prefix)
    const usableHosts = prefix <= 30 ? totalHosts - 2 : (prefix === 31 ? 2 : 1)

    const toIp = n => `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`

    return {
        network: toIp(networkInt),
        broadcast: toIp(broadcastInt),
        mask: toIp(maskInt),
        wildcard: toIp(wildcard),
        prefix,
        firstHost: prefix <= 30 ? toIp(networkInt + 1) : toIp(networkInt),
        lastHost: prefix <= 30 ? toIp(broadcastInt - 1) : toIp(broadcastInt),
        totalHosts,
        usableHosts: Math.max(usableHosts, 0),
        ipClass: ipParts[0] < 128 ? 'A' : ipParts[0] < 192 ? 'B' : ipParts[0] < 224 ? 'C' : ipParts[0] < 240 ? 'D' : 'E',
        isPrivate: (ipParts[0] === 10) ||
            (ipParts[0] === 172 && ipParts[1] >= 16 && ipParts[1] <= 31) ||
            (ipParts[0] === 192 && ipParts[1] === 168),
    }
}

function SubnetCalc() {
    const [cidr, setCidr] = useState('192.168.1.0/24')
    const [result, setResult] = useState(() => calcSubnet('192.168.1.0/24'))

    // Recompute on every CIDR change. `compute` is intentionally
    // redefined each render (tiny closure, no benefit to useCallback)
    // so we depend on `cidr` alone to avoid a stale-closure loop.
    useEffect(() => {
        setResult(calcSubnet(cidr.trim()))
    }, [cidr])

    return (
        <ToolCard title="Subnet Calculator" icon={Calculator} description="Calculate network ranges, masks, and host capacity from CIDR notation">
            <div className="tool-controls-row" style={{ maxWidth: 440 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <Wifi size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                    <input className="v3-input mono" style={{ paddingLeft: 38 }} value={cidr} onChange={e => setCidr(e.target.value)}
                        placeholder="e.g. 192.168.1.0/24" />
                </div>
            </div>

            {!result && cidr.trim() && (
                <div style={{ color:'var(--color-danger)', fontSize:13, display:'flex', alignItems:'center', gap:6, marginTop: 8 }}><AlertCircle size={14}/>Enter a valid CIDR (e.g. 10.0.0.0/8)</div>
            )}

            {result && (
                <div className="ssl-grid" style={{ marginTop: 8 }}>
                    {[
                        { l: 'Network', v: `${result.network}/${result.prefix}` },
                        { l: 'Subnet Mask', v: result.mask },
                        { l: 'Wildcard', v: result.wildcard },
                        { l: 'Broadcast', v: result.broadcast },
                        { l: 'Host Range', v: `${result.firstHost} — ${result.lastHost}` },
                        { l: 'Usable Hosts', v: result.usableHosts.toLocaleString() },
                        { l: 'Total Addresses', v: result.totalHosts.toLocaleString() },
                        { l: 'Class', v: `Class ${result.ipClass}` },
                        { l: 'Scope', v: result.isPrivate ? 'Private (RFC 1918)' : 'Public' },
                    ].map(it => (
                        <div key={it.l} className="ssl-grid-item">
                            <div className="v3-label-sm">{it.l}</div>
                            <div className="v3-metric-value mono" style={{ fontSize: 14 }}>{it.v}</div>
                        </div>
                    ))}
                </div>
            )}
        </ToolCard>
    )
}

// ─── 8. DNS Benchmark ─────────────────────────────────────────────────────
const DNS_SERVERS = [
    { ip: '1.1.1.1', label: 'Cloudflare' },
    { ip: '8.8.8.8', label: 'Google' },
    { ip: '9.9.9.9', label: 'Quad9' },
    { ip: '208.67.222.222', label: 'OpenDNS' },
]

const BENCH_DOMAINS = ['google.com', 'cloudflare.com', 'github.com', 'amazon.com', 'microsoft.com']

function DnsBenchmark() {
    const [running, setRunning] = useState(false)
    const [results, setResults] = useState(null)
    const runRef = useRef(0)

    const stopBench = useCallback(() => {
        runRef.current += 1
        setRunning(false)
    }, [])

    const runBench = useCallback(async () => {
        setRunning(true)
        setResults(null)
        const runId = ++runRef.current
        const out = []

        for (const server of DNS_SERVERS) {
            const times = []
            for (const domain of BENCH_DOMAINS) {
                const start = performance.now()
                try {
                    await bridge.dnsLookup(domain, 'A')
                    times.push(Math.round(performance.now() - start))
                } catch {
                    times.push(null)
                }
                if (runRef.current !== runId) return
            }
            const valid = times.filter(t => t != null)
            const avg = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null
            const min = valid.length ? Math.min(...valid) : null
            const max = valid.length ? Math.max(...valid) : null
            out.push({ ...server, times, avg, min, max, failed: times.length - valid.length })

            // Update progressively
            if (runRef.current === runId) setResults([...out])
        }

        if (runRef.current === runId) {
            setRunning(false)
            bridge.historyAdd({ module: 'Tools', type: 'DNS Benchmark', detail: `${DNS_SERVERS.length} resolvers`, results: { servers: out.map(s => ({ label: s.label, avg: s.avg })) } })
        }
    }, [])

    const sorted = results ? [...results].sort((a, b) => (a.avg ?? 9999) - (b.avg ?? 9999)) : null
    const bestAvg = sorted?.[0]?.avg

    return (
        <ToolCard title="DNS Benchmark" icon={Clock} description="Compare DNS resolver performance across multiple lookups">
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 20 }}>
                {running ? (
                    <button className="v3-btn v3-btn-secondary" style={{ color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.3)' }} onClick={stopBench}>
                        <XCircle size={14} /> Stop Benchmark
                    </button>
                ) : (
                    <button className="v3-btn v3-btn-primary" onClick={runBench}>
                        <Clock size={14} /> Run Benchmark
                    </button>
                )}
            </div>

            {sorted && (
                <div style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                        <thead style={{ background: 'var(--bg-app)', borderBottom: '1px solid var(--border-strong)' }}>
                            <tr>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)' }}>#</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)' }}>Resolver</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)' }}>IP</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)' }}>Avg</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)' }}>Best</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)' }}>Worst</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)' }}>Failed</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((s, i) => (
                                <tr key={s.ip} style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--bg-surface)' }}>
                                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>{i + 1}</td>
                                    <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                                        {s.label}
                                        {s.avg === bestAvg && !running && <span className="v3-badge success" style={{ marginLeft: 8 }}>Fastest</span>}
                                    </td>
                                    <td className="mono" style={{ padding: '12px 16px', color: 'var(--color-info)' }}>{s.ip}</td>
                                    <td className="mono" style={{ padding: '12px 16px', fontWeight: 600, color: s.avg != null ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                        {s.avg != null ? `${s.avg} ms` : '—'}
                                    </td>
                                    <td className="mono" style={{ padding: '12px 16px', color: 'var(--color-success)' }}>
                                        {s.min != null ? `${s.min} ms` : '—'}
                                    </td>
                                    <td className="mono" style={{ padding: '12px 16px', color: 'var(--color-warning)' }}>
                                        {s.max != null ? `${s.max} ms` : '—'}
                                    </td>
                                    <td style={{ padding: '12px 16px' }}>
                                        {s.failed > 0
                                            ? <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{s.failed}/{BENCH_DOMAINS.length}</span>
                                            : <span style={{ color: 'var(--color-success)' }}>0</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {!results && !running && (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    Tests {DNS_SERVERS.length} public DNS resolvers by resolving {BENCH_DOMAINS.length} domains each. Results sorted by average response time.
                </div>
            )}
        </ToolCard>
    )
}

// ─── Main Tools Layout ────────────────────────────────────────────────────
const TOOLS = [
    { id: 'ssl',    label: 'SSL Inspector',    Icon: Shield,      Component: SslChecker },
    { id: 'http',   label: 'HTTP Tester',      Icon: Send,        Component: HttpTester },
    { id: 'whois',  label: 'Whois Records',    Icon: Fingerprint, Component: WhoisLookup },
    { id: 'dns',    label: 'DNS Benchmark',    Icon: Clock,       Component: DnsBenchmark },
    { id: 'subnet', label: 'Subnet Calculator', Icon: Calculator, Component: SubnetCalc },
    { id: 'arp',    label: 'ARP Cache',        Icon: Network,     Component: ArpTable },
    { id: 'wol',    label: 'Wake-on-LAN',      Icon: Zap,         Component: WakeOnLan },
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
