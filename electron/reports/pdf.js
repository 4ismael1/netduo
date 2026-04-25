/**
 * PDF generation helper.
 *
 * Uses Electron's webContents.printToPDF() on a hidden BrowserWindow.
 * No external dependencies. The HTML is self-contained (inline CSS +
 * base64-embedded logo), so the hidden window can render it from a
 * data: URL with no file I/O.
 *
 * Exports a single function: renderHTMLToPDF(html, { landscape?, pageSize? })
 * → returns a Buffer of the PDF bytes.
 */

const { BrowserWindow } = require('electron')

const DEFAULT_OPTIONS = {
    landscape: false,
    pageSize: 'Letter',
    marginsType: 0,                 // 0 = default (~1cm), 1 = none, 2 = minimum
    printBackground: true,
}

/**
 * Render an HTML string to a PDF buffer.
 *
 * The HTML must be complete (with <!doctype>, <html>, <head>, <body>) and
 * carry its own inline styles. It's loaded in a hidden BrowserWindow with
 * sandbox disabled (we trust our own HTML) and no nodeIntegration.
 *
 * @param {string} html
 * @param {object} [options]
 * @returns {Promise<Buffer>}
 */
async function renderHTMLToPDF(html, options = {}) {
    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            offscreen: true,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
        },
    })

    try {
        // Encode the HTML into a data URL. This avoids writing temp files.
        const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
        await win.loadURL(dataUrl)

        // Give Chromium a tick to paint before capturing.
        await new Promise(resolve => setTimeout(resolve, 250))

        const pdfBuffer = await win.webContents.printToPDF({
            ...DEFAULT_OPTIONS,
            ...options,
        })

        return pdfBuffer
    } finally {
        // Always tear down the hidden window, even on error.
        if (!win.isDestroyed()) {
            win.destroy()
        }
    }
}

module.exports = { renderHTMLToPDF }
