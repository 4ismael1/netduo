const {
    buildWindowsNetworkContextScript,
    prefixFromNetmask,
    netmaskFromPrefix,
    subnetDetails,
    normalizeContexts,
} = require('./networkContext')

describe('networkContext IPv4 calculations', () => {
    it('builds syntactically safe PowerShell without corrupting hash literals', () => {
        const script = buildWindowsNetworkContextScript()
        expect(script).toContain('[PSCustomObject]@{\n')
        expect(script).not.toContain('@{;')
        expect(script).toContain('Get-NetRoute -AddressFamily IPv4')
        expect(script).toContain('ConvertTo-Json -Compress')
    })

    it('converts masks and prefixes', () => {
        expect(prefixFromNetmask('255.255.254.0')).toBe(23)
        expect(netmaskFromPrefix(25)).toBe('255.255.255.128')
        expect(prefixFromNetmask('255.0.255.0')).toBeNull()
    })

    it('derives a non-/24 subnet and usable range', () => {
        expect(subnetDetails('192.168.11.42', 23)).toEqual(expect.objectContaining({
            cidr: '192.168.10.0/23',
            networkAddress: '192.168.10.0',
            broadcastAddress: '192.168.11.255',
            firstHost: '192.168.10.1',
            lastHost: '192.168.11.254',
            hostCount: 510,
        }))
    })

    it('prefers the real default route rather than assuming .1', () => {
        const contexts = normalizeContexts([
            { IPAddress: '10.20.30.40', PrefixLength: 24, InterfaceAlias: 'Wi-Fi', NextHop: '10.20.30.254', RouteMetric: 5, InterfaceMetric: 20 },
            { IPAddress: '172.16.1.4', PrefixLength: 24, InterfaceAlias: 'VPN', NextHop: null },
        ], 'windows-route')
        expect(contexts[0]).toEqual(expect.objectContaining({
            gateway: '10.20.30.254',
            cidr: '10.20.30.0/24',
        }))
    })
})
