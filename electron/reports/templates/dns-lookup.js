/**
 * DNS Resolution report (PDF).
 *
 * Payload shape:
 *   {
 *     host: 'google.com',
 *     generatedAt: ISO,
 *     results: {
 *       A:     { type, addresses, time, error? },
 *       AAAA:  { ... },
 *       MX:    { ... },
 *       TXT:   { ... },
 *       NS:    { ... },
 *       CNAME: { ... }
 *     }
 *   }
 */

const { buildReportHTML, esc, registerReport } = require('../index')

const TYPE_ORDER = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME']

function fmtDate(iso) {
    if (!iso) return ''
    try {
        return new Date(iso).toLocaleString('es-ES', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        })
    } catch { return iso }
}

function addressesToString(addrs) {
    if (!Array.isArray(addrs)) return ''
    return addrs.map(a => {
        if (a == null) return ''
        if (typeof a === 'object') {
            // MX records are { priority, exchange } objects.
            if ('exchange' in a) return `${a.priority ?? ''} ${a.exchange || ''}`.trim()
            return JSON.stringify(a)
        }
        return String(a)
    }).filter(Boolean)
}

function buildHTML(payload) {
    const host = payload?.host || '—'
    const results = payload?.results || {}
    const generatedAt = payload?.generatedAt || new Date().toISOString()

    const typeKeys = TYPE_ORDER.filter(t => results[t])
    const totalRecords = typeKeys.reduce((sum, t) => {
        const res = results[t]
        return sum + (Array.isArray(res?.addresses) ? res.addresses.length : 0)
    }, 0)
    const erroredTypes = typeKeys.filter(t => results[t]?.error).length

    const summaryHTML = `
      <div class="summary-grid">
        <div class="summary-card">
          <div class="label">Domain</div>
          <div class="value accent" style="font-size:13pt;word-break:break-all;">${esc(host)}</div>
        </div>
        <div class="summary-card">
          <div class="label">Types resolved</div>
          <div class="value">${typeKeys.length} / ${TYPE_ORDER.length}</div>
        </div>
        <div class="summary-card">
          <div class="label">Total records</div>
          <div class="value success">${totalRecords}</div>
        </div>
        <div class="summary-card">
          <div class="label">Failed lookups</div>
          <div class="value ${erroredTypes ? 'warn' : 'success'}">${erroredTypes}</div>
        </div>
      </div>
    `

    const sections = typeKeys.map(type => {
        const res = results[type] || {}
        const addrs = addressesToString(res.addresses)
        const timeStr = Number.isFinite(res.time) ? `${res.time} ms` : '—'
        const body = res.error
            ? `<div class="callout" style="border-color:#EF4444;background:#FEF2F2;color:#991B1B;">${esc(res.error)}</div>`
            : addrs.length
                ? `<ul class="mono" style="margin:0;padding-left:18px;font-size:9.5pt;">${addrs.map(a => `<li>${esc(a)}</li>`).join('')}</ul>`
                : `<div class="muted" style="font-size:9.5pt;">No records found.</div>`

        return `
          <div class="section">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span class="badge info" style="font-size:9pt;font-weight:700;">${type}</span>
              <span class="muted" style="font-size:9pt;">Resolved in ${timeStr}</span>
            </div>
            ${body}
          </div>
        `
    }).join('')

    return buildReportHTML({
        kicker: 'DNS RESOLUTION REPORT',
        title: `Registros DNS de ${host}`,
        subtitle: `Consulta en paralelo de los tipos de registro más comunes para este dominio.`,
        meta: [
            ['Dominio', host],
            ['Tipos consultados', TYPE_ORDER.join(', ')],
            ['Registros totales', String(totalRecords)],
            ['Fallos', String(erroredTypes)],
            ['Ejecutado', fmtDate(generatedAt)],
            ['Generado por', 'NetDuo · DNS Resolution'],
        ],
        bodyHTML: summaryHTML + sections,
    })
}

registerReport('dns-lookup', {
    html: buildHTML,
    filenameDetail: (payload) => (payload?.host || 'dns')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40),
})

module.exports = { buildHTML }
