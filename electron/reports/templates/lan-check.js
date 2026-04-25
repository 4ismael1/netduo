/**
 * LAN Check (security audit) report template.
 *
 * Payload shape:
 *   {
 *     profile: 'quick' | 'standard' | 'deep',
 *     generatedAt: ISO string,
 *     range: "192.168.1.1-254",
 *     gateway: { ... } | null,
 *     devices: [...],          // discoveredHosts
 *     openPorts: [             // openPortRows
 *       {
 *         ip, displayName, isGateway, port, protocol, state,
 *         service, detail, severity, time
 *       }
 *     ],
 *     findings: [
 *       { id, severity, title, evidence, recommendation, category }
 *     ],
 *     summary: {
 *       riskScore, riskBand, devicesTotal, targetsScanned,
 *       confirmedOpenServices, inconclusiveServices, durationMs, ...
 *     }
 *   }
 */

const { buildReportHTML, esc, registerReport } = require('../index')

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info']
const SEVERITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' }
const SEVERITY_BADGE = {
    critical: 'critical',
    high: 'danger',
    medium: 'warn',
    low: 'info',
    info: 'muted',
}

function fmtDate(iso) {
    if (!iso) return ''
    try {
        return new Date(iso).toLocaleString('es-ES', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        })
    } catch { return iso }
}

function fmtDuration(ms) {
    if (!ms || !Number.isFinite(ms)) return '—'
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    return `${m}m ${s % 60}s`
}

function riskTone(score) {
    if (score >= 70) return 'danger'
    if (score >= 40) return 'warn'
    if (score >= 15) return 'info'
    return 'success'
}

