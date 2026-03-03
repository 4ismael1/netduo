import { useState, useEffect } from 'react'
import { Minus, Square, X } from 'lucide-react'
import './TopBar.css'

export default function TopBar() {
    const [time, setTime] = useState(new Date())

    useEffect(() => {
        const id = setInterval(() => setTime(new Date()), 1000)
        return () => clearInterval(id)
    }, [])

    return (
        <header className="topbar" style={{ WebkitAppRegion: 'drag' }}>
            <div className="topbar-left">
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
