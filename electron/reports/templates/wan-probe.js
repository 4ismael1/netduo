/**
 * WAN Probe (external exposure audit) report template.
 *
 * Payload shape produced by src/pages/WanProbe/WanProbe.jsx when
 * exporting or persisting a scan:
 *   {
 *     target: '8.8.8.8' | 'mydomain.example',
 *     generatedAt: ISO string,
 *     summary: {
 *       probes, findingsCount, riskScore, avgConfidence,
 *       open, closed, filtered,
 *     },
 *     probes: [                       // one per probe endpoint
 *       {
 *         probeId, label, url, region, country,
 *         riskScore, confidenceScore,
 *         open, closed, filtered,
 *         results: [{ port, protocol, state, service, banner }, ...],
 *         findings: [{ severity, title, evidence, recommendation, category }, ...]
 *       }
 *     ],
 *     findings: [...]                 // deduplicated aggregate findings
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

/**
 * Banner / detail data from the probe service can arrive as:
 *   - a plain string ("OpenSSH 8.4p1"),
 *   - an object with structured fields (TLS / HTTP / SSH probes),
 *   - null when the probe didn't capture anything.
 *
 * Stringifying an object via template literals yields "[object Object]"
 * which is what the user reported. This helper produces a compact,
 * human-readable single-line summary suitable for both PDF cells and
 * CSV columns. It picks the most informative fields first; when no
 * known field is present it falls back to a compact JSON.
 */
const BANNER_PRIORITY_KEYS = [
    'banner', 'server', 'software', 'product', 'version', 'title',
    'subject', 'issuer', 'tlsVersion', 'cipher', 'sni', 'http', 'tls',
]

function formatBannerCell(value) {
    if (value == null) return '—'
    if (typeof value === 'string') return value.trim() || '—'
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) {
        return value.map(formatBannerCell).filter(Boolean).join(' · ') || '—'
    }
    if (typeof value !== 'object') return String(value)

    // Pull human-friendly fields when the probe returned a structured banner.
    const parts = []
    for (const key of BANNER_PRIORITY_KEYS) {
        if (value[key] == null) continue
        const sub = formatBannerCell(value[key])
        if (sub && sub !== '—') {
            parts.push(key === 'banner' ? sub : `${key}: ${sub}`)
        }
    }
    if (parts.length) return parts.join(' · ')

    // Last resort: compact JSON (single line, trimmed) so the cell at
    // least carries the raw observation rather than "[object Object]".
    try {
        return JSON.stringify(value).slice(0, 240)
    } catch {
        return '—'
    }
}

