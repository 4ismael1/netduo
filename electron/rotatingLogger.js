const fs = require('fs')
const path = require('path')

function createRotatingLogger({
    resolveFilePath,
    maxBytes = 512 * 1024,
    batchDelayMs = 100,
    now = () => new Date(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onError = () => {},
} = {}) {
    if (typeof resolveFilePath !== 'function') throw new TypeError('resolveFilePath is required')

    let buffer = []
    let timer = null
    let tail = Promise.resolve()

    async function appendPayload(payload) {
        const filePath = path.resolve(resolveFilePath())
        const directory = path.dirname(filePath)
        const backupPath = `${filePath}.1`
        await fs.promises.mkdir(directory, { recursive: true })

        let currentBytes = 0
        try { currentBytes = (await fs.promises.stat(filePath)).size } catch { /* first write */ }
        if (currentBytes > 0 && currentBytes + Buffer.byteLength(payload, 'utf8') > maxBytes) {
            await fs.promises.rm(backupPath, { force: true }).catch(() => {})
            await fs.promises.rename(filePath, backupPath).catch(error => {
                if (error?.code !== 'ENOENT') throw error
            })
        }
        await fs.promises.appendFile(filePath, payload, 'utf8')
    }

    function enqueueBufferedLines() {
        if (!buffer.length) return tail
        const payload = buffer.join('')
        buffer = []
        tail = tail
            .then(() => appendPayload(payload))
            .catch(error => { onError(error) })
        return tail
    }

    function log(message) {
        const date = now()
        const timestamp = date instanceof Date ? date.toISOString() : new Date(date).toISOString()
        buffer.push(`[${timestamp}] ${String(message)}\n`)
        if (timer) return
        timer = setTimeoutFn(() => {
            timer = null
            enqueueBufferedLines()
        }, Math.max(0, batchDelayMs))
        timer?.unref?.()
    }

    function flush() {
        if (timer) clearTimeoutFn(timer)
        timer = null
        enqueueBufferedLines()
        return tail
    }

    return Object.freeze({ log, flush })
}

module.exports = { createRotatingLogger }
