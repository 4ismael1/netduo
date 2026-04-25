/**
 * Monitor session log export (CSV only).
 *
 * Payload shape:
 *   {
 *     hosts: ['1.1.1.1', '8.8.8.8'],
 *     data: [
 *       { t: '14:30:02', '1.1.1.1': 23, '8.8.8.8': 19 },
 *       { t: '14:30:04', '1.1.1.1': null, '8.8.8.8': 21 }, // null = timeout
 *       ...
 *     ],
 *     stats: {
 *       '1.1.1.1': { min, max, total, count, loss, last }
 *     },
 *     threshold: number,
 *     sessionStartedAt: ISO string,
 *   }
 *
 * Output: long-format CSV with columns (Timestamp, Target, Latency, Loss).
 * Long format is the easiest to pivot in Excel / Google Sheets when a
 * session monitors several hosts.
 */

const { registerReport } = require('../index')

function buildCSVData(payload) {
    const data = Array.isArray(payload?.data) ? payload.data : []
    const hosts = Array.isArray(payload?.hosts) ? payload.hosts : []
    const started = payload?.sessionStartedAt || new Date().toISOString()

    // Flatten wide-format samples to long-format rows.
    const rows = []
    const dateStr = new Date(started).toISOString().slice(0, 10)
    for (const bucket of data) {
        const t = bucket.t || ''
        for (const h of hosts) {
            const latency = bucket[h]
            rows.push({
                timestamp: `${dateStr} ${t}`,
                target: h,
                latency,
                timeout: latency == null,
            })
        }
    }

    return {
        headers: ['Timestamp', 'Target', 'Latency (ms)', 'Status'],
        rows,
        extract: (row) => [
            row.timestamp,
            row.target,
            row.timeout ? '' : row.latency,
            row.timeout ? 'timeout' : 'ok',
        ],
    }
}

registerReport('monitor-log', {
    csv: buildCSVData,
    filenameDetail: (payload) => {
        const hosts = Array.isArray(payload?.hosts) ? payload.hosts : []
        return hosts.length === 1 ? hosts[0].replace(/[^a-z0-9]+/gi, '-') : 'session'
    },
})

module.exports = { buildCSVData }
