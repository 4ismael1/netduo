/**
 * HTML layout builder for PDF reports.
 *
 * Produces the enveloping <!doctype html>…</html> shell that every
 * report shares: inline CSS, a cover page and a content section.
 * Each report module supplies the cover metadata and the body HTML.
 *
 * Exports:
 *   - buildReportHTML({ kicker, title, subtitle, meta, bodyHTML })
 *     Returns a complete HTML document as a string.
 *
 *   - NETDUO_LOGO_SVG — inline SVG of the NetDuo mark, embeddable in
 *     any template. Matches the app icon (white line graph on blue
 *     gradient tile) but drawn in pure SVG so it scales for print
 *     without shipping a bitmap.
 */

const { BASE_CSS } = require('./base-css')

/** Escape a string for safe inclusion in HTML text / attributes. */
function esc(value) {
    if (value === null || value === undefined) return ''
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

/** The NetDuo mark, inline so we never depend on a file. */
const NETDUO_LOGO_SVG = `
<svg viewBox="0 0 48 48" aria-hidden="true">
  <polyline points="8,34 18,22 26,28 40,14" />
  <circle cx="8" cy="34" r="2.8" fill="#fff" stroke="none"/>
  <circle cx="40" cy="14" r="2.8" fill="#fff" stroke="none"/>
</svg>
`.trim()

/**
 * Build the complete HTML for a PDF report.
 *
 * @param {object} opts
 * @param {string} opts.kicker   Small label above title (e.g. "LAN SCAN REPORT")
 * @param {string} opts.title    Main cover title
 * @param {string} [opts.subtitle]  Optional subtitle under the title
 * @param {Array<[string,string]>} [opts.meta]  Key/value pairs for cover metadata list
 * @param {string} opts.bodyHTML  Pre-built content HTML (after the cover page)
 * @returns {string}
 */
function buildReportHTML({ kicker, title, subtitle, meta = [], bodyHTML }) {
    const metaItems = meta
        .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
        .join('')

    const year = new Date().getFullYear()

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <style>${BASE_CSS}</style>
</head>
<body>
  <section class="cover">
    <div>
      <div class="cover-top">
        <div class="cover-logo">${NETDUO_LOGO_SVG}</div>
        <div>
          <div class="cover-brand">NetDuo</div>
          <div class="cover-tag">Professional Network Diagnostics Suite</div>
        </div>
      </div>

      <div class="cover-body">
        <span class="cover-kicker">${esc(kicker || 'INFORME')}</span>
        <h1 class="cover-title">${esc(title)}</h1>
        ${subtitle ? `<p class="cover-subtitle">${esc(subtitle)}</p>` : ''}

        ${metaItems ? `<dl class="cover-meta">${metaItems}</dl>` : ''}
      </div>
    </div>

    <div class="cover-footer">
      © ${year} Ismael Paulino · NetDuo · github.com/4ismael1/netduo
    </div>
  </section>

  <section class="page-header">
    <div class="page-header-left">
      <span class="page-header-mark"></span>
      <span>NetDuo · ${esc(title)}</span>
    </div>
    <div class="muted">${esc(new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }))}</div>
  </section>

  ${bodyHTML}
</body>
</html>`
}

module.exports = { buildReportHTML, esc, NETDUO_LOGO_SVG }
