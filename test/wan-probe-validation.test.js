// @vitest-environment node
/**
 * Validates the wan-probe-request security policy at a static level.
 *
 * The handler itself wires into Electron at module load, so we verify:
 *   - The handler body reads its policy flags from the expected names
 *     (allowHttp, allowPrivate, allowInsecure) — tests guard against
 *     regressions where one flag is accidentally removed.
 *   - allowInsecure now defaults to SECURE (rejectUnauthorized:true
 *     unless caller opts in) rather than the old insecure-by-default.
 *   - The isPrivateHost policy captures every range we care about, so
 *     a future refactor that removes a branch fails this suite.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = fs.readFileSync(path.join(process.cwd(), 'electron', 'main.js'), 'utf8')

function handlerBody(channel) {
    const marker = `ipcMain.handle('${channel}'`
    const start = mainSource.indexOf(marker)
    if (start < 0) return ''
    const next = mainSource.indexOf('\nipcMain.handle(', start + marker.length)
    const nextOn = mainSource.indexOf('\nipcMain.on(', start + marker.length)
    const ends = [next, nextOn].filter(i => i > start)
    const end = ends.length ? Math.min(...ends) : mainSource.length
    return mainSource.slice(start, end)
}

describe('wan-probe-request security policy', () => {
    const body = handlerBody('wan-probe-request')

    it('enforces HTTPS by default with allowHttp opt-in', () => {
        expect(body).toMatch(/allowHttp/)
        expect(body).toMatch(/Plain HTTP blocked/)
    })

    it('blocks private targets by default with allowPrivate opt-in', () => {
        expect(body).toMatch(/allowPrivate/)
        expect(body).toMatch(/isPrivateHost/)
    })

    it('rejects custom HTTP methods', () => {
        expect(body).toMatch(/isAllowedHttpMethod|PROBE_HTTP_METHODS/)
    })

    it('defaults allowInsecure to false (strict TLS)', () => {
        // The regression we guard against: `allowInsecure !== false` makes
        // it insecure-by-default. Must be `=== true` or equivalent.
        expect(body).not.toMatch(/allowInsecure !== false/)
        expect(body).toMatch(/allowInsecure === true/)
    })

    it('rejectUnauthorized is the negation of allowInsecure', () => {
        expect(body).toMatch(/rejectUnauthorized:\s*!allowInsecure/)
    })
})

describe('isPrivateHost policy coverage', () => {
    // We assert the source contains each range rather than importing
    // the helper — main.js side-effects (Electron setup, IPC handler
    // registration) make direct import expensive for a CLI test run.
    it.each([
        ['10.0.0.0/8', /=== 10\)/],
        ['127.0.0.0/8 loopback', /=== 127\)/],
        ['169.254.0.0/16 link-local', /=== 169 && b === 254/],
        ['172.16.0.0/12', /=== 172 && b >= 16 && b <= 31/],
        ['192.168.0.0/16', /=== 192 && b === 168/],
        ['100.64.0.0/10 CGN', /=== 100 && b >= 64 && b <= 127/],
        ['multicast (>=224)', />= 224/],
        ['localhost literal', /=== 'localhost'/],
        ['.local mDNS', /endsWith\('\.local'\)/],
        ['IPv6 ::1', /=== '::1'/],
        ['IPv6 unique-local fc/fd', /fc|fd/],
        ['IPv6 link-local fe80', /fe80/],
    ])('covers %s', (_label, pattern) => {
        expect(mainSource).toMatch(pattern)
    })
})
