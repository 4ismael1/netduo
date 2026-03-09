import { useState, useEffect } from 'react'
import { History as HistoryIcon, Trash2, RefreshCw, Clock, Activity, Gauge, Radar, Wrench, Network, ChevronLeft, ChevronRight } from 'lucide-react'
import bridge from '../../lib/electronBridge'
import { logBridgeWarning } from '../../lib/devLog.js'

const MODULE_META = {
    Dashboard: { color: 'var(--color-accent)', Icon: Activity },
    Diagnostics: { color: 'var(--color-info)', Icon: Activity },
    'Speed Test': { color: 'var(--color-success)', Icon: Gauge },
    Monitor: { color: 'var(--color-warning)', Icon: Activity },
    'LAN Scanner': { color: 'var(--color-danger)', Icon: Radar },
    Tools: { color: '#EF4444', Icon: Wrench },
    'Network Info': { color: '#8B5CF6', Icon: Network },
}

const PER_PAGE = 10

export default function History() {
    const [history, setHistory] = useState([])
    const [filter, setFilter] = useState('All')
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(0)

    useEffect(() => {
        bridge.historyGet().then(h => {
            setHistory(h || [])
            setLoading(false)
        }).catch(error => {
            logBridgeWarning('history:load', error)
            setLoading(false)
        })
    }, [])

    const modules = ['All', ...new Set(history.map(h => h.module).filter(Boolean))]
    const filtered = filter === 'All' ? history : history.filter(h => h.module === filter)
    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
    const pagedFiltered = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
    const fmt = ts => {
        try {
            const d = new Date(ts)
            if (isNaN(d)) return ts
            return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
                ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
        } catch { return ts }
    }

    async function clearAll() {
        try {
            const h = await bridge.historyClear()
            setHistory(h || [])
        } catch (error) {
            logBridgeWarning('history:clear', error)
            setHistory([])
        }
    }
    async function refresh() {
        setLoading(true)
        try {
            const h = await bridge.historyGet()
            setHistory(h || [])
        } catch (error) {
            logBridgeWarning('history:refresh', error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="v3-page-layout page-enter">
            <div className="v3-page-header">
                <h1 className="v3-page-title"><HistoryIcon size={24} color="var(--color-accent)" /> History</h1>
                <p className="v3-page-subtitle">Log of all network tests, scans, and diagnostics</p>
            </div>

            {/* Summary stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24, marginBottom: 24 }}>
                {[
                    { label: 'Total Records', value: history.length },
                    { label: 'Modules Used', value: new Set(history.map(h => h.module)).size },
                    { label: 'Today', value: history.filter(h => new Date(h.timestamp).toDateString() === new Date().toDateString()).length },
                ].map(({ label, value }) => (
                    <div className="v3-card" key={label} style={{ display: 'flex', flexDirection: 'column', padding: 24 }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                            <Clock size={16} style={{ color: 'var(--color-accent)' }} /> {label}
                        </div>
                        <div className="mono" style={{ fontSize: 36, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
                    </div>
                ))}
            </div>

            <div className="v3-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div className="v3-card-header" style={{ marginBottom: 24 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        {modules.map(m => (
                            <button key={m} className={`v3-btn ${filter === m ? 'v3-btn-primary' : 'v3-btn-secondary'}`} style={{ padding: '6px 12px', fontSize: 12 }}
                                onClick={() => { setFilter(m); setPage(0) }}>{m}</button>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button className="v3-btn v3-btn-secondary" onClick={refresh}><RefreshCw size={14} />Refresh</button>
                        <button className="v3-btn" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)', border: '1px solid rgba(239, 68, 68, 0.3)' }} onClick={clearAll} disabled={!history.length}><Trash2 size={14} />Clear</button>
                    </div>
                </div>

                {loading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-muted)', padding: '60px 0', height: 200 }}>
                        <div className="spinner" />Loading history...
                    </div>
                ) : filtered.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', padding: '80px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                        <HistoryIcon size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
                        <div>No records yet. Run some tests to see history here.</div>
                    </div>
                ) : (
                    <>
                    <div style={{ overflowX: 'auto' }}>
                        <table className="np-table">
                            <thead>
                                <tr><th>Time</th><th>Module</th><th>Type</th><th>Detail</th></tr>
                            </thead>
                            <tbody>
                                {pagedFiltered.map(h => {
                                    const meta = MODULE_META[h.module] || { color: 'var(--color-accent)', Icon: Activity }
                                    return (
                                        <tr key={h.id}>
                                            <td className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmt(h.timestamp)}</td>
                                            <td>
                                                <span className="v3-badge" style={{ background: `color-mix(in srgb, ${meta.color} 15%, transparent)`, color: meta.color, border: `1px solid color-mix(in srgb, ${meta.color} 30%, transparent)` }}>
                                                    <meta.Icon size={12} style={{ marginRight: 6, display: 'inline' }} />
                                                    {h.module || '—'}
                                                </span>
                                            </td>
                                            <td style={{ fontSize: 13, fontWeight: 500 }}>{h.type || '—'}</td>
                                            <td className="mono" style={{ fontSize: 13, color: 'var(--color-info)', fontWeight: 500 }}>{h.detail || '—'}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                    {totalPages > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid var(--border-subtle)' }}>
                            <button className="v3-btn v3-btn-secondary" style={{ padding: '4px 8px', minWidth: 28 }} disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                                <ChevronLeft size={14} />
                            </button>
                            <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>{page + 1} / {totalPages}</span>
                            <button className="v3-btn v3-btn-secondary" style={{ padding: '4px 8px', minWidth: 28 }} disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    )}
                    </>
                )}
            </div>
        </div>
    )
}
