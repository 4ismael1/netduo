import { NavLink, useLocation } from 'react-router-dom'
import {
    LayoutDashboard, Radar, Stethoscope, Gauge,
    Activity, Globe, Wrench, History, Settings, ShieldAlert, ShieldCheck,
    Check, AlertTriangle, X
} from 'lucide-react'
import NetDuoAppIcon from '../Brand/NetDuoAppIcon'
import OperationGlyph from './OperationGlyph'
import { useScannerSession } from '../../lib/scannerSession.js'
import { useOperations } from '../../lib/operationRegistry.js'
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

function OperationIndicator({ operation }) {
    if (!operation) return null
    const label = operation.label || 'Operation in progress'
    const statusGlyph = operation.status === 'done'
        ? <Check size={11} strokeWidth={2.4} aria-hidden="true" />
        : operation.status === 'error'
            ? <AlertTriangle size={11} strokeWidth={2.2} aria-hidden="true" />
            : operation.status === 'cancelled'
                ? <X size={11} strokeWidth={2.2} aria-hidden="true" />
                : <OperationGlyph kind={operation.kind} />
    return (
        <span
            className={`nav-operation nav-operation-${operation.kind || 'generic'} is-${operation.status || 'running'}`}
            role="status"
            aria-label={label}
            title={label}
        >
            {statusGlyph}
            {operation.count > 1 && <span className="nav-operation-count">{operation.count}</span>}
        </span>
    )
}

function NavBtn({ path, icon: Icon, label, operation = null }) {
    return (
        <NavLink
            to={path}
            className={({ isActive }) => `nav-btn${isActive ? ' active' : ''}`}
            data-tip={label}
        >
            <span className="nav-icon-wrap">
                <Icon size={19} strokeWidth={1.8} />
                <OperationIndicator operation={operation} />
            </span>
            <span className="nav-label">{label}</span>
            {operation?.kind === 'monitor' && operation.status === 'running' && (
                <span className="nav-live-label">LIVE</span>
            )}
        </NavLink>
    )
}

export default function Sidebar({ expanded }) {
    const location = useLocation()
    const { scanning } = useScannerSession()
    const operations = useOperations()

    const operationForPath = path => {
        if (location.pathname === path) return null
        const matches = Object.values(operations).filter(operation => operation.path === path)
        if (path === '/scanner' && scanning) {
            matches.push({ kind: 'scan', status: 'running', label: 'LAN scan in progress' })
        }
        if (!matches.length) return null
        const active = matches.filter(operation => operation.status === 'running' || operation.status === 'cancelling')
        const selected = active.at(-1) || matches.at(-1)
        return { ...selected, count: active.length > 1 ? active.length : undefined }
    }

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
                {NAV.map(n => <NavBtn key={n.path} {...n} operation={operationForPath(n.path)} />)}
            </div>

            <div className="rail-bottom">
                <div className="nav-section-label">System</div>
                {BOTTOM.map(n => <NavBtn key={n.path} {...n} />)}
            </div>
        </nav>
    )
}
