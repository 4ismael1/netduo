// @vitest-environment node
/**
 * Audits report CSV serialization for Excel/RFC4180 compatibility.
 *
 * Network diagnostics include user-controlled hostnames, notes, vendors, and
 * probe output, so commas, quotes, newlines, UTF-8, and spreadsheet formulas
 * must be handled deliberately.
 */
import { describe, expect, it } from 'vitest'
import { buildCSV, escapeCell } from '../electron/reports/csv.js'

describe('report CSV serialization', () => {
    it('prefixes UTF-8 CSV with a BOM for Excel', () => {
        const csv = buildCSV(['Name'], [{ name: 'Estacion' }], row => [row.name])
        expect(csv.charCodeAt(0)).toBe(0xFEFF)
    })

    it('escapes commas, quotes, CRLF and LF using RFC4180 quoting', () => {
        expect(escapeCell('alpha,beta')).toBe('"alpha,beta"')
        expect(escapeCell('say "hello"')).toBe('"say ""hello"""')
        expect(escapeCell('line1\nline2')).toBe('"line1\nline2"')
        expect(escapeCell('line1\r\nline2')).toBe('"line1\r\nline2"')
    })

    it('serializes null and undefined as empty cells', () => {
        expect(escapeCell(null)).toBe('')
        expect(escapeCell(undefined)).toBe('')
    })

    it('uses CRLF row endings and a final newline', () => {
        const csv = buildCSV(['A', 'B'], [{ a: 1, b: 2 }], row => [row.a, row.b])
        expect(csv).toBe('\uFEFFA,B\r\n1,2\r\n')
    })

    it('preserves Unicode device names', () => {
        const csv = buildCSV(['Device'], [{ name: 'Camara sala' }], row => [row.name])
        expect(csv).toContain('Camara sala')
    })

    it('neutralizes spreadsheet formula injection values', () => {
        // Neutralisation prefixes a leading apostrophe (stripped by
        // Excel on display, disables formula evaluation). RFC 4180
        // quoting rules still apply *after* the apostrophe is added —
        // cells with commas or quotes must be wrapped.
        expect(escapeCell('=HYPERLINK("http://example.test","click")')).toBe(
            '"\'=HYPERLINK(""http://example.test"",""click"")"'
        )
        expect(escapeCell('+SUM(1,2)')).toBe('"\'+SUM(1,2)"')
        expect(escapeCell('-10+20')).toBe("'-10+20")
        expect(escapeCell('@cmd')).toBe("'@cmd")
    })

    it('leaves pure negative numbers alone so spreadsheets parse them as numbers', () => {
        expect(escapeCell('-12')).toBe('-12')
        expect(escapeCell('-12.5')).toBe('-12.5')
    })

    it('neutralizes tab and carriage-return leading chars', () => {
        // Both would open auto-conversion behavior in some parsers.
        expect(escapeCell('\tHYPERLINK("x","y")')).toBe('"\'\tHYPERLINK(""x"",""y"")"')
        expect(escapeCell('\rpayload')).toBe('"\'\rpayload"')
    })
})
