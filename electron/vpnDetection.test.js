// @vitest-environment node

const { isActiveVpnCandidate } = require('./vpnDetection')

describe('VPN active-state evidence', () => {
    it('rejects a disconnected adapter with a stale address and host routes', () => {
        expect(isActiveVpnCandidate({
            adapterUp: false,
            ifaceConnected: false,
            localIps: ['100.64.100.6'],
            routeCount: 2,
            defaultRoute: false,
        })).toBe(false)
    })

    it('accepts a connected split tunnel with an address and scoped routes', () => {
        expect(isActiveVpnCandidate({
            adapterUp: true,
            ifaceConnected: true,
            localIps: ['10.8.0.2'],
            routeCount: 3,
            defaultRoute: false,
        })).toBe(true)
    })

    it('requires an assigned address and a meaningful route', () => {
        expect(isActiveVpnCandidate({ adapterUp: true, ifaceConnected: true, routeCount: 1 })).toBe(false)
        expect(isActiveVpnCandidate({ adapterUp: true, ifaceConnected: true, localIps: ['10.8.0.2'], routeCount: 0 })).toBe(false)
    })
})
