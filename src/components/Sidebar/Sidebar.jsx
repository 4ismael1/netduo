import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import {
    LayoutDashboard, Radar, Stethoscope, Gauge,
    Activity, Globe, Wrench, History, Settings, ShieldAlert, ShieldCheck
} from 'lucide-react'
import NetDuoAppIcon from '../Brand/NetDuoAppIcon'
import './Sidebar.css'

const NAV = [
    { path: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/network',     icon: Globe,           label: 'Network' },
    { path: '/monitor',     icon: Activity,        label: 'Monitor' },
    { path: '/speedtest',   icon: Gauge,           label: 'Speed Test' },
    { path: '/diagnostics', icon: Stethoscope,     label: 'Diagnostics' },
    { path: '/scanner',     icon: Radar,           label: 'Scanner' },
    { path: '/lan-check',   icon: ShieldCheck,     label: 'LAN Check' },
    { path: '/wan-probe',   icon: ShieldAlert,     label: 'WAN Check' },
    { path: '/tools',       icon: Wrench,          label: 'Tools' },
]

const BOTTOM = [
    { path: '/history',  icon: History,  label: 'History' },
    { path: '/settings', icon: Settings, label: 'Settings' },
]

function NavBtn({ path, icon: Icon, label, expanded }) {
    return (
        <NavLink
            to={path}
            className={({ isActive }) => `nav-btn${isActive ? ' active' : ''}`}
            data-tip={label}
        >
            <Icon size={19} strokeWidth={1.8} />
            {expanded && <span className="nav-label">{label}</span>}
        </NavLink>
    )
}

export default function Sidebar() {
    const [expanded, setExpanded] = useState(() => {
        try { return localStorage.getItem('sidebar-expanded') === 'true' } catch { return false }
    })

    useEffect(() => {
        localStorage.setItem('sidebar-expanded', expanded)
        document.documentElement.style.setProperty('--rail-w', expanded ? '200px' : '64px')
    }, [expanded])

    return (
        <nav className={`sidebar-rail ${expanded ? 'expanded' : ''}`}>
            <div className="rail-top">
                <div className="rail-logo" onClick={() => setExpanded(e => !e)} title={expanded ? 'Collapse' : 'Expand'}>
                    <span className="logo-mark">
                        <NetDuoAppIcon size={34} mode="accent" />
                    </span>
                    {expanded && <span className="logo-text">NetDuo</span>}
                </div>
            </div>

            <div className="rail-nav">
                {expanded && <div className="nav-section-label">Navigation</div>}
                {NAV.map(n => <NavBtn key={n.path} {...n} expanded={expanded} />)}
            </div>

            <div className="rail-bottom">
                {expanded && <div className="nav-section-label">System</div>}
                {BOTTOM.map(n => <NavBtn key={n.path} {...n} expanded={expanded} />)}
            </div>
        </nav>
    )
}