function buildHTML(payload) {
    const summary = payload?.summary || {}
    const probes = Array.isArray(payload?.probes) ? payload.probes : []
    const findings = sortedFindings(payload?.findings || [])
    const target = payload?.target || '—'
    const score = Number.isFinite(summary.riskScore) ? summary.riskScore : 0

    // Executive summary
    const summaryHTML = `
      <div class="summary-grid">
        <div class="summary-card">
          <div class="label">Risk score</div>
          <div class="value ${riskTone(score)}">${score}<span style="font-size:10pt;color:#94A3B8;font-weight:500;"> / 100</span></div>
        </div>
        <div class="summary-card">
          <div class="label">Probes</div>
          <div class="value">${summary.probes ?? probes.length}</div>
        </div>
        <div class="summary-card">
          <div class="label">Open ports</div>
          <div class="value warn">${summary.open ?? 0}</div>
        </div>
        <div class="summary-card">
          <div class="label">Findings</div>
          <div class="value ${findings.length ? 'warn' : 'success'}">${findings.length}</div>
        </div>
      </div>
    `

    // Findings section
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
    ` : `<div class="callout">No security findings flagged across probes.</div>`

    // Per-probe port breakdown
    const probesHTML = probes.length ? `
      <div class="section">
        <div class="section-title">Probe results (${probes.length})</div>
        ${probes.map(probe => {
        const probeScore = Number.isFinite(probe.riskScore) ? probe.riskScore : 0
        const results = Array.isArray(probe.results) ? probe.results : []
        const openOnly = results.filter(r => r.state === 'open')
        return `
            <div class="subsection">
              <div class="subsection-header">
                <strong>${esc(probe.label || probe.url || probe.probeId || '—')}</strong>
                ${probe.region ? `<span class="muted" style="font-size:9pt;"> — ${esc(probe.region)}${probe.country ? ', ' + esc(probe.country) : ''}</span>` : ''}
                <span class="badge ${riskTone(probeScore)}" style="margin-left:8px;">Risk ${probeScore}/100</span>
              </div>
              <div class="muted" style="font-size:9pt;margin:2px 0 8px 0;">
                Open: ${probe.open ?? 0} · Closed: ${probe.closed ?? 0} · Filtered: ${probe.filtered ?? 0}
              </div>
              ${openOnly.length ? `
                <table class="data">
                  <thead>
                    <tr>
                      <th style="width:60px;">Port</th>
                      <th style="width:60px;">Proto</th>
                      <th>Service</th>
                      <th>Banner / Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${openOnly.map(r => `
                      <tr>
                        <td class="num mono">${esc(r.port)}</td>
                        <td class="mono">${esc(String(r.protocol || 'tcp').toUpperCase())}</td>
                        <td>${esc(r.service || '—')}</td>
                        <td class="muted" style="font-size:8.5pt;">${esc(formatBannerCell(r.banner ?? r.detail))}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              ` : `<div class="muted" style="font-size:9pt;">No open ports observed from this probe.</div>`}
            </div>
          `
    }).join('')}
      </div>
    ` : ''

    const bodyHTML = summaryHTML + findingsHTML + probesHTML

    return buildReportHTML({
        kicker: 'WAN EXPOSURE AUDIT',
        title: `External exposure report`,
        subtitle: `Multi-probe scan against <strong>${esc(target)}</strong>.`,
        meta: [
            ['Target', target],
            ['Risk score', `${score}/100`],
            ['Probes', String(summary.probes ?? probes.length)],
            ['Open ports', String(summary.open ?? 0)],
            ['Closed', String(summary.closed ?? 0)],
            ['Filtered', String(summary.filtered ?? 0)],
            ['Ejecutado', fmtDate(payload?.generatedAt)],
            ['Generado por', 'NetDuo · WAN Probe'],
        ],
        bodyHTML,
    })
}

/**
 * CSV dumps one row per observed (probe, port) pair. Admins typically
 * want this format to triage externally reachable services across
 * multiple vantage points.
 */
function buildCSVData(payload) {
    const probes = Array.isArray(payload?.probes) ? payload.probes : []
    const rows = []
    for (const probe of probes) {
        const results = Array.isArray(probe.results) ? probe.results : []
        for (const r of results) {
            rows.push({
                probeLabel: probe.label || probe.url || probe.probeId || '',
                probeRegion: probe.region || '',
                probeCountry: probe.country || '',
                port: r.port,
                protocol: String(r.protocol || 'tcp').toUpperCase(),
                state: r.state || '',
                service: r.service || '',
                banner: formatBannerCell(r.banner ?? r.detail),
            })
        }
    }
    return {
        headers: [
            'Probe', 'Region', 'Country', 'Port', 'Protocol', 'State', 'Service', 'Banner',
        ],
        rows,
        extract: (r) => [
            r.probeLabel,
            r.probeRegion,
            r.probeCountry,
            r.port,
            r.protocol,
            r.state,
            r.service,
            r.banner,
        ],
    }
}

registerReport('wan-probe', {
    html: buildHTML,
    csv: (payload) => buildCSVData(payload),
    filenameDetail: (payload) => {
        const base = payload?.target ? String(payload.target) : 'wan'
        return base.replace(/[^a-z0-9.-]+/gi, '-').slice(0, 40)
    },
})

module.exports = { buildHTML, buildCSVData }
