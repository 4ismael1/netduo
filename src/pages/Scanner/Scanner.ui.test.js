// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.join(process.cwd(), 'src', 'pages', 'Scanner', 'Scanner.jsx'), 'utf8')
const sidebarSource = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'Sidebar', 'Sidebar.jsx'), 'utf8')
const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf8')

describe('Scanner progressive configuration UI', () => {
    it('starts with the recommended automatic configuration', () => {
        expect(source).toContain("useState('auto')")
        expect(source).toContain("useState('balanced')")
        expect(source).not.toContain("configGet?.('scanner.discoveryMode')")
        expect(source).toContain('Recommended (default)')
        expect(source).toContain('Detect automatically (default)')
    })

    it('keeps technical controls behind a collapsed accessible panel', () => {
        expect(source).toContain('const [advancedOpen, setAdvancedOpen] = useState(false)')
        expect(source).toContain('aria-expanded={advancedOpen}')
        expect(source).toContain('aria-controls="scanner-advanced-options"')
        expect(source).toContain('{advancedOpen && (')
        expect(source).toContain('You normally do not need to change these settings.')
    })

    it('keeps an active scan outside the route and signals it only when Scanner is not open', () => {
        expect(source).toContain('useScannerSession()')
        expect(source).toContain('beginScannerSession({')
        expect(appSource).toContain('<OperationNetworkGuard />')
        expect(sidebarSource).toContain("if (location.pathname === path) return null")
        expect(sidebarSource).toContain("matches.push({ kind: 'scan', status: 'running', label: 'LAN scan in progress' })")
    })

    it('uses neutral presence while a re-scan verifies the last completed result', () => {
        expect(source).toContain('buildScanPresenceInput(devices, runDevices')
        expect(source).toContain('setScannerRunDevices([...foundRaw])')
        expect(source).toContain("d.presence === 'checking'")
        expect(source).toContain('Verifying')
        expect(source).toContain('Not checked')
    })
})
