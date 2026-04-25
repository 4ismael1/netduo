/**
 * Audits pure vendor/hostname classification against noisy OUI strings.
 *
 * Scanner labels and export rows depend on this logic staying deterministic
 * when vendors include punctuation, corporate suffixes, or unexpected text.
 */
import { describe, expect, it } from 'vitest'
import { cleanVendorName, resolveHostnameHint, resolveVendorKey } from '../src/lib/vendorClassify.js'

describe('vendor classification edge cases', () => {
    it.each([
        ['Apple, Inc.', 'Apple'],
        ['SAMSUNG ELECTRONICS CO., LTD.', 'Samsung'],
        ['TP-LINK Technologies Co.,Ltd.', 'TP-Link'],
        ['D-Link International', 'D-Link'],
        ['Hewlett Packard Enterprise', 'HP'],
        ['ASUSTek COMPUTER INC.', 'ASUS'],
        ['Hon Hai Precision Ind. Co.,Ltd.', 'Intel'],
        ['Google Nest LLC', 'Google'],
        ['Western Digital Technologies, Inc.', 'Western Digital'],
        ['Raspberry Pi Trading Ltd.', 'Raspberry Pi'],
    ])('maps %s to %s', (raw, expected) => {
        expect(resolveVendorKey(raw)).toBe(expected)
    })

    it.each([
        ['office-laserjet-5f', 'HP'],
        ['johns-iphone', 'Apple'],
        ['pixel-8-pro', 'Samsung'],
        ['ps5-living-room', 'PlayStation'],
        ['raspberrypi', 'Raspberry Pi'],
        ['ds920-nas', 'Synology'],
    ])('uses hostname hint %s as %s', (hostname, expected) => {
        expect(resolveHostnameHint(hostname)).toBe(expected)
    })

    it('returns null for empty, null, and non-string vendors', () => {
        expect(resolveVendorKey('')).toBeNull()
        expect(resolveVendorKey(null)).toBeNull()
        expect(resolveVendorKey({ name: 'Apple' })).toBeNull()
    })

    it('cleans layered corporate suffixes without truncating meaningful words', () => {
        expect(cleanVendorName('Tenda Technology Co.,Ltd.Dongguan branch')).toBe('Tenda Technology')
        expect(cleanVendorName('Example Networks Co., Ltd., Inc.')).toBe('Example Networks')
        expect(cleanVendorName('  Foo   Bar   GmbH  ')).toBe('Foo Bar')
    })

    it('does not throw for 100 noisy vendor-like strings', () => {
        for (let i = 0; i < 100; i += 1) {
            const raw = `Vendor ${i} Co., Ltd. ${'x'.repeat(i % 17)} <> "'`
            expect(() => cleanVendorName(raw)).not.toThrow()
            expect(() => resolveVendorKey(raw)).not.toThrow()
        }
    })
})
