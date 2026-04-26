import { describe, it, expect } from 'vitest'
import { resolveVendorKey, resolveHostnameHint, cleanVendorName } from './vendorClassify'

describe('resolveVendorKey', () => {
    it('matches common vendors in varied corporate formats', () => {
        expect(resolveVendorKey('Apple, Inc.')).toBe('Apple')
        expect(resolveVendorKey('Samsung Electronics Co., Ltd.')).toBe('Samsung')
        expect(resolveVendorKey('Tenda Technology Co.,Ltd.Dongguan branch')).toBe('Tenda')
        expect(resolveVendorKey('Hewlett-Packard Company')).toBe('HP')
        expect(resolveVendorKey('Intel Corporate')).toBe('Intel')
        expect(resolveVendorKey('TP-Link Technologies Co.,Ltd.')).toBe('TP-Link')
        expect(resolveVendorKey('Raspberry Pi Trading Ltd')).toBe('Raspberry Pi')
    })
    it('prefers specific matches over generic (Apple over Intel when both could apply)', () => {
        expect(resolveVendorKey('Apple, Inc. (Intel Mac)')).toBe('Apple')
    })
    it('returns null for unknown vendors', () => {
        expect(resolveVendorKey('Some Random Vendor LLC')).toBeNull()
        expect(resolveVendorKey('Completely Fictional Maker')).toBeNull()
    })
    it('handles empty / null / non-string input', () => {
        expect(resolveVendorKey(null)).toBeNull()
        expect(resolveVendorKey('')).toBeNull()
        expect(resolveVendorKey(undefined)).toBeNull()
        expect(resolveVendorKey(123)).toBeNull()
    })
})

describe('resolveHostnameHint', () => {
    it('classifies device types from hostname clues', () => {
        expect(resolveHostnameHint('iphone-de-juan')).toBe('Apple')
        expect(resolveHostnameHint('Office-Printer-LaserJet')).toBe('HP')
        expect(resolveHostnameHint('living-room-ps5')).toBe('PlayStation')
        expect(resolveHostnameHint('xbox-sala')).toBe('Xbox')
        expect(resolveHostnameHint('raspi-kitchen')).toBe('Raspberry Pi')
        expect(resolveHostnameHint('roku-ultra')).toBe('Roku')
        expect(resolveHostnameHint('front-door-onvif-camera')).toBe('IP Camera')
    })
    it('returns null when nothing matches', () => {
        expect(resolveHostnameHint('my-generic-host')).toBeNull()
        expect(resolveHostnameHint(null)).toBeNull()
        expect(resolveHostnameHint('')).toBeNull()
    })
})

describe('cleanVendorName', () => {
    const cases = [
        ['Apple, Inc.',                                    'Apple'],
        ['Samsung Electronics Co., Ltd.',                  'Samsung Electronics'],
        ['Tenda Technology Co.,Ltd.Dongguan branch',       'Tenda Technology'],
        ['Hewlett Packard Enterprise',                     'Hewlett Packard Enterprise'],
        ['Intel Corporate',                                'Intel'],
        ['TP-Link Technologies Co.,Ltd.',                  'TP-Link Technologies'],
        ['Tuya Smart Inc.',                                'Tuya Smart'],
        ['Microsoft Corporation',                          'Microsoft'],
        ['Raspberry Pi Trading Ltd',                       'Raspberry Pi Trading'],
        ['Signify Netherlands B.V.',                       'Signify Netherlands'],
        ['Some Random Vendor LLC',                         'Some Random Vendor'],
    ]
    it.each(cases)('cleanVendorName(%j) → %j', (raw, expected) => {
        expect(cleanVendorName(raw)).toBe(expected)
    })
    it('returns null for falsy or whitespace-only input', () => {
        expect(cleanVendorName('')).toBeNull()
        expect(cleanVendorName('   ')).toBeNull()
        expect(cleanVendorName(null)).toBeNull()
        expect(cleanVendorName(undefined)).toBeNull()
        expect(cleanVendorName(42)).toBeNull()
    })
    it('preserves already-clean names without changing them', () => {
        expect(cleanVendorName('TP-Link')).toBe('TP-Link')
        expect(cleanVendorName('Google')).toBe('Google')
    })
})
