// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('application version display', () => {
    it('uses the packaged application version instead of a hard-coded label', () => {
        const pkg = JSON.parse(read('package.json'))
        const lock = JSON.parse(read('package-lock.json'))
        const main = read('electron/main.js')
        const preload = read('electron/preload.js')
        const bridge = read('src/lib/electronBridge.js')
        const settings = read('src/pages/Settings/Settings.jsx')

        expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
        expect(lock.version).toBe(pkg.version)
        expect(lock.packages[''].version).toBe(pkg.version)
        expect(main).toMatch(/(?:trustedIpc|ipcMain)\.handle\('get-app-version', \(\) => app\.getVersion\(\)\)/)
        expect(preload).toContain("getAppVersion: () => ipcRenderer.invoke('get-app-version')")
        expect(bridge).toContain('getAppVersion: () => API?.getAppVersion')
        expect(settings).toContain('v{appVersion}')
        expect(settings).toContain('tree/${versionTag}')
        expect(settings).not.toMatch(/v1\.\d+\.\d+/)
    })
})
