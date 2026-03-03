/**
 * scanner.test.js
 * Tests for LAN Scanner OUI vendor detection and device classification logic
 */
import { describe, it, expect } from 'vitest'

// ─── OUI vendor map (same as in Scanner.jsx) ─────────────────────────────
const OUI_MAP = {
    'Apple': ['00:03:93', '00:0a:95', 'ac:de:48', 'a4:c3:61', 'f4:5c:89'],
    'Samsung': ['00:07:ab', '78:1f:db', 'cc:07:ab', 'f4:7b:5e'],
    'Google': ['f4:f5:d8', '54:60:09', '3c:5a:b4', '48:d6:d5'],
    'TP-Link': ['00:1d:0f', '14:cc:20', 'c4:e9:84', '54:a6:5e'],
    'Cisco': ['00:00:0c', '00:01:42', '00:04:6d'],
    'ASUS': ['00:0c:6e', '10:bf:48', '2c:56:dc', '88:d7:f6'],
}

function guessVendor(mac) {
    if (!mac) return 'Unknown'
    const pfx = mac.toLowerCase().slice(0, 8)
    for (const [vendor, prefixes] of Object.entries(OUI_MAP)) {
        if (prefixes.some(p => pfx.startsWith(p.toLowerCase()))) return vendor
    }
    return 'Unknown'
}

describe('LAN Scanner guessVendor()', () => {
    // Known vendors
    it('detects Apple from a4:c3:61', () => expect(guessVendor('a4:c3:61:9f:00:01')).toBe('Apple'))
    it('detects Apple from ac:de:48', () => expect(guessVendor('ac:de:48:00:11:22')).toBe('Apple'))
    it('detects Samsung from 78:1f:db', () => expect(guessVendor('78:1f:db:55:66:77')).toBe('Samsung'))
    it('detects Google from f4:f5:d8', () => expect(guessVendor('f4:f5:d8:ab:cd:ef')).toBe('Google'))
    it('detects TP-Link from c4:e9:84', () => expect(guessVendor('c4:e9:84:0a:11:22')).toBe('TP-Link'))
    it('detects Cisco from 00:01:42', () => expect(guessVendor('00:01:42:ff:ee:dd')).toBe('Cisco'))
    it('detects ASUS from 88:d7:f6', () => expect(guessVendor('88:d7:f6:aa:bb:cc')).toBe('ASUS'))

    // Unknown and edge cases
    it('returns Unknown for unrecognized MAC', () => expect(guessVendor('de:ad:be:ef:00:01')).toBe('Unknown'))
    it('returns Unknown for empty string', () => expect(guessVendor('')).toBe('Unknown'))
    it('returns Unknown for null', () => expect(guessVendor(null)).toBe('Unknown'))
    it('is case-insensitive', () => expect(guessVendor('A4:C3:61:9F:00:01')).toBe('Apple'))
})

// ─── IP range filtering ───────────────────────────────────────────────────
describe('LAN Scanner IP range filtering', () => {
    function ipInRange(ip, base, start, end) {
        const parts = ip.split('.')
        if (!ip.startsWith(base + '.')) return false
        const last = parseInt(parts[parts.length - 1])
        return last >= start && last <= end
    }

    it('filters IPs within range', () => {
        expect(ipInRange('192.168.1.100', '192.168.1', 1, 254)).toBe(true)
        expect(ipInRange('192.168.1.1', '192.168.1', 1, 254)).toBe(true)
        expect(ipInRange('192.168.1.254', '192.168.1', 1, 254)).toBe(true)
    })

    it('excludes IPs outside range', () => {
        expect(ipInRange('192.168.1.0', '192.168.1', 1, 254)).toBe(false)
        expect(ipInRange('192.168.1.255', '192.168.1', 1, 200)).toBe(false)
    })

    it('excludes different subnet', () => {
        expect(ipInRange('10.0.0.1', '192.168.1', 1, 254)).toBe(false)
    })
})
