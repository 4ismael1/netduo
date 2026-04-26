// @vitest-environment node
/**
 * Audits high-risk IPC handlers for input validation before dangerous sinks.
 *
 * This is a static guard because main.js registers Electron handlers at module
 * load time and the vulnerable paths are command/process/network sinks.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const mainPath = path.join(process.cwd(), 'electron', 'main.js')
const source = fs.readFileSync(mainPath, 'utf8')

function handlerBody(channel) {
    const marker = `ipcMain.handle('${channel}'`
    const start = source.indexOf(marker)
    if (start < 0) return ''
    const next = source.indexOf('\nipcMain.handle(', start + marker.length)
    const nextOn = source.indexOf('\nipcMain.on(', start + marker.length)
    const candidates = [next, nextOn].filter(i => i > start)
    const end = candidates.length ? Math.min(...candidates) : source.length
    return source.slice(start, end)
}

describe('IPC input validation before dangerous sinks', () => {
    it('lan-scan validates baseIP as an IPv4 subnet before shell exec', () => {
        const body = handlerBody('lan-scan')
        // Handler still reaches child_process; it doesn't matter whether
        // the underlying helper is `exec` or `execFile` as long as input
        // is validated upstream.
        expect(body).toMatch(/exec\(|execFile\(/)
        // Accept the legacy in-file helpers (isValidIPv4 / sanitizeHost)
        // OR the new validators module surface.
        expect(body).toMatch(/isValidIPv4|sanitizeHost|validateLanScanInputs|validators\.(isSubnetBase|isIPv4)/)
    })

    it('lan-scan-enrich validates item.ip before hostname exec fallbacks', () => {
        const body = handlerBody('lan-scan-enrich')
        expect(body).toMatch(/resolveHostname|pingResolveName|netbiosLookup/)
        expect(body).toMatch(/isValidIPv4|sanitizeHost|validators\.isIPv4/)
    })

    it('scan-ports clamps host and range before building the port array', () => {
        const body = handlerBody('scan-ports')
        expect(body).toContain('for (let p = startPort; p <= endPort; p++)')
        expect(body).toMatch(/sanitizeHost/)
        expect(body).toMatch(/Math\.min|Math\.max/)
    })

    it('report-reveal validates or authorizes file paths before shell reveal', () => {
        const body = handlerBody('report-reveal')
        expect(body).toContain('revealInFolder')
        expect(body).toMatch(/realpath|resolve|exported|allowed|existsSync/)
    })
})
