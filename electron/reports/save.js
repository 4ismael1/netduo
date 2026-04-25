/**
 * Save-dialog helper for report exports.
 *
 * Centralizes the "prompt the user for a path, then write the file"
 * dance used by every export IPC handler. Returns a uniform result
 * shape so renderer-side code can show consistent toasts.
 *
 *   { ok: true,  path: "C:/.../netduo-lan-scan.pdf" }
 *   { ok: false, cancelled: true }
 *   { ok: false, error: "EACCES..." }
 */

const { dialog, app, shell, BrowserWindow } = require('electron')
const fs = require('fs/promises')
const fsSync = require('fs')
const path = require('path')

// Whitelist of absolute paths this app wrote itself during the current
// session. `revealInFolder` refuses to open anything outside this set —
// otherwise a compromised renderer could ask Explorer to reveal
// arbitrary filesystem paths (cmd.exe, user docs, etc.), which is a
// limited but real info-leak vector.
const exportedPaths = new Set()

function rememberExported(filePath) {
    if (!filePath) return
    try {
        const canonical = fsSync.realpathSync(path.resolve(filePath))
        exportedPaths.add(canonical)
    } catch {
        // File may no longer exist by the time we canonicalise — the
        // caller still just wrote it so add the resolved literal path
        // too as a fallback key.
        exportedPaths.add(path.resolve(filePath))
    }
}

/**
 * Build a default filename from a prefix, optional detail tag and an extension.
 * Pattern: netduo-<prefix>[_<detail>]_YYYY-MM-DD_HHmm.<ext>
 */
function defaultFilename(prefix, detail, ext) {
    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const stamp =
        now.getFullYear() + '-' +
        pad(now.getMonth() + 1) + '-' +
        pad(now.getDate()) + '_' +
        pad(now.getHours()) +
        pad(now.getMinutes())
    const tag = detail ? '_' + sanitizeForFilename(detail) : ''
    return `netduo-${prefix}${tag}_${stamp}.${ext}`
}

function sanitizeForFilename(s) {
    return String(s)
        .replace(/[^a-z0-9\-_.]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60)
}

/**
 * Show a Save dialog and write the given data to the chosen path.
 *
 * @param {object} opts
 * @param {string} opts.suggestedName  Default filename inside the Downloads folder
 * @param {string} opts.ext            'pdf' or 'csv'
 * @param {Buffer|string} opts.data    Payload to write
 * @returns {Promise<{ok:boolean, path?:string, cancelled?:boolean, error?:string}>}
 */
async function saveReport({ suggestedName, ext, data }) {
    const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const defaultPath = path.join(app.getPath('downloads'), suggestedName)

    const filter = ext === 'pdf'
        ? { name: 'PDF', extensions: ['pdf'] }
        : { name: 'CSV', extensions: ['csv'] }

    const result = await dialog.showSaveDialog(parent, {
        title: 'Guardar reporte',
        defaultPath,
        filters: [filter, { name: 'Todos los archivos', extensions: ['*'] }],
    })

    if (result.canceled || !result.filePath) {
        return { ok: false, cancelled: true }
    }

    try {
        await fs.writeFile(result.filePath, data)
        rememberExported(result.filePath)
        return { ok: true, path: result.filePath }
    } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) }
    }
}

/**
 * Reveal a file in the OS file manager.
 *
 * Only paths that we ourselves exported in the current session are
 * allowed — this prevents a compromised or buggy renderer from asking
 * Explorer to reveal arbitrary filesystem locations (e.g.
 * `C:\Windows\System32\cmd.exe`). We canonicalise via realpathSync and
 * confirm the file still exists before dispatching.
 *
 * @param {string} filePath
 * @returns {boolean} true if the reveal was dispatched
 */
function revealInFolder(filePath) {
    if (!filePath) return false
    let resolved
    try {
        resolved = fsSync.realpathSync(path.resolve(filePath))
    } catch {
        return false
    }
    if (!exportedPaths.has(resolved) && !exportedPaths.has(path.resolve(filePath))) {
        return false
    }
    if (!fsSync.existsSync(resolved)) return false
    shell.showItemInFolder(resolved)
    return true
}

module.exports = { saveReport, defaultFilename, revealInFolder, rememberExported, _exportedPaths: exportedPaths }
