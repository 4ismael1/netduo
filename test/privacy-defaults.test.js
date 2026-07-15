// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('privacy-sensitive network lookups', () => {
    it('enables geolocation and OUI-only vendor lookup while masking public IP by default', () => {
        const settings = read('src/pages/Settings/Settings.jsx')
        const networkStatus = read('src/lib/useNetworkStatus.jsx')
        const main = read('electron/main.js')

        expect(settings).toMatch(/\[onlineNetworkInfo, setOnlineNetworkInfo\] = useState\(true\)/)
        expect(settings).toMatch(/\[macVendorOnline, setMacVendorOnline\] = useState\(true\)/)
        // Start privacy-sensitive enrichment disabled until persisted config is
        // known, then preserve the product default (enabled unless explicitly
        // disabled). Public IP remains a separate core diagnostic request.
        expect(networkStatus).toMatch(/onlineNetworkInfoRef = useRef\(false\)/)
        expect(networkStatus).toMatch(/cfg\?\.onlineNetworkInfo !== false/)
        expect(networkStatus).toMatch(/includeGeo:\s*false/)
        expect(networkStatus).toMatch(/onlineNetworkInfoRef\.current[\s\S]*request\.includeGeo/)
        expect(main).toContain('https://api.ipify.org?format=json')
        expect(main).toContain('https://icanhazip.com')
        expect(main).toMatch(/onlineAllowed === false/)
        expect(main).toContain('encodeURIComponent(prefix)')
        expect(settings).toContain('never the full MAC address')
        const dashboard = read('src/pages/Dashboard/Dashboard.jsx')
        expect(dashboard).toContain('persistPublicIpVisible(visible)')
        expect(dashboard).not.toContain("style={!showPublicIP ? { visibility: 'hidden' }")
        expect(read('src/lib/publicIpPrivacy.js')).toContain('saved == null ? false')
    })
})
