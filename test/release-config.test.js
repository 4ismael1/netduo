// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const readJson = relative => JSON.parse(read(relative))

describe('1.4.2 release configuration', () => {
    const pkg = readJson('package.json')
    const lock = readJson('package-lock.json')

    it('keeps package and lock versions identical', () => {
        expect(pkg.version).toBe('1.4.2')
        expect(lock.version).toBe(pkg.version)
        expect(lock.packages?.['']?.version).toBe(pkg.version)
    })

    it('uses a supported Electron generation selected for this release', () => {
        const declared = String(pkg.devDependencies?.electron || '')
        const major = Number.parseInt(declared.match(/\d+/)?.[0] || '0', 10)
        expect(major).toBeGreaterThanOrEqual(42)
        expect(pkg.devDependencies).toHaveProperty('@electron/rebuild')
        expect(pkg.scripts?.['electron:build']).toContain('npm run rebuild:electron-native')
        expect(pkg.scripts?.['electron:build']).toContain('npm run verify:electron-native')
        expect(pkg.scripts?.['appx:build']).toContain('npm run verify:electron-native')
    })

    it('does not ship renderer-only packages as runtime dependencies', () => {
        const rendererOnly = [
            'react', 'react-dom', 'react-router-dom',
            'recharts', 'framer-motion', 'lucide-react',
        ]
        for (const name of rendererOnly) {
            expect(pkg.dependencies).not.toHaveProperty(name)
            expect(pkg.devDependencies).toHaveProperty(name)
        }
        expect(Object.keys(pkg.dependencies).sort()).toEqual(['better-sqlite3', 'ws'])
    })

    it('packages only supported Chromium languages and excludes test sources', () => {
        expect(pkg.build?.electronLanguages).toEqual(['en-US', 'es'])
        expect(pkg.build?.files).toContain('!electron/**/*.test.js')
        expect(pkg.build?.files).toContain('!node_modules/better-sqlite3/deps/**')
        expect(pkg.build?.files).toContain('!node_modules/better-sqlite3/src/**')
    })

    it('distributes project and font licenses', () => {
        const resources = pkg.build?.extraResources || []
        expect(resources.some(item => item?.from === 'LICENSE')).toBe(true)
        expect(resources.some(item => item?.from === 'NOTICE')).toBe(true)
        expect(fs.existsSync(path.join(root, 'public/fonts/OFL-Space-Grotesk.txt'))).toBe(true)
        expect(fs.existsSync(path.join(root, 'public/fonts/OFL-Space-Mono.txt'))).toBe(true)
    })

    it('uses only local fonts and a local pre-paint boot script', () => {
        const html = read('index.html')
        expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/i)
        expect(html).toContain('/fonts/netduo-fonts.css')
        expect(html).toContain('/netduo-boot.js')
        expect(html).not.toMatch(/<script>(?:.|\r?\n)*?<\/script>/i)
    })

    it('documents the encrypted geolocation provider actually used by the app', () => {
        const privacy = read('docs/privacy.md')
        expect(privacy).toContain('`ipwho.is`')
        expect(privacy).not.toContain('`ip-api.com`')
        expect(privacy).toContain('stateless HTTPS requests')
    })

    it('keeps production CSP free of remote font origins and inline scripts', () => {
        const main = read('electron/main.js')
        const prodBlock = main.match(/const cspProd = \[(.*?)\]\.join\('; '\)/s)?.[1] || ''
        expect(prodBlock).not.toMatch(/fonts\.(googleapis|gstatic)\.com/i)
        expect(prodBlock).not.toMatch(/script-src[^\n]*unsafe-inline/i)
    })

    it('keeps privileged IPC behind the trusted-renderer boundary', () => {
        const main = read('electron/main.js')
        expect(main).toContain('createTrustedIpc(ipcMain, trustedRendererPolicy')
        expect(main).not.toMatch(/ipcMain\.(?:handle|on|removeListener)\s*\(/)
    })

    it('bounds native output, online vendor cache, and shutdown ownership', () => {
        const main = read('electron/main.js')
        expect(main).toContain('NATIVE_PROCESS_OUTPUT_LIMIT_BYTES')
        expect(main).toContain('VENDOR_CACHE_MAX_ENTRIES')
        expect(main).toContain('VENDOR_CACHE_FAILURE_TTL_MS')
        expect(main).not.toContain('appendFileSync')
        expect(main).toContain('app.requestSingleInstanceLock()')
        expect(main).toContain("app.on('second-instance', focusPrimaryWindow)")
        for (const [label, cleanup] of [
            ['mtr', 'stopAllMtrSessions'],
            ['speed-test', 'cancelSpeedTest'],
            ['port-scan', 'cancelPortScan'],
            ['lan-security', 'cancelAllLanSecuritySessions'],
            ['lan-scan', 'cancelAllLanScanSessions'],
            ['streaming-processes', 'stopAllTrackedProcesses'],
            ['native-processes', 'stopAllNativeProcesses'],
        ]) expect(main).toContain(`runCleanupStep('${label}', ${cleanup})`)
    })

    it('uses only command-free signals for the five-second network fingerprint', () => {
        const main = read('electron/main.js')
        const body = main.match(/function currentInterfaceFingerprint\(\) \{(.*?)\n\}/s)?.[1] || ''
        expect(body).toContain('os.networkInterfaces()')
        expect(body).toContain('fastDnsServers()')
        expect(body).not.toMatch(/runProgram|execFile|spawn|powershell/i)
    })
})