function sortedFindings(findings) {
    return [...(findings || [])].sort((a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    )
}

function buildHTML(payload) {
    const summary = payload?.summary || {}
    const findings = sortedFindings(payload?.findings || [])
    const openPorts = Array.isArray(payload?.openPorts) ? payload.openPorts : []
    const devices = Array.isArray(payload?.devices) ? payload.devices : []

    const score = Number.isFinite(summary.riskScore) ? summary.riskScore : 0
    const riskLabel = summary?.riskBand?.label || '—'

    // ── Executive summary cards ──────────────────────────────
    const summaryHTML = `
      <div class="summary-grid">
        <div class="summary-card">
          <div class="label">Risk score</div>
          <div class="value ${riskTone(score)}">${score}<span style="font-size:10pt;color:#94A3B8;font-weight:500;"> / 100</span></div>
          <div class="muted" style="font-size:9pt;margin-top:2px;">${esc(riskLabel)}</div>
        </div>
        <div class="summary-card">
          <div class="label">Devices scanned</div>
          <div class="value">${summary.devicesTotal ?? devices.length}</div>
        </div>
        <div class="summary-card">
          <div class="label">Open services</div>
          <div class="value warn">${summary.confirmedOpenServices ?? openPorts.length}</div>
        </div>
        <div class="summary-card">
          <div class="label">Findings</div>
          <div class="value ${findings.length ? 'warn' : 'success'}">${findings.length}</div>
        </div>
      </div>
    `

    // ── Findings breakdown by severity ───────────────────────
    const counts = {}
    for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1
    const severityRow = SEVERITY_ORDER
        .filter(s => counts[s])
        .map(s => `<span class="badge ${SEVERITY_BADGE[s]}">${SEVERITY_LABEL[s]}: ${counts[s]}</span>`)
        .join(' ')

    const findingsHTML = findings.length ? `
      <div class="section">
        <div class="section-title">Security findings</div>
        ${severityRow ? `<p style="margin:4px 0 10px 0;">${severityRow}</p>` : ''}
        <table class="data">
          <thead>
            <tr>
              <th style="width:90px;">Severity</th>
              <th>Finding</th>
              <th style="width:130px;">Category</th>
            </tr>
          </thead>
          <tbody>
            ${findings.map(f => `
              <tr>
                <td><span class="badge ${SEVERITY_BADGE[f.severity] || 'muted'}">${esc(SEVERITY_LABEL[f.severity] || f.severity)}</span></td>
                <td>
                  <div style="font-weight:600;color:#0F172A;">${esc(f.title || '')}</div>
                  ${f.evidence ? `<div class="muted" style="font-size:9pt;margin-top:2px;">${esc(f.evidence)}</div>` : ''}
                  ${f.recommendation ? `<div style="font-size:9pt;margin-top:4px;"><strong style="color:#1E3A8A;">Recommendation:</strong> ${esc(f.recommendation)}</div>` : ''}
                </td>
                <td class="muted" style="font-size:9pt;">${esc(f.category || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : `<div class="callout">No security findings detected in this scan. Continue periodic audits to catch configuration drift.</div>`

    // ── Open services table ──────────────────────────────────
    const sortedPorts = [...openPorts].sort((a, b) => {
        const sa = SEVERITY_ORDER.indexOf(a.severity)
        const sb = SEVERITY_ORDER.indexOf(b.severity)
        if (sa !== sb) return sa - sb
        if (a.ip === b.ip) return a.port - b.port
        return String(a.ip).localeCompare(String(b.ip))
    })

    const openPortsHTML = sortedPorts.length ? `
      <div class="section">
        <div class="section-title">Open services (${sortedPorts.length})</div>
        <table class="data">
          <thead>
            <tr>
              <th style="width:110px;">Host</th>
              <th>Device</th>
              <th style="width:60px;">Port</th>
              <th style="width:60px;">Proto</th>
              <th>Service</th>
              <th style="width:80px;">Severity</th>
            </tr>
          </thead>
          <tbody>
            ${sortedPorts.map(p => `
              <tr>
                <td class="mono nowrap">${esc(p.ip || '')}</td>
                <td>${esc(p.displayName || '—')}${p.isGateway ? ' <span class="badge info">Gateway</span>' : ''}</td>
                <td class="num mono">${p.port}</td>
                <td class="mono">${esc((p.protocol || 'tcp').toUpperCase())}</td>
                <td>${esc(p.service || '—')}${p.detail ? `<div class="muted" style="font-size:8.5pt;">${esc(p.detail)}</div>` : ''}</td>
                <td><span class="badge ${SEVERITY_BADGE[p.severity] || 'muted'}">${esc(SEVERITY_LABEL[p.severity] || p.severity || '—')}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : ''

    // ── Devices in scope ─────────────────────────────────────
    const devicesHTML = devices.length ? `
      <div class="section">
        <div class="section-title">Devices in scope (${devices.length})</div>
        <table class="data">
          <thead>
            <tr>
              <th style="width:110px;">IP</th>
              <th>Device</th>
              <th>Vendor</th>
              <th style="width:120px;">Type</th>
            </tr>
          </thead>
          <tbody>
            ${devices.map(d => `
              <tr>
                <td class="mono nowrap">${esc(d.ip || '')}</td>
                <td>${esc(d.hostname || d.displayName || '—')}${d.isGateway ? ' <span class="badge info">Gateway</span>' : ''}</td>
                <td>${esc(d.vendor || '—')}</td>
                <td>${esc(d.deviceType || 'Unknown')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : ''

    const bodyHTML = summaryHTML + findingsHTML + openPortsHTML + devicesHTML

    return buildReportHTML({
        kicker: 'LAN SECURITY AUDIT',
        title: `Auditoría de red local`,
        subtitle: `Reporte ejecutivo del perfil ${(payload?.profile || '').toUpperCase()} sobre la subred ${esc(payload?.range || '')}.`,
        meta: [
            ['Rango', payload?.range || '—'],
            ['Perfil', (payload?.profile || '').toUpperCase()],
            ['Risk score', `${score}/100 (${riskLabel})`],
            ['Dispositivos', `${summary.devicesTotal ?? devices.length} en alcance`],
            ['Servicios abiertos', `${summary.confirmedOpenServices ?? openPorts.length}`],
            ['Ejecutado', fmtDate(payload?.generatedAt)],
            ['Duración', fmtDuration(summary.durationMs)],
            ['Generado por', 'NetDuo · LAN Check'],
        ],
        bodyHTML,
    })
}

function buildCSVData(payload) {
    // The CSV dumps one row per open service (what admins usually want for tickets).
    const openPorts = Array.isArray(payload?.openPorts) ? payload.openPorts : []
    return {
        headers: [
            'IP', 'Device', 'Gateway', 'Port', 'Protocol', 'Service',
            'Detail', 'State', 'Severity', 'Latency (ms)',
        ],
        rows: openPorts,
        extract: (p) => [
            p.ip || '',
            p.displayName || '',
            p.isGateway ? 'yes' : '',
            p.port,
            (p.protocol || 'tcp').toUpperCase(),
            p.service || '',
            p.detail || '',
            p.state || '',
            SEVERITY_LABEL[p.severity] || p.severity || '',
            p.time ?? '',
        ],
    }
}

registerReport('lan-check', {
    html: buildHTML,
    csv: (payload) => buildCSVData(payload),
    filenameDetail: (payload) => {
        const base = payload?.range ? String(payload.range).split('-')[0] : 'lan'
        return base.replace(/\./g, '-')
    },
})

module.exports = { buildHTML, buildCSVData }
