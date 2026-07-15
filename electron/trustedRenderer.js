const path = require('path')
const { fileURLToPath, pathToFileURL } = require('url')

function normalizeWindowsPath(value) {
    const normalized = path.normalize(path.resolve(value))
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function createTrustedRendererPolicy({ isDev, productionEntryPath, devServerUrl }) {
    if (!productionEntryPath) throw new TypeError('productionEntryPath is required')

    const productionPath = normalizeWindowsPath(productionEntryPath)
    const productionEntryUrl = pathToFileURL(path.resolve(productionEntryPath)).href
    const devUrl = new URL(devServerUrl || 'http://localhost:5173/')

    function isTrustedUrl(rawUrl) {
        if (!rawUrl) return false
        try {
            const parsed = new URL(rawUrl)
            if (isDev) {
                return parsed.origin === devUrl.origin
                    && (parsed.pathname === '/' || parsed.pathname === '/index.html')
            }
            if (parsed.protocol !== 'file:') return false
            return normalizeWindowsPath(fileURLToPath(parsed)) === productionPath
        } catch {
            return false
        }
    }

    function eventUrl(event) {
        const frameUrl = event?.senderFrame?.url
        if (typeof frameUrl === 'string' && frameUrl) return frameUrl
        try {
            return event?.sender?.getURL?.() || ''
        } catch {
            return ''
        }
    }

    function isTrustedEvent(event) {
        // Privileged IPC belongs to the top-level application document. A
        // same-origin subframe must not inherit the main frame's authority.
        const senderFrame = event?.senderFrame
        const mainFrame = event?.sender?.mainFrame
        if (senderFrame && mainFrame && senderFrame !== mainFrame) return false
        return isTrustedUrl(eventUrl(event))
    }

    return Object.freeze({
        productionEntryUrl,
        devOrigin: devUrl.origin,
        isTrustedUrl,
        isTrustedEvent,
        eventUrl,
    })
}

function createTrustedIpc(ipcMain, policy, { onRejected = () => {} } = {}) {
    if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.on !== 'function') {
        throw new TypeError('ipcMain is required')
    }
    if (!policy || typeof policy.isTrustedEvent !== 'function') {
        throw new TypeError('trusted renderer policy is required')
    }

    const listenerWrappers = new Map()

    function reject(channel, event) {
        const source = policy.eventUrl(event) || 'unknown'
        onRejected({ channel, source })
        return source
    }

    function handle(channel, listener) {
        return ipcMain.handle(channel, async (event, ...args) => {
            if (!policy.isTrustedEvent(event)) {
                const source = reject(channel, event)
                const error = new Error(`Rejected IPC from untrusted renderer: ${channel}`)
                error.code = 'ERR_UNTRUSTED_RENDERER'
                error.source = source
                throw error
            }
            return listener(event, ...args)
        })
    }

    function on(channel, listener) {
        const wrapped = (event, ...args) => {
            if (!policy.isTrustedEvent(event)) {
                reject(channel, event)
                return
            }
            return listener(event, ...args)
        }
        let byListener = listenerWrappers.get(channel)
        if (!byListener) {
            byListener = new Map()
            listenerWrappers.set(channel, byListener)
        }
        byListener.set(listener, wrapped)
        ipcMain.on(channel, wrapped)
        return wrapped
    }

    function removeListener(channel, listener) {
        const byListener = listenerWrappers.get(channel)
        const wrapped = byListener?.get(listener)
        if (wrapped) {
            byListener.delete(listener)
            if (byListener.size === 0) listenerWrappers.delete(channel)
        }
        return ipcMain.removeListener(channel, wrapped || listener)
    }

    return Object.freeze({ handle, on, removeListener })
}

module.exports = { createTrustedRendererPolicy, createTrustedIpc }
