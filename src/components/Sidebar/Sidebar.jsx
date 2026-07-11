import { NavLink, useLocation } from 'react-router-dom'
import {
    LayoutDashboard, Radar, Stethoscope, Gauge,
    Activity, Globe, Wrench, History, Settings, ShieldAlert, ShieldCheck, Loader2
} from 'lucide-react'
import NetDuoAppIcon from '../Brand/NetDuoAppIcon'
import { useScannerSession } from '../../lib/scannerSession.js'
import './Sidebar.css'

const NAV = [
    { path: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/speedtest',   icon: Gauge,           label: 'Speed Test' },
    { path: '/scanner',     icon: Radar,           label: 'Scanner' },
    { path: '/monitor',     icon: Activity,        label: 'Monitor' },
    { path: '/diagnostics', icon: Stethoscope,     label: 'Diagnostics' },
    { path: '/tools',       icon: Wrench,          label: 'Tools' },
    { path: '/lan-check',   icon: ShieldCheck,     label: 'LAN Check' },
    { path: '/wan-probe',   icon: ShieldAlert,     label: 'WAN Check' },
    { path: '/network',     icon: Globe,           label: 'Network' },
]

const BOTTOM = [
    { path: '/history',  icon: History,  label: 'History' },
    { path: '/settings', icon: Settings, label: 'Settings' },
]

function NavBtn({ path, icon: Icon, label, busy = false }) {
    return (
        <NavLink
            to={path}
            className={({ isActive }) => `nav-btn${isActive ? ' active' : ''}`}
            data-tip={label}
        >
            <span className="nav-icon-wrap">
                <Icon size={19} strokeWidth={1.8} />
                {busy && <Loader2 size={11} className="nav-scan-spinner" aria-label="LAN scan in progress" />}
            </span>
            <span className="nav-label">{label}</span>
        </NavLink>
    )
}

export default function Sidebar({ expanded }) {
    const location = useLocation()
    const { scanning } = useScannerSession()
    const showScannerBusy = scanning && location.pathname !== '/scanner'

    return (
        <nav className={`sidebar-rail ${expanded ? 'expanded' : ''}`}>
            <div className="rail-top">
                <div className="rail-logo">
                    <span className="logo-mark">
                        <NetDuoAppIcon size={34} mode="accent" />
                    </span>
                    <span className="logo-text">NetDuo</span>
                </div>
            </div>

            <div className="rail-nav">
                <div className="nav-section-label">Navigation</div>
                {NAV.map(n => <NavBtn key={n.path} {...n} busy={n.path === '/scanner' && showScannerBusy} />)}
            </div>

            <div className="rail-bottom">
                <div className="nav-section-label">System</div>
                {BOTTOM.map(n => <NavBtn key={n.path} {...n} />)}
            </div>
        </nav>
    )
}
