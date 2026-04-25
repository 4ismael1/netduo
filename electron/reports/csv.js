/**
 * CSV serialization helper.
 *
 * Produces Excel-friendly UTF-8 CSVs:
 * - Prefixes the output with a BOM so Excel treats it as UTF-8 and
 *   renders accents correctly.
 * - Escapes cells containing commas, quotes or newlines by wrapping
 *   them in double quotes and doubling internal quotes (RFC 4180).
 * - Renders null / undefined as empty strings.
 *
 * Usage:
 *   const csv = buildCSV(
 *     ['IP', 'MAC', 'Vendor'],
 *     [
 *       { ip: '10.0.0.1', mac: '...', vendor: 'Cisco' },
 *       ...
 *     ],
 *     row => [row.ip, row.mac, row.vendor]
 *   )
 */

const BOM = '\uFEFF'

/**
 * Characters that cause Excel / LibreOffice / Google Sheets to interpret
 * a cell as a formula when they appear as the first character. Leaving
 * them raw turns untrusted text (vendor names, hostnames, notes) into a
 * CSV-injection / formula-injection vector — e.g. a device with hostname
 * `=HYPERLINK("http://evil","Click")` opens a live link in the user's
 * spreadsheet.
 *
 * Neutralise by prefixing a single apostrophe — Excel strips it on
 * display but the cell no longer evaluates as a formula.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/

/**
 * Escape a single cell value for CSV (RFC 4180 + formula-injection
 * neutralisation).
 * @param {*} value
 * @returns {string}
 */
function escapeCell(value) {
    if (value === null || value === undefined) return ''
    let str = String(value)
    // Neutralise formula triggers on text cells. We skip pure numeric
    // strings (e.g. "-12", "-12.3") so negative numbers still open as
    // numbers — but "=1+1", "+cmd|...", "@import" and tab/CR-prefixed
    // strings all get the apostrophe prefix.
    if (FORMULA_TRIGGER.test(str) && !/^-?\d+(\.\d+)?$/.test(str)) {
        str = "'" + str
    }
    // Wrap in quotes if it contains any special character; escape internal quotes.
    if (/[",\r\n]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"'
    }
    return str
}

/**
 * Build a CSV string from rows.
 *
 * @param {string[]} headers  Column titles
 * @param {Array<object>} rows  Source objects
 * @param {(row: object) => Array<any>} extractor  Map a row object to ordered cells
 * @returns {string}  Complete CSV with BOM
 */
function buildCSV(headers, rows, extractor) {
    const lines = []
    lines.push(headers.map(escapeCell).join(','))
    rows.forEach((row, index) => {
        // Pass the row index as the second arg so extractors that want a
        // row-number column (e.g. "#") don't need to keep their own counter.
        const cells = extractor(row, index)
        lines.push(cells.map(escapeCell).join(','))
    })
    // CRLF line endings — most Excel-friendly across platforms.
    return BOM + lines.join('\r\n') + '\r\n'
}

module.exports = { buildCSV, escapeCell }
