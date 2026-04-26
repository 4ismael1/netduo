import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Palette, Bell, Globe, Info, Moon, Sun, Github, ExternalLink, CircleDot, Shield, Trash2, CheckCircle2 } from 'lucide-react'
import bridge from '../../lib/electronBridge'
import { logBridgeWarning } from '../../lib/devLog.js'
import './Settings.css'

const ACCENTS = [
    { name: 'Blue', value: '#3B82F6' },
    { name: 'Indigo', value: '#6366F1' },
    { name: 'Cyan', value: '#06B6D4' },
    { name: 'Teal', value: '#14B8A6' },
    { name: 'Emerald', value: '#10B981' },
    { name: 'Lime', value: '#84CC16' },
    { name: 'Violet', value: '#8B5CF6' },
    { name: 'Fuchsia', value: '#D946EF' },
    { name: 'Rose', value: '#F43F5E' },
    { name: 'Red', value: '#EF4444' },
    { name: 'Orange', value: '#F97316' },
    { name: 'Amber', value: '#F59E0B' },
    { name: 'Sky', value: '#0EA5E9' },
    { name: 'Nothing Red', value: '#D71921' },
]

const DEFAULT_ACCENT = '#3b82f6'
const NOTHING_ACCENT = '#D71921'

function applyCSSAccent(color) {
    document.documentElement.style.setProperty('--color-accent', color)
    document.documentElement.style.setProperty('--color-accent-hover', shiftColor(color, -20))
    document.documentElement.style.setProperty('--accent-glow', color + '66')
    document.documentElement.style.setProperty('--color-accent-ghost', color + '22')
    document.documentElement.style.setProperty('--text-accent', color)
    document.documentElement.style.setProperty('--border-focus', color)
}

function shiftColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16)
    const r = Math.max(0, Math.min(255, (num >> 16) + amount))
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0xFF) + amount))
    const b = Math.max(0, Math.min(255, (num & 0xFF) + amount))
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`
}

function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode)
    document.documentElement.style.colorScheme = mode === 'light' ? 'light' : 'dark'
}

function persistThemePreference(mode) {
    try {
        localStorage.setItem('netduo.theme', mode)
        return true
    } catch {
        return false
    }
}

function setThemeMode(mode, setTheme, setAccent) {
    setTheme(mode)
    applyTheme(mode)
    persistThemePreference(mode)
    // When switching to Nothing, apply Nothing Red as default accent
    if (mode === 'nothing' && setAccent) {
        setAccent(NOTHING_ACCENT)
        applyCSSAccent(NOTHING_ACCENT)
        bridge.configSet('accentColor', NOTHING_ACCENT).catch(() => {})
    }
    bridge.configSet('theme', mode).catch(error => {
        logBridgeWarning('settings:theme', error)
        return false
    })
}

function persistSetting(key, value) {
    return bridge.configSet(key, value).catch(error => {
        logBridgeWarning(`settings:${key}`, error)
        return false
    })
}

export default function Settings() {
    const [accent, setAccent] = useState(DEFAULT_ACCENT)
    const [theme, setTheme] = useState('light')
    const [interval, setInterval] = useState('2')
    const [notifs, setNotifs] = useState(true)
    const [notifyNewDevices, setNotifyNewDevices] = useState(true)
    const [macVendorOnline, setMacVendorOnline] = useState(true)
    const [latencyThr, setLatencyThr] = useState('200')
    const [clearStatus, setClearStatus] = useState(null) // 'confirm' | 'ok' | 'error' | null
    const [clearBusy, setClearBusy] = useState(false)

    async function handleClearInventory() {
        if (clearStatus !== 'confirm') {
            setClearStatus('confirm')
            setTimeout(() => setClearStatus(s => s === 'confirm' ? null : s), 4000)
            return
        }
        setClearBusy(true)
        try {
            // Passing null wipes the inventory across ALL known networks.
            await bridge.deviceInventoryClear?.(null)
            setClearStatus('ok')
            setTimeout(() => setClearStatus(null), 2000)
        } catch (error) {
            logBridgeWarning('settings:clear-inventory', error)
            setClearStatus('error')
            setTimeout(() => setClearStatus(null), 2500)
        } finally {
            setClearBusy(false)
        }
    }

    // Load persisted settings on mount
    useEffect(() => {
        bridge.configGetPublic(['accentColor', 'theme', 'pollInterval', 'notifications', 'notifyNewDevices', 'macVendorLookupOnline', 'latencyThreshold']).then(cfg => {
            if (!cfg) return
            if (cfg.accentColor) { setAccent(cfg.accentColor); applyCSSAccent(cfg.accentColor) }
            if (cfg.theme) { setTheme(cfg.theme); applyTheme(cfg.theme) }
            if (cfg.pollInterval) setInterval(cfg.pollInterval)
            if (cfg.notifications !== undefined) setNotifs(cfg.notifications)
            if (cfg.notifyNewDevices !== undefined) setNotifyNewDevices(cfg.notifyNewDevices)
            if (cfg.macVendorLookupOnline !== undefined) setMacVendorOnline(cfg.macVendorLookupOnline)
            if (cfg.latencyThreshold) setLatencyThr(cfg.latencyThreshold)
        }).catch(error => {
            logBridgeWarning('settings:bootstrap', error)
        })
    }, [])

    function applyAccent(color) {
        setAccent(color)
        applyCSSAccent(color)
        persistSetting('accentColor', color)
    }

    function openGithub() {
        bridge.openExternal('https://github.com/4ismael1').catch(error => {
            logBridgeWarning('settings:open-github', error)
            window.open('https://github.com/4ismael1', '_blank', 'noopener,noreferrer')
        })
    }

    function openPrivacyPolicy() {
        const url = 'https://4ismael1.github.io/netduo/privacy'
        bridge.openExternal(url).catch(error => {
            logBridgeWarning('settings:open-privacy', error)
            window.open(url, '_blank', 'noopener,noreferrer')
        })
    }

    return (
        <div className="v3-page-layout page-enter">
            <div className="v3-page-header">
                <h1 className="v3-page-title"><SettingsIcon size={24} color="var(--color-accent)" /> Settings</h1>
                <p className="v3-page-subtitle">Customize your NetDuo experience</p>
            </div>

            {/* Appearance */}
            <div className="v3-card" style={{ marginBottom: 24, maxWidth: 800 }}>
                <div className="v3-card-header">
                    <span className="v3-card-title"><Palette size={16} style={{ display: 'inline', marginRight: 5, color: 'var(--color-accent)' }} />Appearance</span>
                </div>
                <div style={{ marginBottom: 24 }}>
                    <div className="v3-label-sm" style={{ marginBottom: 12 }}>Accent Color</div>
                    <div className="accent-palette">
                        {ACCENTS.map(a => (
                            <button key={a.value} className={`accent-chip ${accent === a.value ? 'selected' : ''}`}
                                style={{ '--chip-color': a.value }} onClick={() => applyAccent(a.value)} title={a.name}>
                                <div className="chip-dot" />
                                <span>{a.name}</span>
                                {accent === a.value && <span className="chip-check">✓</span>}
                            </button>
                        ))}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingTop: 16, borderTop: '1px solid var(--border-light)' }}>
                    <span className="v3-label-sm" style={{ margin: 0 }}>Theme</span>
                    <div className="theme-toggle-row">
                        <button className={`theme-opt ${theme === 'light' ? 'active' : ''}`} onClick={() => setThemeMode('light', setTheme, setAccent)}>
                            <Sun size={14} /> Light
                        </button>
                        <button className={`theme-opt ${theme === 'dark' ? 'active' : ''}`} onClick={() => setThemeMode('dark', setTheme, setAccent)}>
                            <Moon size={14} /> Dark
                        </button>
                        <button className={`theme-opt ${theme === 'nothing' ? 'active' : ''}`} onClick={() => setThemeMode('nothing', setTheme, setAccent)}>
                            <CircleDot size={14} /> Nothing
                        </button>
                    </div>
                </div>
            </div>

            {/* Monitor Settings */}
            <div className="v3-card" style={{ marginBottom: 24, maxWidth: 800 }}>
                <div className="v3-card-header">
                    <span className="v3-card-title"><Bell size={16} style={{ display: 'inline', marginRight: 5, color: 'var(--color-accent)' }} />Monitor & Alerts</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
                    <div className="input-group">
                        <label className="v3-label-sm">Polling Interval (seconds)</label>
                        <select className="v3-input" value={interval} onChange={e => { setInterval(e.target.value); persistSetting('pollInterval', e.target.value) }}>
                            {['1', '2', '5', '10', '30'].map(v => <option key={v} value={v}>{v}s</option>)}
                        </select>
                    </div>
                    <div className="input-group">
                        <label className="v3-label-sm">Latency Alert Threshold (ms)</label>
                        <input className="v3-input" type="number" value={latencyThr} onChange={e => { setLatencyThr(e.target.value); persistSetting('latencyThreshold', e.target.value) }} />
                    </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24, padding: '16px 0', borderTop: '1px solid var(--border-light)' }}>
                    <label className="toggle-label">
                        <input type="checkbox" className="toggle-input" checked={notifs} onChange={e => { setNotifs(e.target.checked); persistSetting('notifications', e.target.checked) }} />
                        <div className="toggle-track"><div className="toggle-thumb" /></div>
                        <div>
                            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>System notifications</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Latency alerts from the Monitor module.</div>
                        </div>
                    </label>
                    <label className="toggle-label">
                        <input type="checkbox" className="toggle-input" checked={notifyNewDevices} onChange={e => { setNotifyNewDevices(e.target.checked); persistSetting('notifyNewDevices', e.target.checked) }} />
                        <div className="toggle-track"><div className="toggle-thumb" /></div>
                        <div>
                            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Notify on new LAN devices</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Desktop alert whenever a new MAC appears during a Scanner scan.</div>
                        </div>
                    </label>
                    <label className="toggle-label">
                        <input type="checkbox" className="toggle-input" checked={macVendorOnline} onChange={e => { setMacVendorOnline(e.target.checked); persistSetting('macVendorLookupOnline', e.target.checked) }} />
                        <div className="toggle-track"><div className="toggle-thumb" /></div>
                        <div>
                            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Online vendor lookup (MAC API)</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Query macvendors.com when the local OUI table misses a prefix. Disable to keep scans fully offline.</div>
                        </div>
                    </label>
                </div>
            </div>

            {/* Data management */}
            <div className="v3-card" style={{ marginBottom: 24, maxWidth: 800 }}>
                <div className="v3-card-header">
                    <span className="v3-card-title"><Trash2 size={16} style={{ display: 'inline', marginRight: 5, color: 'var(--color-accent)' }} />Scanner data</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '8px 0' }}>
                    <div>
                        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 2 }}>Clear scan inventory</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 520 }}>
                            Removes every device recorded by the LAN Scanner across all networks, including nicknames, notes, type overrides and new-device state. This cannot be undone. Your scan history entries are kept.
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleClearInventory}
                        disabled={clearBusy}
                        className="v3-btn"
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            whiteSpace: 'nowrap',
                            background: clearStatus === 'confirm'
                                ? 'var(--color-danger, #ef4444)'
                                : clearStatus === 'ok'
                                    ? 'var(--color-success, #10b981)'
                                    : 'transparent',
                            color: clearStatus === 'confirm' || clearStatus === 'ok' ? '#fff' : 'var(--color-danger, #ef4444)',
                            border: `1px solid ${clearStatus === 'ok' ? 'var(--color-success, #10b981)' : 'var(--color-danger, #ef4444)'}`,
                        }}
                    >
                        {clearStatus === 'ok'
                            ? <><CheckCircle2 size={14} /> Cleared</>
                            : clearStatus === 'confirm'
                                ? <><Trash2 size={14} /> Confirm clear</>
                                : clearStatus === 'error'
                                    ? <>Failed — retry?</>
                                    : <><Trash2 size={14} /> Clear inventory</>}
                    </button>
                </div>
            </div>

            {/* About */}
            <div className="v3-card" style={{ maxWidth: 800 }}>
                <div className="v3-card-header">
                    <span className="v3-card-title"><Info size={16} style={{ display: 'inline', marginRight: 5, color: 'var(--color-accent)' }} />About NetDuo</span>
                </div>
                <div style={{ display: 'flex', gap: 24, alignItems: 'center', padding: '12px 0' }}>
                    <div style={{ padding: 16, background: 'var(--color-accent-ghost)', borderRadius: 'var(--radius-lg)' }}>
                        <Globe size={32} color="var(--color-accent)" />
                    </div>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>NetDuo</span>
                            <span
                                style={{
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: 'var(--text-accent)',
                                    background: 'var(--color-accent-ghost)',
                                    border: '1px solid var(--border-focus)',
                                    borderRadius: 999,
                                    padding: '2px 8px',
                                    lineHeight: 1.2,
                                }}
                            >
                                v1.3.1
                            </span>
                        </div>
                        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>Professional Network Diagnostics Suite</div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>Developer: Ismael (@4ismael1)</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                            <button
                                type="button"
                                onClick={openGithub}
                                className="v3-btn v3-btn-secondary"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                            >
                                <Github size={14} />
                                <ExternalLink size={13} />
                                Visit GitHub
                            </button>
                            <button
                                type="button"
                                onClick={openPrivacyPolicy}
                                className="v3-btn v3-btn-secondary"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                            >
                                <Shield size={14} />
                                <ExternalLink size={13} />
                                Privacy Policy
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

