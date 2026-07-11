import { describe, expect, it } from 'vitest'
import { canProbeGateway } from './gatewayProbe'

describe('gateway probe eligibility', () => {
    it('probes a detected gateway on a connected non-VPN network', () => {
        expect(canProbeGateway({ connected: true, gateway: '192.168.100.1', isVpn: false })).toBe(true)
    })

    it('does not probe without a gateway or through a VPN tunnel', () => {
        expect(canProbeGateway({ connected: true, gateway: null, isVpn: false })).toBe(false)
        expect(canProbeGateway({ connected: true, gateway: '192.168.100.1', isVpn: true })).toBe(false)
    })
})
