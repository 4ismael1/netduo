import { useEffect, useRef, useState } from 'react'
import { Download, FileText, FileSpreadsheet, Loader2, Check, ExternalLink, AlertCircle } from 'lucide-react'
import bridge from '../../lib/electronBridge'
import { logBridgeWarning } from '../../lib/devLog.js'
import './ExportMenu.css'

/**
 * Reusable Export button with dropdown (PDF / CSV).
 *
 * Props:
 *  - kind       (string)   Report kind registered in electron/reports/index.js
 *  - payload    (object)   Data sent to the export handler
 *  - formats    (string[]) Which formats to offer — default ['pdf','csv']
 *  - disabled   (boolean)  When true, the trigger is inert (e.g. no data yet)
 *  - label      (string)   Optional trigger label — default "Export"
 *  - className  (string)   Extra className for the trigger
 *  - size       ('sm'|'md') Compact vs regular button
 *  - variant    ('primary'|'secondary') Visual style of the trigger
 *
 * Behaviour:
 *   - Click opens a menu with the available formats.
 *   - Choosing a format calls bridge.reportExport(kind, format, payload).
 *   - While generating, the trigger shows a spinner and is disabled.
 *   - After save: shows a non-blocking status pill with "Open folder" link.
 *   - If the user cancels the save dialog, the menu simply closes silently.
 */
export default function ExportMenu({
    kind,
    payload,
    formats = ['pdf', 'csv'],
    disabled = false,
    label = 'Export',
    className = '',
    size = 'md',
    variant = 'secondary',
}) {
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null) // { tone:'ok'|'error', text, path? }
    const rootRef = useRef(null)
    const statusTimerRef = useRef(null)

    // Close on outside click and on Escape
    useEffect(() => {
        if (!open) return
        function onDocClick(e) {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
        }
        function onKey(e) { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDocClick)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDocClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    // Auto-clear status pill after a few seconds
    useEffect(() => {
        if (!status) return
        clearTimeout(statusTimerRef.current)
        statusTimerRef.current = setTimeout(() => setStatus(null), 6000)
        return () => clearTimeout(statusTimerRef.current)
    }, [status])

    async function runExport(format) {
        setOpen(false)
        if (busy) return
        setBusy(true)
        setStatus(null)
        try {
            // Resolve payload lazily (support pass-through of functions for heavy data)
            const data = typeof payload === 'function' ? await payload() : payload
            const result = await bridge.reportExport(kind, format, data)
            if (result?.ok) {
                setStatus({ tone: 'ok', text: 'Saved', path: result.path })
            } else if (result?.cancelled) {
                // Silent — user deliberately cancelled.
                setStatus(null)
            } else {
                setStatus({ tone: 'error', text: result?.error || 'Export failed' })
            }
        } catch (err) {
            logBridgeWarning(`export:${kind}:${format}`, err)
            setStatus({ tone: 'error', text: err?.message || 'Export failed' })
        } finally {
            setBusy(false)
        }
    }

    function openFolder() {
        if (status?.path) bridge.reportReveal(status.path)
    }

    const triggerClass = [
        'export-menu-trigger',
        `v3-btn v3-btn-${variant}`,
        size === 'sm' ? 'export-menu-sm' : '',
        className,
    ].filter(Boolean).join(' ')

    return (
        <div className={`export-menu ${busy ? 'export-menu-busy' : ''}`} ref={rootRef}>
            <button
                type="button"
                className={triggerClass}
                onClick={() => !disabled && !busy && setOpen(v => !v)}
                disabled={disabled || busy}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                {busy
                    ? <><Loader2 size={14} className="spin-icon" /> Exporting…</>
                    : <><Download size={14} /> {label}</>}
            </button>

            {open && (
                <div className="export-menu-pop" role="menu">
                    {formats.includes('pdf') && (
                        <button type="button" className="export-menu-item" onClick={() => runExport('pdf')}>
                            <FileText size={15} />
                            <div>
                                <div className="export-menu-item-title">PDF Report</div>
                                <div className="export-menu-item-sub">Stylized, print-ready</div>
                            </div>
                        </button>
                    )}
                    {formats.includes('csv') && (
                        <button type="button" className="export-menu-item" onClick={() => runExport('csv')}>
                            <FileSpreadsheet size={15} />
                            <div>
                                <div className="export-menu-item-title">CSV Data</div>
                                <div className="export-menu-item-sub">Opens in Excel / Numbers</div>
                            </div>
                        </button>
                    )}
                </div>
            )}

            {status && (
                <div className={`export-menu-status export-menu-status-${status.tone}`}>
                    {status.tone === 'ok' ? <Check size={13} /> : <AlertCircle size={13} />}
                    <span className="export-menu-status-text">{status.text}</span>
                    {status.path && (
                        <button type="button" className="export-menu-status-link" onClick={openFolder}>
                            <ExternalLink size={11} /> Open folder
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}
