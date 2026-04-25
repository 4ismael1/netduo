// @vitest-environment node
/**
 * Audits local OUI lookup prefixes used when the online MAC vendor API is off.
 *
 * The scanner must classify common devices offline and normalize separators
 * consistently for colon and dash MAC strings.
 */
import { describe, expect, it } from 'vitest'
import { lookupVendor } from '../electron/oui-db.js'

describe('local OUI lookup', () => {
    it.each([
        ['00:03:93:12:34:56', 'Apple'],
        ['00-03-93-12-34-56', 'Apple'],
        ['00:07:AB:12:34:56', 'Samsung'],
        ['30:FD:38:12:34:56', 'Google'],
        ['1C:61:B4:12:34:56', 'TP-Link Kasa'],
        ['34:94:54:12:34:56', 'Shelly'],
    ])('maps %s to %s', (mac, expected) => {
        expect(lookupVendor(mac)).toBe(expected)
    })

    it('returns null for unknown, empty, and non-string MAC values', () => {
        expect(lookupVendor('12:34:56:78:90:ab')).toBeNull()
        expect(lookupVendor('')).toBeNull()
        expect(lookupVendor(null)).toBeNull()
        expect(lookupVendor({ mac: '00:03:93:12:34:56' })).toBeNull()
    })

    it('does not falsely map incomplete prefixes', () => {
        expect(lookupVendor('00:03')).toBeNull()
    })
})
