/**
 * Base CSS for all NetDuo PDF reports.
 *
 * Exported as a plain string so each template can embed it inline in the
 * generated HTML (no file I/O, no external stylesheets, survives being
 * loaded from a data: URL in the hidden BrowserWindow).
 *
 * The palette mirrors the NetDuo brand. Reports always render in a light
 * theme regardless of the app's active theme — they're meant to be printed
 * or shared as PDFs, so legibility on paper wins.
 */

const BASE_CSS = `
  @page {
    size: Letter;
    margin: 18mm 14mm 20mm 14mm;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    font-family: "Segoe UI", system-ui, -apple-system, Arial, sans-serif;
    font-size: 10.5pt;
    color: #0F172A;
    line-height: 1.45;
    background: #ffffff;
    -webkit-font-smoothing: antialiased;
  }

  h1, h2, h3 { margin: 0; color: #0F172A; font-weight: 700; letter-spacing: -0.01em; }
  h1 { font-size: 22pt; }
  h2 { font-size: 14pt; color: #1E3A8A; margin-top: 18px; margin-bottom: 8px; }
  h3 { font-size: 11pt; margin-top: 10px; margin-bottom: 4px; }

  p { margin: 0 0 6px 0; }
  small, .muted { color: #64748B; }

  /* ────── Cover ────── */
  .cover {
    page-break-after: always;
    padding: 30mm 12mm 10mm 12mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 230mm;
  }
  .cover-top { display: flex; align-items: center; gap: 18px; }
  .cover-logo {
    width: 64px; height: 64px;
    border-radius: 14px;
    background: linear-gradient(135deg, #93C5FD 0%, #3B82F6 100%);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 6px 18px rgba(59,130,246,0.25);
  }
  .cover-logo svg { width: 40px; height: 40px; stroke: #fff; fill: none; stroke-width: 3.6; stroke-linecap: round; stroke-linejoin: round; }
  .cover-brand { font-size: 22pt; font-weight: 700; color: #0F172A; letter-spacing: -0.02em; }
  .cover-tag { font-size: 10pt; color: #64748B; margin-top: 2px; }

  .cover-body { margin-top: 22mm; }
  .cover-kicker {
    display: inline-block;
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #3B82F6;
    border: 1px solid #BFDBFE;
    background: #EFF6FF;
    padding: 4px 10px;
    border-radius: 999px;
    margin-bottom: 10mm;
  }
  .cover-title { font-size: 26pt; font-weight: 700; line-height: 1.15; color: #0F172A; margin-bottom: 6mm; }
  .cover-subtitle { font-size: 12pt; color: #475569; max-width: 160mm; }

  .cover-meta {
    margin-top: 18mm;
    display: grid;
    grid-template-columns: max-content 1fr;
    row-gap: 6px;
    column-gap: 14px;
    font-size: 10pt;
  }
  .cover-meta dt { color: #64748B; font-weight: 600; }
  .cover-meta dd { margin: 0; color: #0F172A; }

  .cover-footer { font-size: 8.5pt; color: #94A3B8; border-top: 1px solid #E2E8F0; padding-top: 6mm; margin-top: auto; }

  /* ────── Page content ────── */
  .page-header {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 6px; margin-bottom: 10px;
    border-bottom: 1px solid #E2E8F0;
  }
  .page-header-left { display: flex; align-items: center; gap: 8px; font-size: 9pt; color: #64748B; font-weight: 600; }
  .page-header-mark { width: 14px; height: 14px; border-radius: 4px; background: linear-gradient(135deg, #93C5FD 0%, #3B82F6 100%); }

  /* ────── Summary cards ────── */
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin: 6px 0 14px 0;
  }
  .summary-card {
    border: 1px solid #E2E8F0;
    border-radius: 8px;
    padding: 10px 12px;
    background: #F8FAFC;
  }
  .summary-card .label { font-size: 8pt; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: 0.06em; }
  .summary-card .value { font-size: 18pt; font-weight: 700; color: #0F172A; margin-top: 2px; }
  .summary-card .value.accent { color: #3B82F6; }
  .summary-card .value.success { color: #059669; }
  .summary-card .value.warn { color: #D97706; }
  .summary-card .value.danger { color: #DC2626; }

  /* ────── Tables ────── */
  table.data {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
    margin: 6px 0 14px 0;
  }
  table.data th, table.data td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid #E2E8F0;
    vertical-align: top;
  }
  table.data th {
    background: #F1F5F9;
    color: #0F172A;
    font-weight: 600;
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  table.data tr:nth-child(even) td { background: #F8FAFC; }
  table.data td.mono, table.data th.mono { font-family: "Consolas", "SF Mono", Menlo, monospace; font-size: 9pt; }
  table.data td.num { text-align: right; font-variant-numeric: tabular-nums; }

  /* ────── Badges ────── */
  .badge {
    display: inline-block;
    font-size: 8pt; font-weight: 600;
    padding: 2px 7px; border-radius: 999px;
    border: 1px solid transparent;
    line-height: 1.3;
  }
  .badge.info    { background: #EFF6FF; color: #1E3A8A; border-color: #BFDBFE; }
  .badge.ok      { background: #ECFDF5; color: #065F46; border-color: #A7F3D0; }
  .badge.warn    { background: #FFFBEB; color: #92400E; border-color: #FDE68A; }
  .badge.danger  { background: #FEF2F2; color: #991B1B; border-color: #FECACA; }
  .badge.muted   { background: #F1F5F9; color: #475569; border-color: #CBD5E1; }
  .badge.critical{ background: #FEE2E2; color: #7F1D1D; border-color: #FCA5A5; font-weight: 700; }

  /* ────── Sections ────── */
  .section {
    break-inside: avoid-page;
    margin-bottom: 12px;
  }
  .section-title {
    font-size: 11pt; font-weight: 700; color: #1E3A8A;
    padding-bottom: 4px; border-bottom: 2px solid #DBEAFE;
    margin-bottom: 8px;
  }

  .callout {
    border-left: 3px solid #3B82F6;
    background: #EFF6FF;
    padding: 8px 12px;
    border-radius: 0 6px 6px 0;
    font-size: 9.5pt;
    color: #1E3A8A;
    margin: 8px 0;
  }

  .mono { font-family: "Consolas", "SF Mono", Menlo, monospace; }
  .nowrap { white-space: nowrap; }
`

module.exports = { BASE_CSS }
