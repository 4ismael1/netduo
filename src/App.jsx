import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary'
import Sidebar from './components/Sidebar/Sidebar'
import TopBar from './components/TopBar/TopBar'
import Dashboard from './pages/Dashboard/Dashboard'
import Scanner from './pages/Scanner/Scanner'
import Diagnostics from './pages/Diagnostics/Diagnostics'
import SpeedTest from './pages/SpeedTest/SpeedTest'
import Monitor from './pages/Monitor/Monitor'
import NetworkInfo from './pages/NetworkInfo/NetworkInfo'
import Tools from './pages/Tools/Tools'
import History from './pages/History/History'
import Settings from './pages/Settings/Settings'
import WanProbe from './pages/WanProbe/WanProbe'
import LanCheck from './pages/LanCheck/LanCheck'
import bridge from './lib/electronBridge'
import { NetworkStatusProvider } from './lib/useNetworkStatus.jsx'

// Import only the clean index.css which pulls in design-system.css
import './index.css'

export default function App() {
  // Restore persisted accent color and theme on startup
  useEffect(() => {
    const clearBootTheme = () => {
      const boot = document.querySelector('style[data-netduo-boot-theme="true"]')
      if (boot) boot.remove()
      document.documentElement.style.removeProperty('background-color')
    }

    bridge.configGetAll().then(cfg => {
      if (!cfg) return
      if (cfg.accentColor) {
        document.documentElement.style.setProperty('--color-accent', cfg.accentColor)
        document.documentElement.style.setProperty('--color-accent-hover', cfg.accentColor)
        document.documentElement.style.setProperty('--accent-glow', cfg.accentColor + '66')
        document.documentElement.style.setProperty('--color-accent-ghost', cfg.accentColor + '22')
        document.documentElement.style.setProperty('--text-accent', cfg.accentColor)
        document.documentElement.style.setProperty('--border-focus', cfg.accentColor)
      }
      if (cfg.theme) {
        document.documentElement.setAttribute('data-theme', cfg.theme)
        document.documentElement.style.colorScheme = cfg.theme
        try { localStorage.setItem('netduo.theme', cfg.theme) } catch {}
      }
    }).catch(() => {}).finally(() => {
      clearBootTheme()
    })
  }, [])
  return (
    <HashRouter>
      <NetworkStatusProvider>
      <div className="app-layout">
        <div className="sidebar-region">
          <Sidebar />
        </div>
        <div className="content-region">
          <div className="topbar-region">
            <TopBar />
          </div>
          <div className="route-content">
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
                <Route path="/scanner" element={<ErrorBoundary><Scanner /></ErrorBoundary>} />
                <Route path="/diagnostics" element={<ErrorBoundary><Diagnostics /></ErrorBoundary>} />
                <Route path="/speedtest" element={<ErrorBoundary><SpeedTest /></ErrorBoundary>} />
                <Route path="/monitor" element={<ErrorBoundary><Monitor /></ErrorBoundary>} />
                <Route path="/network" element={<ErrorBoundary><NetworkInfo /></ErrorBoundary>} />
                <Route path="/tools" element={<ErrorBoundary><Tools /></ErrorBoundary>} />
                <Route path="/wan-probe" element={<ErrorBoundary><WanProbe /></ErrorBoundary>} />
                <Route path="/lan-check" element={<ErrorBoundary><LanCheck /></ErrorBoundary>} />
                <Route path="/history" element={<ErrorBoundary><History /></ErrorBoundary>} />
                <Route path="/settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
              </Routes>
            </ErrorBoundary>
          </div>
        </div>
      </div>
      </NetworkStatusProvider>
    </HashRouter>
  )
}
