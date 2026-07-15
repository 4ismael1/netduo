const path = require('path')
const { pathToFileURL } = require('url')
const { createTrustedRendererPolicy, createTrustedIpc } = require('./trustedRenderer')

describe('trusted renderer policy', () => {
    const entryPath = path.resolve(__dirname, '../dist/index.html')

    it('trusts only the packaged entry file in production', () => {
        const policy = createTrustedRendererPolicy({
            isDev: false,
            productionEntryPath: entryPath,
        })
        const entry = pathToFileURL(entryPath).href

        expect(policy.isTrustedUrl(`${entry}?bootTheme=dark#/dashboard`)).toBe(true)
        expect(policy.isTrustedUrl(pathToFileURL(path.resolve(__dirname, 'other.html')).href)).toBe(false)
        expect(policy.isTrustedUrl('file:///C:/Users/Public/untrusted.html')).toBe(false)
        expect(policy.isTrustedUrl('https://example.com/')).toBe(false)
    })

    it('trusts only the configured Vite origin and entry path in development', () => {
        const policy = createTrustedRendererPolicy({
            isDev: true,
            productionEntryPath: entryPath,
            devServerUrl: 'http://localhost:5173/',
        })

        expect(policy.isTrustedUrl('http://localhost:5173/?bootTheme=light#/dashboard')).toBe(true)
        expect(policy.isTrustedUrl('http://localhost:5173/index.html')).toBe(true)
        expect(policy.isTrustedUrl('http://localhost:5174/')).toBe(false)
        expect(policy.isTrustedUrl('http://127.0.0.1:5173/')).toBe(false)
        expect(policy.isTrustedUrl('http://localhost:5173/untrusted.html')).toBe(false)
    })

    it('never grants privileged IPC authority to a subframe', () => {
        const policy = createTrustedRendererPolicy({
            isDev: false,
            productionEntryPath: entryPath,
        })
        const mainFrame = { url: `${pathToFileURL(entryPath).href}#/dashboard` }
        const childFrame = { url: mainFrame.url }

        expect(policy.isTrustedEvent({ senderFrame: mainFrame, sender: { mainFrame } })).toBe(true)
        expect(policy.isTrustedEvent({ senderFrame: childFrame, sender: { mainFrame } })).toBe(false)
    })
})

describe('trusted IPC registry', () => {
    function makeIpcMain() {
        const handlers = new Map()
        const listeners = new Map()
        return {
            handlers,
            listeners,
            handle: vi.fn((channel, listener) => handlers.set(channel, listener)),
            on: vi.fn((channel, listener) => listeners.set(channel, listener)),
            removeListener: vi.fn((channel, listener) => {
                if (listeners.get(channel) === listener) listeners.delete(channel)
            }),
        }
    }

    const trustedEvent = { senderFrame: { url: 'file:///app/dist/index.html#/dashboard' } }
    const untrustedEvent = { senderFrame: { url: 'file:///tmp/untrusted.html' } }
    const policy = {
        isTrustedEvent: event => event === trustedEvent,
        eventUrl: event => event?.senderFrame?.url || '',
    }

    it('rejects invoke handlers before privileged code runs', async () => {
        const ipcMain = makeIpcMain()
        const listener = vi.fn(() => 'ok')
        const rejected = vi.fn()
        const trustedIpc = createTrustedIpc(ipcMain, policy, { onRejected: rejected })
        trustedIpc.handle('dangerous', listener)
        const wrapped = ipcMain.handlers.get('dangerous')

        await expect(wrapped(untrustedEvent, 'payload')).rejects.toMatchObject({ code: 'ERR_UNTRUSTED_RENDERER' })
        expect(listener).not.toHaveBeenCalled()
        expect(rejected).toHaveBeenCalledWith({ channel: 'dangerous', source: 'file:///tmp/untrusted.html' })
        expect(await wrapped(trustedEvent, 'payload')).toBe('ok')
        expect(listener).toHaveBeenCalledWith(trustedEvent, 'payload')
    })

    it('ignores untrusted events and removes the actual wrapped listener', () => {
        const ipcMain = makeIpcMain()
        const listener = vi.fn()
        const trustedIpc = createTrustedIpc(ipcMain, policy)
        trustedIpc.on('window-close', listener)
        const wrapped = ipcMain.listeners.get('window-close')

        wrapped(untrustedEvent)
        expect(listener).not.toHaveBeenCalled()
        wrapped(trustedEvent, 42)
        expect(listener).toHaveBeenCalledWith(trustedEvent, 42)

        trustedIpc.removeListener('window-close', listener)
        expect(ipcMain.removeListener).toHaveBeenCalledWith('window-close', wrapped)
        expect(ipcMain.listeners.has('window-close')).toBe(false)
    })
})
