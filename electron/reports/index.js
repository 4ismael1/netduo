/**
 * Entry point for the report export subsystem.
 *
 * Re-exports the low-level helpers and wires up a convenience
 * `exportReport(kind, format, payload)` dispatcher used by the
 * IPC handlers in main.js.
 *
 * Each supported (kind × format) pair maps to a renderer function
 * that:
 *   - builds the content HTML / CSV from the payload
 *   - calls renderHTMLToPDF or buildCSV as needed
 *   - prompts the user via saveReport()
 *
 * The dispatcher returns the uniform { ok, path? | cancelled? | error? }
 * shape so the renderer can show consistent toasts.
 */

const { renderHTMLToPDF } = require('./pdf')
const { buildCSV } = require('./csv')
const { saveReport, defaultFilename, revealInFolder } = require('./save')
const { buildReportHTML, esc } = require('./templates/layout')

// Individual report builders are registered lazily to keep this file
// lean. Each module under ./templates/<kind>-report.js must export:
//   { buildHTML(payload): string }    (for PDF)
//   { buildCSVData(payload): { headers, rows, extract } }  (for CSV)
const REGISTRY = {}

/**
 * Register a report kind with its builders.
 *
 * @param {string} kind
 * @param {object} handlers
 * @param {(payload:any)=>string} [handlers.html]
 * @param {(payload:any)=>{headers:string[], rows:any[], extract:(row:any)=>any[]}} [handlers.csv]
 * @param {(payload:any)=>string} [handlers.filenameDetail]  Optional tag fragment
 */
function registerReport(kind, handlers) {
    REGISTRY[kind] = handlers
}

/**
 * Dispatcher invoked by the IPC handler.
 *
 * @param {string} kind    e.g. "lan-scan", "lan-check", "speed-history"
 * @param {"pdf"|"csv"} format
 * @param {object} payload Report-specific data
 * @returns {Promise<{ok:boolean, path?:string, cancelled?:boolean, error?:string}>}
 */
async function exportReport(kind, format, payload) {
    const handler = REGISTRY[kind]
    if (!handler) {
        return { ok: false, error: `Unknown report kind: ${kind}` }
    }

    try {
        const detail = typeof handler.filenameDetail === 'function'
            ? handler.filenameDetail(payload)
            : undefined

        if (format === 'pdf') {
            if (typeof handler.html !== 'function') {
                return { ok: false, error: `Report "${kind}" does not support PDF` }
            }
            const html = handler.html(payload)
            const data = await renderHTMLToPDF(html)
            const suggestedName = defaultFilename(kind, detail, 'pdf')
            return saveReport({ suggestedName, ext: 'pdf', data })
        }

        if (format === 'csv') {
            if (typeof handler.csv !== 'function') {
                return { ok: false, error: `Report "${kind}" does not support CSV` }
            }
            const { headers, rows, extract } = handler.csv(payload)
            const csvString = buildCSV(headers, rows, extract)
            const suggestedName = defaultFilename(kind, detail, 'csv')
            return saveReport({ suggestedName, ext: 'csv', data: csvString })
        }

        return { ok: false, error: `Unknown format: ${format}` }
    } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) }
    }
}

module.exports = {
    exportReport,
    registerReport,
    revealInFolder,
    // Re-exports for individual template modules:
    buildReportHTML,
    esc,
}

// ── Register built-in report kinds ─────────────────────────────────
// Each template calls registerReport() from its module-level code.
// Requiring them here is enough to wire them into the dispatcher.
require('./templates/lan-scan')
require('./templates/lan-check')
require('./templates/wan-probe')
require('./templates/speed-history')
require('./templates/monitor-log')
require('./templates/traceroute')
require('./templates/dns-lookup')
