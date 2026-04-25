/**
 * Traceroute report (PDF).
 *
 * Payload shape:
 *   {
 *     host: 'google.com',
 *     generatedAt: ISO,
 *     hops: [
 *       { hop: 1, ip: '192.168.1.1', times: [1, 1, 1], avg: '1.0' },
 *       { hop: 2, ip: '10.0.0.1',   times: [8, 9, 8], avg: '8.3' },
 *       ...
 *     ]
 *   }
 */

const { buildReportHTML, esc, registerReport } = require('../index')

function latencyTone(avg) {
    const v = parseFloat(avg)
    if (!Number.isFinite(v)) return 'muted'
    if (v < 40) return 'ok'
    if (v < 150) return 'warn'
    return 'danger'
}

function fmtDate(iso) {
    if (!iso) return ''
    try {
        return new Date(iso).toLocaleString('es-ES', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        })
    } catch { return iso }
}

function buildHTML(payload) {
    const host = payload?.host || '—'
    const hops = Array.isArray(payload?.hops) ? payload.hops : []
    const generatedAt = payload?.generatedAt || new Date().toISOString()

    const validAvgs = hops.map(h => parseFloat(h.avg)).filter(Number.isFinite)
    const peakLatency = validAvgs.length ? Math.max(...validAvgs).toFixed(1) : '—'

    const summaryHTML = `
      <div class="summary-grid">
        <div class="summary-card">
          <div class="label">Destination</div>
          <div class="value accent" style="font-size:13pt;word-break:break-all;">${esc(host)}</div>
        </div>
        <div class="summary-card">
          <div class="label">Hops traversed</div>
          <div class="value">${hops.length}</div>
        </div>
        <div class="summary-card">
          <div class="label">Peak latency</div>
          <div class="value ${latencyTone(peakLatency)}">${peakLatency}<span style="font-size:10pt;color:#94A3B8;"> ms</span></div>
        </div>
        <div class="summary-card">
          <div class="label">Status</div>
          <div class="value ${hops.length && hops[hops.length - 1].ip !== '*' ? 'success' : 'warn'}" style="font-size:13pt;">
            ${hops.length && hops[hops.length - 1].ip !== '*' ? 'Reached' : 'Incomplete'}
          </div>
        </div>
      </div>
    `

    const rowsHTML = hops.map(h => {
        const ip = h.ip === '*' ? '<span class="muted">* no response *</span>' : esc(h.ip || '—')
        const times = Array.isArray(h.times) && h.times.length
            ? h.times.map(t => `<span style="margin-right:8px;">${t}</span>`).join('')
            : '<span class="muted">timeout</span>'
        const avg = h.avg
            ? `<span class="badge ${latencyTone(h.avg)}">${h.avg} ms</span>`
            : '<span class="muted">—</span>'
        return `
          <tr>
            <td class="num mono">${h.hop}</td>
            <td class="mono">${ip}</td>
            <td class="mono muted">${times}</td>
            <td>${avg}</td>
          </tr>
        `
    }).join('')

    const tableHTML = `
      <div class="section">
        <div class="section-title">Hop-by-hop path</div>
        <table class="data">
          <thead>
            <tr>
              <th style="width:50px;">#</th>
              <th style="width:160px;">IP address</th>
              <th>Round-trip times (ms)</th>
              <th style="width:110px;">Average</th>
            </tr>
          </thead>
          <tbody>${rowsHTML || '<tr><td colspan="4" class="muted" style="text-align:center;">No hops recorded.</td></tr>'}</tbody>
        </table>
      </div>
    `

    return buildReportHTML({
        kicker: 'TRACEROUTE REPORT',
        title: `Ruta hacia ${host}`,
        subtitle: `Mapa de la trayectoria de paquetes entre este equipo y el destino, hop por hop.`,
        meta: [
            ['Destino', host],
            ['Hops', String(hops.length)],
            ['Pico de latencia', `${peakLatency} ms`],
            ['Ejecutado', fmtDate(generatedAt)],
            ['Generado por', 'NetDuo · Traceroute'],
        ],
        bodyHTML: summaryHTML + tableHTML,
    })
}

registerReport('traceroute', {
    html: buildHTML,
    filenameDetail: (payload) => (payload?.host || 'trace')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40),
})

module.exports = { buildHTML }
