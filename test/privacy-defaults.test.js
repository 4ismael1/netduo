// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('privacy-sensitive network lookups', () => {
    it('keeps geolocation and vendor lookup opt-in while public IP remains available', () => {
        const settings = read('src/pages/Settings/Settings.jsx')
        const networkStatus = read('src/lib/useNetworkStatus.jsx')
        const main = read('electron/main.js')

        expect(settings).toContain("useState(false)\n    const [onlineNetworkInfo")
        expect(settings).toMatch(/\[macVendorOnline, setMacVendorOnline\] = useState\(false\)/)
        expect(networkStatus).toMatch(/onlineNetworkInfoRef = useRef\(false\)/)
        expect(networkStatus).toContain('Public IP is a core diagnostic value.')
        expect(networkStatus).toMatch(/onlineNetworkInfoRef\.current && !skipGeo/)
        expect(main).toContain('https://api.ipify.org?format=json')
        expect(main).toContain('https://icanhazip.com')
        expect(main).toMatch(/onlineAllowed !== true/)
        expect(main).toContain('encodeURIComponent(prefix)')
    })
})
