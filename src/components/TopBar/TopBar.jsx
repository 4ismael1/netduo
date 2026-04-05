import { useState, useEffect } from 'react'
import { Minus, Square, X, PanelLeft } from 'lucide-react'
import './TopBar.css'

export default function TopBar({ onToggleSidebar, sidebarExpanded }) {
    const [time, setTime] = useState(new Date())

    useEffect(() => {
        const id = setInterval(() => setTime(new Date()), 1000)
        return () => clearInterval(id)
    }, [])

    return (
        <header className="topbar" style={{ WebkitAppRegion: 'drag' }}>
            <div className="topbar-left">
                <button
                    className="sidebar-toggle-btn"
                    onClick={onToggleSidebar}
                    title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
                    aria-label={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
                    style={{ WebkitAppRegion: 'no-drag' }}
                >
                    <PanelLeft size={16} strokeWidth={1.8} />
                </button>
                <span className="topbar-brand">NetDuo</span>
                <span className="topbar-sep">&middot;</span>
                <span className="topbar-time mono">
                    {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
            </div>

            <div className="topbar-controls" style={{ WebkitAppRegion: 'no-drag' }}>
                <button className="wc-btn" onClick={() => window.electronAPI?.minimize()} title="Minimize">
                    <Minus size={14} />
                </button>
                <button className="wc-btn" onClick={() => window.electronAPI?.maximize()} title="Maximize">
                    <Square size={10} />
                </button>
                <button className="wc-btn wc-close" onClick={() => window.electronAPI?.close()} title="Close">
                    <X size={14} />
                </button>
            </div>
        </header>
    )
}
