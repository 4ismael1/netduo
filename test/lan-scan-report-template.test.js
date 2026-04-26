// @vitest-environment node
/**
 * Validates LAN scan export status mapping.
 *
 * The Scanner UI now distinguishes active Online devices from cache-only
 * Cached devices, and exported CSV/PDF must not collapse those back together.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const localRequire = createRequire(import.meta.url)
const { buildHTML, buildCSVData } = localRequire('../electron/reports/templates/lan-scan.js')

describe('LAN scan report template', () => {
    const cachedDevice = {
        ip: '192.168.1.42',
        mac: 'aa:bb:cc:dd:ee:42',
        hostname: 'phone',
        deviceType: 'Phone',
        presence: 'cached',
        alive: false,
        seenOnly: true,
        isNew: true,
        neighborState: 'stale',
    }

    it('renders cached presence in HTML output', () => {
        const html = buildHTML({
            baseIP: '192.168.1',
            range: { start: 1, end: 254 },
            devices: [cachedDevice],
        })

        expect(html).toContain('Cached')
        expect(html).not.toContain('<span class="badge ok">Online</span>')
    })

    it('exports cached presence and neighbor state in CSV data', () => {
        const csv = buildCSVData({ devices: [cachedDevice] })
        const row = csv.extract(cachedDevice, 0)

        expect(csv.headers).toContain('Neighbor state')
        expect(row[csv.headers.indexOf('Status')]).toBe('cached')
        expect(row[csv.headers.indexOf('New')]).toBe('yes')
        expect(row[csv.headers.indexOf('Neighbor state')]).toBe('stale')
    })
})
