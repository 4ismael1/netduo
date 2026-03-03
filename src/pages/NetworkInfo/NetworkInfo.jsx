import { useState } from 'react'
import {
    Network,
    Globe,
    Cpu,
    Wifi,
    Loader2,
    Copy,
    CheckCheck,
    ChevronDown,
    Eye,
    EyeOff,
    Router,
    Shield,
} from 'lucide-react'
import useNetworkStatus from '../../lib/useNetworkStatus.jsx'

function inferInterfaceType(name = '', description = '') {
    const value = `${String(name)} ${String(description)}`.trim()
    if (/(vpn|openvpn|wireguard|wg\d+|wintun|nordlynx|tailscale|zerotier|hamachi|ppp|utun\d*|tun\d*|tap\d*|ikev2|l2tp|sstp|pptp)/i.test(value)) return 'vpn'
    if (/(wi-?fi|wlan|wireless|802\.11)/i.test(value)) return 'wifi'
    if (/(ethernet|local area connection|lan|eth\d*|enp\d+|eno\d+|realtek|intel\(r\).*ethernet|gigabit)/i.test(value)) return 'ethernet'
    return 'other'
}

function formatUptime(seconds) {
    if (!seconds) return '-'
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${d}d ${h}h ${m}m`
}

function formatBytes(bytes) {
    if (!bytes) return '-'
    return `${(bytes / 1e9).toFixed(2)} GB`
}

export default function NetworkInfo() {
    const net = useNetworkStatus()
    const [copied, setCopied] = useState(false)
    const [collapsed, setCollapsed] = useState({})
    const [showIP, setShowIP] = useState(false)

    const interfaces = Array.isArray(net.interfaces) ? net.interfaces : []
    const sysInfo = net.sysInfo
    const publicIP = net.publicIP || '-'
    const geoInfo = net.geo
    const loading = net.loading
    const transportLabel = net.isVpn
        ? 'VPN'
        : (net.isWifi ? 'Wi-Fi' : (net.isEthernet ? 'Ethernet' : (net.connected ? 'Network' : 'Offline')))

    const grouped = interfaces.reduce((acc, iface) => {
        if (!acc[iface.name]) acc[iface.name] = []
        acc[iface.name].push(iface)
        return acc
    }, {})

    function copyAll() {
        const visiblePublicIP = showIP ? publicIP : publicIP.replace(/./g, '\u2022')
        const lines = [
            '=== NetDuo Network Report ===',
            `Generated: ${new Date().toLocaleString()}`,
            '',
            'CONNECTION',
            `Connected:   ${net.connected ? 'yes' : 'no'}`,
            `Transport:   ${transportLabel}`,
            `Interface:   ${net.ifaceName || '-'}`,
            `Local IP:    ${net.localIP || '-'}`,
            `Gateway:     ${net.isVpn ? 'Paused (VPN active)' : (net.gateway || '-')}`,
            '',
            'PUBLIC',
            `Public IP:   ${visiblePublicIP}`,
            `Country:     ${geoInfo?.country || '-'}`,
            `City:        ${geoInfo?.city || '-'}`,
            `ISP:         ${geoInfo?.isp || '-'}`,
            `Timezone:    ${geoInfo?.timezone || '-'}`,
            `Coordinates: ${geoInfo?.lat?.toFixed?.(4) ?? '-'}, ${geoInfo?.lon?.toFixed?.(4) ?? '-'}`,
            '',
            'SYSTEM',
            `Hostname:    ${sysInfo?.hostname || '-'}`,
            `Platform:    ${sysInfo?.platform || '-'}`,
            `Arch:        ${sysInfo?.arch || '-'}`,
            `CPU Cores:   ${sysInfo?.cpus ?? '-'}`,
            `Total RAM:   ${formatBytes(sysInfo?.totalmem)}`,
            `Free RAM:    ${formatBytes(sysInfo?.freemem)}`,
            `Uptime:      ${formatUptime(sysInfo?.uptime)}`,
            '',
            'NETWORK INTERFACES',
            ...Object.entries(grouped).flatMap(([name, addrs]) => [
                '',
                `[${name}]`,
                ...addrs.map(a => `  ${String(a.family || '').padEnd(5)} ${String(a.address || '').padEnd(20)} ${a.netmask || '-'} ${a.mac || '-'}`),
            ]),
        ]

        navigator.clipboard.writeText(lines.join('\n')).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2500)
        })
    }

    function toggleSection(name) {
        setCollapsed(prev => ({ ...prev, [name]: !prev[name] }))
    }

    return (
        <div className="v3-page-layout page-enter">
            <div className="v3-page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <h1 className="v3-page-title"><Network size={24} color="var(--color-accent)" /> Network Info</h1>
                    <p className="v3-page-subtitle">All network interfaces, addresses, and internet identity</p>
                </div>
                <button className="v3-btn v3-btn-secondary" onClick={copyAll} disabled={loading}>
                    {copied ? <><CheckCheck size={14} style={{ color: 'var(--color-success)' }} />Copied!</> : <><Copy size={16} />Copy All</>}
                </button>
            </div>

            {loading ? (
                <div style={{ color: 'var(--text-muted)', padding: '60px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Loader2 size={18} className="spin-icon" />Loading network data...
                </div>
            ) : (
                <>
                    <div className="v3-card" style={{ marginBottom: 24 }}>
                        <div className="v3-card-header">
                            <span className="v3-card-title">
                                {net.isVpn ? <Shield size={16} style={{ display: 'inline', marginRight: 5, color: 'var(--color-accent)' }} /> : <Network size={16} style={{ display: 'inline', marginRight: 5, color: 'var(--color-accent)' }} />}
                                Connection State
                            </span>
                            <span className={`v3-badge ${net.connected ? 'success' : 'warning'}`}>
                                {net.connected ? 'Online' : 'Offline'}
                            </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 0, border: '1px solid var(--border-strong)', borderRadius: 12, overflow: 'hidden' }}>
                            {[
                                { label: 'Transport', value: transportLabel },
                                { label: 'Interface', value: net.ifaceName || '-' },
                                { label: 'Local IP', value: net.localIP || '-', mono: true },
                                { label: 'Gateway', value: net.isVpn ? 'Paused (VPN active)' : (net.gateway || '-'), mono: true },
                            ].map(({ label, value, mono }) => (
                                <div key={label} style={{ padding: '16px 20px', borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-app)' }}>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
                                    <div className={mono ? 'mono' : ''} style={{ fontSize: 14, fontWeight: 500, color: value ? 'var(--text-primary)' : 'var(--text-muted)', wordBreak: 'break-all', lineHeight: 1.4 }}>
                                        {value || '-'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="v3-card" style={{ marginBottom: 24 }}>
                        <div className="v3-card-header">
                            <span className="v3-card-title"><Globe size={16} style={{ display: 'inline', marginRight: 5, color: 'var(--color-accent)' }} />Internet Identity</span>
                            <div style={{ display: 'flex', gap: 8 }}>
                                {publicIP && publicIP !== 'Unavailable' && <span className="v3-badge success">Connected</span>}
                                {net.isVpn && <span className="v3-badge info">VPN active</span>}
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 0, border: '1px solid var(--border-strong)', borderRadius: 12, overflow: 'hidden' }}>
                            {[
                                { label: 'Public IP', value: publicIP, mono: true, sensitive: true },
                                { label: 'Country', value: geoInfo?.country },
                                { label: 'City/Region', value: geoInfo?.city },
                                { label: 'ISP', value: geoInfo?.isp },
                                { label: 'Timezone', value: geoInfo?.timezone },
                                { label: 'Coordinates', value: geoInfo?.lat ? `${geoInfo.lat.toFixed(4)}, ${geoInfo.lon.toFixed(4)}` : null, mono: true },
                                { label: 'ORG/AS', value: geoInfo?.org },
                            ].map(({ label, value, mono, sensitive }) => (
                                <div key={label} style={{ padding: '16px 20px', borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-app)' }}>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
                                    <div className={mono ? 'mono' : ''} style={{ fontSize: 14, fontWeight: 500, color: value ? 'var(--text-primary)' : 'var(--text-muted)', wordBreak: 'break-all', lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {sensitive && value && value !== '-'
                                            ? (showIP ? value : value.replace(/./g, '\u2022'))
                                            : (value || '-')}
                                        {sensitive && value && value !== '-' && (
                                            <button className="ip-eye-btn" onClick={() => setShowIP(p => !p)} title={showIP ? 'Hide IP' : 'Show IP'}>
                                                {showIP ? <EyeOff size={14} /> : <Eye size={14} />}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {sysInfo && (
                        <div className="v3-card" style={{ marginBottom: 24 }}>
                            <div className="v3-card-header">
                                <span className="v3-card-title"><Cpu size={16} style={{ display: 'inline', marginRight: 5, color: 'var(--color-accent)' }} />System</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 0, border: '1px solid var(--border-strong)', borderRadius: 12, overflow: 'hidden' }}>
                                {[
                                    { label: 'Hostname', value: sysInfo.hostname },
                                    { label: 'Platform', value: sysInfo.platform },
                                    { label: 'Architecture', value: sysInfo.arch },
                                    { label: 'CPU Cores', value: String(sysInfo.cpus) },
                                    { label: 'Total RAM', value: formatBytes(sysInfo.totalmem) },
                                    { label: 'Free RAM', value: formatBytes(sysInfo.freemem) },
                                    { label: 'RAM Used', value: `${(((sysInfo.totalmem - sysInfo.freemem) / sysInfo.totalmem) * 100).toFixed(0)}%` },
                                    { label: 'Uptime', value: formatUptime(sysInfo.uptime) },
                                ].map(({ label, value }) => (
                                    <div key={label} style={{ padding: '16px 20px', borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-app)' }}>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
                                        <div className="mono" style={{ fontSize: 14, fontWeight: 500, wordBreak: 'break-all' }}>{value}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {Object.entries(grouped).map(([name, addrs]) => {
                        const isActive = addrs.some(a => !a.internal && a.family === 'IPv4')
                        const ifaceType = inferInterfaceType(name, addrs?.[0]?.interfaceDescription)
                        const InterfaceIcon = ifaceType === 'wifi' ? Wifi : (ifaceType === 'ethernet' ? Router : (ifaceType === 'vpn' ? Shield : Network))
                        const ifaceTypeLabel = ifaceType === 'wifi' ? 'Wi-Fi' : (ifaceType === 'ethernet' ? 'Ethernet' : (ifaceType === 'vpn' ? 'VPN' : 'Network'))
                        const badgeTone = isActive ? (ifaceType === 'vpn' ? 'info' : 'success') : 'accent'
                        const isOpen = !collapsed[name]
                        return (
                            <div className="v3-card" key={name} style={{ marginBottom: 16 }}>
                                <button
                                    onClick={() => toggleSection(name)}
                                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, marginBottom: isOpen ? 20 : 0 }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <InterfaceIcon size={18} style={{ color: isActive ? 'var(--color-info)' : 'var(--text-muted)' }} />
                                        <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>{name}</span>
                                        <span className={`v3-badge ${badgeTone}`} style={{ fontSize: 10 }}>
                                            {isActive ? `Active ${ifaceTypeLabel}` : `Inactive ${ifaceTypeLabel}`}
                                        </span>
                                    </div>
                                    <ChevronDown size={16} style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                                </button>

                                {isOpen && (
                                    <div style={{ overflowX: 'auto' }}>
                                        <table className="np-table" style={{ minWidth: 600 }}>
                                            <thead>
                                                <tr><th>Family</th><th>Address</th><th>Netmask</th><th>CIDR</th><th>MAC</th><th>Scope</th></tr>
                                            </thead>
                                            <tbody>
                                                {addrs.map((addr, i) => (
                                                    <tr key={i}>
                                                        <td><span className={`v3-badge ${addr.family === 'IPv4' ? 'info' : 'accent'}`}>{addr.family}</span></td>
                                                        <td className="mono" style={{ color: 'var(--color-info)', wordBreak: 'break-all', fontWeight: 500 }}>{showIP ? addr.address : String(addr.address || '').replace(/./g, '\u2022')}</td>
                                                        <td className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{addr.netmask}</td>
                                                        <td className="mono" style={{ fontSize: 12 }}>{addr.cidr || '-'}</td>
                                                        <td className="mono" style={{ fontSize: 12, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{addr.mac}</td>
                                                        <td>{addr.internal
                                                            ? <span className="v3-badge warning">Loopback</span>
                                                            : <span className="v3-badge success">External</span>}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </>
            )}
        </div>
    )
}
