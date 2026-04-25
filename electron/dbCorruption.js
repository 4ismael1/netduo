/**
 * Classify an error thrown by better-sqlite3 (from `new Database(path)`,
 * `pragma('integrity_check')`, or a prepared statement) as a DB
 * corruption condition vs. a transient / programmer error.
 *
 * Kept in its own module so the test suite can require() it without
 * pulling in the full `electron` runtime (database.js top-level
 * requires `electron`, which is unavailable outside the main process).
 */

const CORRUPT_ERROR_CODES = new Set([
    'SQLITE_CORRUPT',
    'SQLITE_NOTADB',
    'SQLITE_CANTOPEN',
])

// Lowercased snippets from better-sqlite3 / SQLite error messages that
// signal a corrupted or unreadable database.
const CORRUPT_MESSAGE_FRAGMENTS = [
    'malformed',
    'not a database',
    'file is encrypted',
    'disk image is malformed',
]

function isCorruptionError(err) {
    if (!err) return false
    const code = err.code || ''
    if (CORRUPT_ERROR_CODES.has(code)) return true
    const msg = String(err.message || '').toLowerCase()
    return CORRUPT_MESSAGE_FRAGMENTS.some(fragment => msg.includes(fragment))
}

module.exports = {
    isCorruptionError,
    CORRUPT_ERROR_CODES,
    CORRUPT_MESSAGE_FRAGMENTS,
}
