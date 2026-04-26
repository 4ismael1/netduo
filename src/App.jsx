import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect, lazy, Suspense } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary'
import Sidebar from './components/Sidebar/Sidebar'
import TopBar from './components/TopBar/TopBar'
import bridge from './lib/electronBridge'
import { logBridgeWarning } from './lib/devLog.js'
import { NetworkStatusProvider } from './lib/useNetworkStatus.jsx'
// Dashboard is the first route on app open and is always needed, so we
// import it eagerly to eliminate the visible skeleton flicker on cold
// start. With lazy(), there were two competing skeletons: the Suspense
// fallback (instance A) shown while the Dashboard chunk loaded, then
// the internal one (instance B) shown via `if (!ready) return
// <DashboardSkeleton/>` while useNetworkStatus gathered data. React
// unmounted A and mounted B across the Suspense boundary, restarting
// the shimmer CSS animations and producing a one-frame "blink".
// Removing the Suspense fallback (fallback={null}) avoided the flicker
// but exposed the chunk-load window as a bg-only gap before any
// skeleton appeared. Eager import collapses both problems: the chunk
// is part of the main bundle so Dashboard mounts on the very first
// React commit, the internal skeleton shows immediately, and there's
// only one skeleton instance for the whole loading lifecycle. The
// recharts vendor split in vite.config.js keeps the main bundle from
// growing (recharts moves to its own parallel-loaded chunk).
import Dashboard from './pages/Dashboard/Dashboard'

// Import only the clean index.css which pulls in design-system.css
import './index.css'

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
        document.documentElement.style.colorScheme = cfg.theme === 'light' ? 'light' : 'dark'
        persistThemePreference(cfg.theme)
      }
    }).catch(error => {
      logBridgeWarning('app:config-bootstrap', error)
      return null
    }).finally(() => {
      clearBootTheme()
    })
  }, [])

  // Pre-fetch heavy lazy chunks during idle time. The Dashboard route is
  // visited first; while the user is reading it, the browser silently
  // downloads + parses the WanProbe (82 kB) and LanCheck (46 kB) chunks
  // in the background. The next time the user clicks one of those nav
  // items the chunk is already cached → switching routes feels instant
  // instead of waiting 200-400ms for the chunk to download + parse +
  // execute mid-animation. requestIdleCallback (or a setTimeout fallback
  // for browsers without it) ensures we don't compete with the initial
  // paint on the Dashboard.
  useEffect(() => {
    const idle = (cb) => {
      if (typeof window.requestIdleCallback === 'function') {
        return window.requestIdleCallback(cb, { timeout: 4000 })
      }
      return setTimeout(cb, 1500)
    }
    const cancel = (id) => {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(id)
      } else {
        clearTimeout(id)
      }
    }
    const handle = idle(() => {
      // Fire-and-forget. The dynamic import() promise warms the module
      // graph; we don't need the result here. Errors are swallowed so a
      // chunk-load failure doesn't crash anything visible.
      import('./pages/WanProbe/WanProbe').catch(() => {})
      import('./pages/LanCheck/LanCheck').catch(() => {})
      import('./pages/Scanner/Scanner').catch(() => {})
    })
    return () => cancel(handle)
  }, [])
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    try { return localStorage.getItem('sidebar-expanded') === 'true' } catch { return false }
  })

  useEffect(() => {
    localStorage.setItem('sidebar-expanded', sidebarExpanded)
    document.documentElement.style.setProperty('--rail-w', sidebarExpanded ? '200px' : '64px')
  }, [sidebarExpanded])

  return (
    <HashRouter>
      <NetworkStatusProvider>
      <div className="app-layout">
        <div className="sidebar-region">
          <Sidebar expanded={sidebarExpanded} />
        </div>
        <div className="content-region">
          <div className="topbar-region">
            <TopBar onToggleSidebar={() => setSidebarExpanded(e => !e)} sidebarExpanded={sidebarExpanded} />
          </div>
          <div className="route-content">
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<RoutedPage Page={Dashboard} />} />
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
