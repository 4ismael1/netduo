/**
 * LAN Scanner report template.
 *
 * Payload shape (sent from the renderer):
 *   {
 *     baseIP: "192.168.1",
 *     range: { start: 1, end: 254 },
 *     scannedAt: ISO string,
 *     hostname: OS hostname of the machine running the scan,
 *     devices: [
 *       {
 *         ip, mac, hostname, vendor, deviceType,
 *         alive, time, seenOnly, isGateway, isLocal, isRandomized,
 *         macEmpty, neighborState, nameSource, vendorSource,
 *       }
 *     ]
 *   }
 *
 * Provides:
 *   html(payload)  → full HTML for PDF rendering
 *   csv(payload)   → { headers, rows, extract } for CSV builder
 *   filenameDetail(payload) → string to include in default filename
 */

const { buildReportHTML, esc, registerReport } = require('../index')

function fmtDate(iso) {
    if (!iso) return ''
    try {
        return new Date(iso).toLocaleString('es-ES', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        })
    } catch {
        return iso
    }
}

function countByType(devices) {
    const map = new Map()
    for (const d of devices) {
        const t = d.deviceType || 'Unknown'
        map.set(t, (map.get(t) || 0) + 1)
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
}

/**
 * Render the per-row Status badge.
 *
 * The renderer ships the merged inventory shape (see mergeScanWithInventory
 * in src/lib/deviceInventory.js) so each row carries an explicit
 * `presence` field: 'online' | 'cached' | 'offline' | 'new'. When that field is
 * present we honour it first — it captures the persisted Offline /
 * freshly-discovered New state that raw scan flags can't express. Older
 * payloads (or seenOnly rows produced by partial scans without the
 * inventory merge) fall back to the legacy alive/seenOnly heuristic.
 */
function deviceBadge(d) {
    if (d.presence === 'new')     return '<span class="badge info">New</span>'
    if (d.presence === 'cached')  return '<span class="badge warn">Cached</span>'
    if (d.presence === 'offline') return '<span class="badge muted">Offline</span>'
    if (d.presence === 'online')  return '<span class="badge ok">Online</span>'
    if (d.isGateway) return '<span class="badge info">Gateway</span>'
    if (d.isLocal) return '<span class="badge ok">This device</span>'
    if (d.seenOnly) return '<span class="badge muted">Seen only</span>'
    if (d.alive) return '<span class="badge ok">Online</span>'
    return '<span class="badge muted">—</span>'
}

function buildHTML(payload) {
    const devices = Array.isArray(payload?.devices) ? payload.devices : []
    const baseIP = payload?.baseIP || '—'
    const range = payload?.range || { start: 1, end: 254 }
    const scannedAt = payload?.scannedAt || new Date().toISOString()
    const hostname = payload?.hostname || '—'

    const totalResponsive = devices.filter(d => d.alive).length
    const types = countByType(devices)
    const uniqueTypes = types.length

    // ── Summary cards ─────────────────────────────────────────────
    const summaryHTML = `
      <div class="summary-grid">
        <div class="summary-card">
          <div class="label">Total devices</div>
          <div class="value accent">${devices.length}</div>
        </div>
        <div class="summary-card">
          <div class="label">Online</div>
          <div class="value success">${totalResponsive}</div>
        </div>
        <div class="summary-card">
          <div class="label">Device types</div>
          <div class="value">${uniqueTypes}</div>
        </div>
        <div class="summary-card">
          <div class="label">IP range</div>
          <div class="value" style="font-size:11pt;">${esc(baseIP)}.${range.start}–${range.end}</div>
        </div>
      </div>
    `

    // ── Type breakdown ────────────────────────────────────────────
    const typesHTML = types.length ? `
      <div class="section">
        <div class="section-title">Device breakdown by type</div>
        <table class="data">
          <thead>
            <tr><th>Type</th><th style="width:90px; text-align:right;">Count</th></tr>
          </thead>
          <tbody>
            ${types.map(([t, n]) => `<tr><td>${esc(t)}</td><td class="num">${n}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    ` : ''

    // ── Full device table ─────────────────────────────────────────
    const rowsHTML = devices.map((d, i) => `
      <tr>
        <td class="num muted">${i + 1}</td>
        <td class="mono nowrap">${esc(d.ip || '')}</td>
        <td class="mono nowrap">${esc(d.mac || '—')}</td>
        <td>${esc(d.hostname || d.displayName || '—')}</td>
        <td>${esc(d.vendor || '—')}</td>
        <td>${esc(d.deviceType || 'Unknown')}</td>
        <td class="num">${d.time != null ? d.time + ' ms' : '—'}</td>
        <td>${deviceBadge(d)}</td>
      </tr>
    `).join('')

    const tableHTML = `
      <div class="section">
        <div class="section-title">Discovered devices (${devices.length})</div>
        <table class="data">
          <thead>
            <tr>
              <th style="width:34px;">#</th>
              <th>IP</th>
              <th>MAC</th>
              <th>Hostname</th>
              <th>Vendor</th>
              <th>Type</th>
              <th style="width:68px;">Latency</th>
              <th style="width:90px;">Status</th>
            </tr>
          </thead>
          <tbody>${rowsHTML || '<tr><td colspan="8" class="muted" style="text-align:center;padding:12px;">No devices discovered.</td></tr>'}</tbody>
        </table>
      </div>
    `

    const bodyHTML = summaryHTML + typesHTML + tableHTML

    return buildReportHTML({
        kicker: 'LAN SCAN REPORT',
        title: `Inventario de red ${baseIP}.0/24`,
        subtitle: `Escaneo de dispositivos activos en la subred local, ejecutado desde ${hostname}.`,
        meta: [
            ['Subred', `${baseIP}.${range.start}–${range.end}`],
            ['Dispositivos', `${devices.length} (${totalResponsive} responsivos)`],
            ['Ejecutado', fmtDate(scannedAt)],
            ['Estación', hostname],
            ['Generado por', 'NetDuo · LAN Scanner'],
        ],
        bodyHTML,
    })
}

/**
 * CSV uses the same status taxonomy as the PDF: prefer the merged
 * `presence` field when present so spreadsheets and PDFs always agree
 * on whether a device is Online / Cached / Offline / New for a given scan.
 */
function csvStatus(d) {
    if (d.presence === 'new') return 'new'
    if (d.presence === 'cached') return 'cached'
    if (d.presence === 'offline') return 'offline'
    if (d.presence === 'online') return 'online'
    if (d.alive) return 'online'
    if (d.seenOnly) return 'seen-only'
    return 'offline'
}

function buildCSVData(payload) {
    const devices = Array.isArray(payload?.devices) ? payload.devices : []
    return {
        headers: [
            '#', 'IP', 'MAC', 'Hostname', 'Nickname', 'Vendor', 'Device type',
            'Status', 'New', 'Latency (ms)', 'Gateway', 'Local', 'Randomized MAC',
            'Neighbor state', 'Notes', 'Name source', 'Vendor source',
        ],
        rows: devices,
        extract: (d, i) => [
            i + 1,
            d.ip || '',
            d.mac || '',
            d.hostname || d.displayName || '',
            d.nickname || '',
            d.vendor || '',
            d.typeOverride || d.deviceType || 'Unknown',
            csvStatus(d),
            (d.isNew || d.presence === 'new') ? 'yes' : '',
            d.time != null ? d.time : '',
            d.isGateway ? 'yes' : '',
            d.isLocal ? 'yes' : '',
            d.isRandomized ? 'yes' : '',
            d.neighborState || '',
            d.notes || '',
            d.nameSource || '',
            d.vendorSource || '',
        ],
    }
}

// Register the "lan-scan" kind with the central dispatcher. The csv
// extractor receives (row, index) from buildCSV so the leading "#" column
// gets the correct row number without a hand-rolled counter.
registerReport('lan-scan', {
    html: buildHTML,
    csv: buildCSVData,
    filenameDetail: (payload) => (payload?.baseIP || 'lan').replace(/\./g, '-'),
})

module.exports = { buildHTML, buildCSVData }
