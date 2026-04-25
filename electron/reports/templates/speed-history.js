/**
 * Speed Test history export (CSV only).
 *
 * Payload shape:
 *   {
 *     entries: [
 *       {
 *         id, timestamp, date, ts,
 *         download (Mbps), upload (Mbps),
 *         latency (ms), jitter (ms),
 *         server (name or id)
 *       }
 *     ]
 *   }
 *
 * Produces a single-sheet CSV ready for Excel / Google Sheets to chart.
 */

const { registerReport } = require('../index')

function pickTimestamp(row) {
    if (!row) return ''
    if (row.timestamp) return row.timestamp
    if (row.date && row.ts) return `${row.date} ${row.ts}`
    return row.ts || ''
}

function buildCSVData(payload) {
    const entries = Array.isArray(payload?.entries) ? payload.entries : []
    return {
        headers: [
            'Timestamp (ISO)', 'Date (local)', 'Download (Mbps)', 'Upload (Mbps)',
            'Latency (ms)', 'Jitter (ms)', 'Server',
        ],
        rows: entries,
        extract: (row) => {
            const iso = pickTimestamp(row)
            let local = ''
            try {
                local = iso ? new Date(iso).toLocaleString() : ''
            } catch { local = String(iso) }
            return [
                iso,
                local,
                Number.isFinite(row.download) ? row.download : '',
                Number.isFinite(row.upload) ? row.upload : '',
                Number.isFinite(row.latency) ? row.latency : '',
                Number.isFinite(row.jitter) ? row.jitter : '',
                row.server || '',
            ]
        },
    }
}

registerReport('speed-history', {
    csv: buildCSVData,
})

module.exports = { buildCSVData }
