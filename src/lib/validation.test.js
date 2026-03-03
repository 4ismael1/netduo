import { describe, expect, it } from 'vitest'
import {
    isValidBaseSubnet,
    isValidHostname,
    isValidIpv4,
    isValidMac,
    isValidPortRange,
    isValidTarget,
    normalizeMac,
    normalizeTargetInput,
    validateLanScanInputs,
} from './validation'

describe('validation.normalizeTargetInput', () => {
    it('strips protocol, path and port from domain targets', () => {
        expect(normalizeTargetInput(' https://example.com:443/path?q=1 ')).toBe('example.com')
    })

    it('strips port from ipv4 targets', () => {
        expect(normalizeTargetInput('1.1.1.1:53')).toBe('1.1.1.1')
    })
})

describe('validation.ip-and-host', () => {
    it('validates strict ipv4 octets', () => {
        expect(isValidIpv4('192.168.0.1')).toBe(true)
        expect(isValidIpv4('999.168.0.1')).toBe(false)
    })

    it('validates hostnames with tld and rejects free-form words', () => {
        expect(isValidHostname('google.com')).toBe(true)
        expect(isValidHostname('ssjs')).toBe(false)
        expect(isValidHostname('-bad.example')).toBe(false)
    })

    it('validates generic targets (ip or domain)', () => {
        expect(isValidTarget('8.8.8.8')).toBe(true)
        expect(isValidTarget('https://cloudflare.com/dns')).toBe(true)
        expect(isValidTarget('ssjs')).toBe(false)
    })
})

describe('validation.mac', () => {
    it('accepts common mac formats', () => {
        expect(isValidMac('00:1A:2B:3C:4D:5E')).toBe(true)
        expect(isValidMac('00-1A-2B-3C-4D-5E')).toBe(true)
        expect(isValidMac('001A2B3C4D5E')).toBe(false)
    })

    it('normalizes mac to lowercase colon format', () => {
        expect(normalizeMac('00-1A-2B-3C-4D-5E')).toBe('00:1a:2b:3c:4d:5e')
    })
})

describe('validation.ports-and-lan-scan', () => {
    it('validates port ranges', () => {
        expect(isValidPortRange(1, 65535)).toBe(true)
        expect(isValidPortRange(9000, 8000)).toBe(false)
        expect(isValidPortRange(0, 100)).toBe(false)
    })

    it('validates scanner subnet base and range', () => {
        expect(isValidBaseSubnet('192.168.0')).toBe(true)
        expect(isValidBaseSubnet('192.168.999')).toBe(false)
        expect(validateLanScanInputs('192.168.0', 1, 254)).toEqual({
            ok: true,
            baseIP: '192.168.0',
            start: 1,
            end: 254,
        })
        expect(validateLanScanInputs('192.168.0', 300, 400)).toEqual({
            ok: false,
            error: 'Range must be between 1 and 254',
        })
    })
})
