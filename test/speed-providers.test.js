// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Speed Test providers', () => {
    it('offers only M-Lab and Cloudflare in production and fallback modes', () => {
        const main = read('electron/main.js')
        const fallback = read('src/lib/electronBridge.js')
        const speedServerBlock = main.slice(main.indexOf('const SPEED_SERVERS = ['), main.indexOf('// -- Speed test cancellation'))
        const fallbackBlock = fallback.slice(fallback.indexOf('speedGetServers:'), fallback.indexOf('speedTestFull:'))

        expect(speedServerBlock.match(/\bid:\s*'/g)).toHaveLength(2)
        expect(speedServerBlock).toContain("id: 'mlab'")
        expect(speedServerBlock).toContain("id: 'cloudflare'")
        expect(speedServerBlock).not.toMatch(/hetzner|ovh/i)
        expect(fallbackBlock).not.toMatch(/hetzner|ovh/i)
    })
})
