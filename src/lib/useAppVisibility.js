import { useEffect, useState } from 'react'
import bridge from './electronBridge'

function isDocumentVisible() {
    return typeof document === 'undefined'
        || (document.hidden !== true && document.visibilityState !== 'hidden')
}

/**
 * Browser visibility alone is not authoritative for a frameless Electron
 * window on every Windows build. Combine it with BrowserWindow lifecycle
 * events so visual-only probes reliably stop while NetDuo is minimized.
 */
export default function useAppVisibility() {
    const [visible, setVisible] = useState(isDocumentVisible)

    useEffect(() => {
        // `null` means no BrowserWindow lifecycle signal has arrived yet, so
        // the standard browser API remains the startup/web fallback. Once the
        // main process publishes a state, it is authoritative: Chromium can
        // leave document.hidden stale after restoring a frameless window.
        let nativeVisible = null
        const publish = () => setVisible(
            nativeVisible == null ? isDocumentVisible() : nativeVisible
        )
        const onDocumentVisibility = () => {
            if (nativeVisible == null) publish()
        }
        const offNative = bridge.onWindowVisibilityChanged?.(state => {
            nativeVisible = state?.visible === true
            publish()
        })

        document.addEventListener('visibilitychange', onDocumentVisibility)
        publish()
        return () => {
            document.removeEventListener('visibilitychange', onDocumentVisibility)
            offNative?.()
        }
    }, [])

    return visible
}
