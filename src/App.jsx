import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, lazy, Suspense } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary'
import Sidebar from './components/Sidebar/Sidebar'
import TopBar from './components/TopBar/TopBar'
import bridge from './lib/electronBridge'
import { logBridgeWarning } from './lib/devLog.js'
import { NetworkStatusProvider } from './lib/useNetworkStatus.jsx'
import DashboardSkeleton from './pages/Dashboard/DashboardSkeleton.jsx'

// Import only the clean index.css which pulls in design-system.css
import './index.css'

const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard'))
const Scanner = lazy(() => import('./pages/Scanner/Scanner'))
const Diagnostics = lazy(() => import('./pages/Diagnostics/Diagnostics'))
const SpeedTest = lazy(() => import('./pages/SpeedTest/SpeedTest'))
const Monitor = lazy(() => import('./pages/Monitor/Monitor'))
const NetworkInfo = lazy(() => import('./pages/NetworkInfo/NetworkInfo'))
const Tools = lazy(() => import('./pages/Tools/Tools'))
const History = lazy(() => import('./pages/History/History'))
const Settings = lazy(() => import('./pages/Settings/Settings'))
const WanProbe = lazy(() => import('./pages/WanProbe/WanProbe'))
const LanCheck = lazy(() => import('./pages/LanCheck/LanCheck'))

function persistThemePreference(theme) {
  try {
    localStorage.setItem('netduo.theme', theme)
    return true
  } catch {
    return false
  }
}

function RouteFallback() {
  return (
    <div className="v3-card" style={{ maxWidth: 320, margin: '24px auto', padding: 18 }}>
      <div className="v3-card-title">Loading...</div>
      <p className="v3-page-subtitle" style={{ marginTop: 8 }}>
        NetDuo is preparing the selected workspace.
      </p>
    </div>
  )
}

function RoutedPage({ Page, fallback = <RouteFallback /> }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={fallback}>
        <Page />
      </Suspense>
    </ErrorBoundary>
  )
}

export default function App() {
  // Restore persisted accent color and theme on startup
  useEffect(() => {
    const clearBootTheme = () => {
      const boot = document.querySelector('style[data-netduo-boot-theme="true"]')
      if (boot) boot.remove()
      document.documentElement.style.removeProperty('background-color')
    }

    bridge.configGetPublic(['accentColor', 'theme']).then(cfg => {
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
        persistThemePreference(cfg.theme)
      }
    }).catch(error => {
      logBridgeWarning('app:config-bootstrap', error)
      return null
    }).finally(() => {
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
                <Route path="/dashboard" element={<RoutedPage Page={Dashboard} fallback={<DashboardSkeleton />} />} />
                <Route path="/scanner" element={<RoutedPage Page={Scanner} />} />
                <Route path="/diagnostics" element={<RoutedPage Page={Diagnostics} />} />
                <Route path="/speedtest" element={<RoutedPage Page={SpeedTest} />} />
                <Route path="/monitor" element={<RoutedPage Page={Monitor} />} />
                <Route path="/network" element={<RoutedPage Page={NetworkInfo} />} />
                <Route path="/tools" element={<RoutedPage Page={Tools} />} />
                <Route path="/wan-probe" element={<RoutedPage Page={WanProbe} />} />
                <Route path="/lan-check" element={<RoutedPage Page={LanCheck} />} />
                <Route path="/history" element={<RoutedPage Page={History} />} />
                <Route path="/settings" element={<RoutedPage Page={Settings} />} />
              </Routes>
            </ErrorBoundary>
          </div>
        </div>
      </div>
      </NetworkStatusProvider>
    </HashRouter>
  )
}
