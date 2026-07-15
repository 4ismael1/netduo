const { fingerprintNetworkInterfaces } = require('./networkFingerprint')

describe('network interface fingerprint', () => {
    it('tracks useful IPv4 and IPv6 without link-local noise or ordering changes', () => {
        const first = fingerprintNetworkInterfaces({
            Ethernet: [
                { family: 'IPv6', address: 'fe80::1%12', internal: false, mac: 'AA:BB' },
                { family: 'IPv6', address: '2001:DB8::20%12', internal: false, mac: 'AA:BB' },
                { family: 'IPv4', address: '192.168.1.20', netmask: '255.255.255.0', internal: false, mac: 'AA:BB' },
            ],
        })
        const reordered = fingerprintNetworkInterfaces({
            Ethernet: [
                { family: 'IPv4', address: '192.168.1.20', netmask: '255.255.255.0', internal: false, mac: 'aa:bb' },
                { family: 'IPv6', address: '2001:db8::20', internal: false, mac: 'aa:bb' },
            ],
        })
        expect(first).toBe(reordered)
        expect(first).toContain('6|ethernet|2001:db8::20')
        expect(first).not.toContain('fe80')
    })

    it('changes on an IPv6-only network transition', () => {
        const before = fingerprintNetworkInterfaces({ Ethernet: [{ family: 6, address: '2001:db8::10', internal: false }] })
        const after = fingerprintNetworkInterfaces({ Ethernet: [{ family: 6, address: '2001:db8:2::10', internal: false }] })
        expect(after).not.toBe(before)
    })

    it('tracks DNS route signals without depending on server order', () => {
        const interfaces = { Ethernet: [{ family: 4, address: '192.168.1.20', internal: false }] }
        const before = fingerprintNetworkInterfaces(interfaces, ['192.168.1.1', '1.1.1.1'])
        const reordered = fingerprintNetworkInterfaces(interfaces, ['1.1.1.1', '192.168.1.1'])
        const throughVpn = fingerprintNetworkInterfaces(interfaces, ['10.8.0.1'])

        expect(reordered).toBe(before)
        expect(throughVpn).not.toBe(before)
    })
})
