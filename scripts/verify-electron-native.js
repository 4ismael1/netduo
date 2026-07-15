let database = null

try {
    if (!process.versions.electron) throw new Error('This check must run under Electron')
    const Database = require('better-sqlite3')
    database = new Database(':memory:')
    const result = database.prepare('SELECT 1 AS value').get()
    if (result?.value !== 1) throw new Error('SQLite smoke query returned an unexpected result')
    console.log(`Electron native ABI verified (Electron ${process.versions.electron}, ABI ${process.versions.modules}).`)
} catch (error) {
    console.error(`Electron native ABI verification failed: ${error?.stack || error}`)
    process.exitCode = 1
} finally {
    try { database?.close() } catch { /* best-effort cleanup */ }
}

setImmediate(() => process.exit(process.exitCode || 0))
