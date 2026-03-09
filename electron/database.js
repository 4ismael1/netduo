/**
 * SQLite persistence layer for NetDuo.
 * Stores app history, speed test history, LAN check reports, and config.
 */

const path = require('path')
const { safeStorage } = require('electron')
const Database = require('better-sqlite3')

let db = null

const CONFIG_ENCRYPT_PREFIX = 'enc:v1:'
const SENSITIVE_CONFIG_KEYS = new Set(['wanProbeKey', 'wanProbePool'])
const DEFAULT_PUBLIC_CONFIG_KEYS = [
    'accentColor',
    'theme',
    'pollInterval',
    'notifications',
    'latencyThreshold',
    'lancheck.settings',
]

function createTables(currentDb) {
    currentDb.exec(`
        CREATE TABLE IF NOT EXISTS history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            module      TEXT,
            type        TEXT,
            detail      TEXT,
            results     TEXT,
            timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS speed_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            download    REAL,
            upload      REAL,
            latency     REAL,
            jitter      REAL,
            server      TEXT,
            ts          TEXT,
            date        TEXT,
            timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS lan_check_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            report      TEXT NOT NULL,
            profile     TEXT,
            scope       TEXT,
            risk_score  INTEGER,
            findings    INTEGER,
            open_ports  INTEGER,
            timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS config (
            key         TEXT PRIMARY KEY,
            value       TEXT
        );
    `)
}

function isSensitiveConfigKey(key) {
    return SENSITIVE_CONFIG_KEYS.has(String(key || ''))
}

function canEncryptConfig() {
    return Boolean(safeStorage?.isEncryptionAvailable?.())
}

function encodeConfigValue(key, rawValue) {
    if (!isSensitiveConfigKey(key) || typeof rawValue !== 'string') return rawValue
    if (!canEncryptConfig()) return rawValue
    try {
        const encrypted = safeStorage.encryptString(rawValue)
        return `${CONFIG_ENCRYPT_PREFIX}${Buffer.from(encrypted).toString('base64')}`
    } catch {
        return rawValue
    }
}

function decodeConfigValue(key, storedValue) {
    if (typeof storedValue !== 'string') return storedValue
    if (!isSensitiveConfigKey(key)) return storedValue
    if (!storedValue.startsWith(CONFIG_ENCRYPT_PREFIX)) return storedValue
    if (!canEncryptConfig()) return null
    try {
        const encrypted = Buffer.from(storedValue.slice(CONFIG_ENCRYPT_PREFIX.length), 'base64')
        return safeStorage.decryptString(encrypted)
    } catch {
        return null
    }
}

function migrateSensitiveConfigValues(currentDb) {
    if (!canEncryptConfig()) return
    const rows = currentDb.prepare(
        'SELECT key, value FROM config WHERE key IN (?, ?)'
    ).all('wanProbeKey', 'wanProbePool')
    const update = currentDb.prepare('UPDATE config SET value = ? WHERE key = ?')

    for (const row of rows) {
        if (!row?.key || typeof row.value !== 'string') continue
        if (row.value.startsWith(CONFIG_ENCRYPT_PREFIX)) continue
        update.run(encodeConfigValue(row.key, row.value), row.key)
    }
}

function runMigrations(currentDb) {
    const currentVersion = Number(currentDb.pragma('user_version', { simple: true }) || 0)
    const migrations = [
        { version: 1, apply: createTables },
        { version: 2, apply: migrateSensitiveConfigValues },
    ]

    for (const migration of migrations) {
        if (currentVersion >= migration.version) continue
        const tx = currentDb.transaction(() => {
            migration.apply(currentDb)
            currentDb.pragma(`user_version = ${migration.version}`)
        })
        tx()
    }
}

function tryParse(value) {
    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}

function init(userDataPath) {
    const dbPath = path.join(userDataPath, 'netduo.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
    return db
}

function historyGetAll() {
    return db.prepare('SELECT * FROM history ORDER BY id DESC LIMIT 500').all().map(row => ({
        ...row,
        results: row.results ? tryParse(row.results) : null,
    }))
}

function historyAdd(entry) {
    const stmt = db.prepare(
        'INSERT INTO history (module, type, detail, results, timestamp) VALUES (?, ?, ?, ?, ?)'
    )
    const now = new Date().toISOString()
    stmt.run(
        entry.module || null,
        entry.type || null,
        entry.detail || null,
        entry.results ? JSON.stringify(entry.results) : null,
        now
    )
    db.prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 500)').run()
    return historyGetAll()
}

function historyClear() {
    db.prepare('DELETE FROM history').run()
    return []
}

function speedHistoryGetAll() {
    return db.prepare('SELECT * FROM speed_history ORDER BY id DESC LIMIT 100').all()
}

function speedHistoryAdd(entry) {
    const stmt = db.prepare(
        'INSERT INTO speed_history (download, upload, latency, jitter, server, ts, date, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const now = entry.timestamp || new Date().toISOString()
    stmt.run(
        entry.download ?? null,
        entry.upload ?? null,
        entry.latency ?? null,
        entry.jitter ?? null,
        entry.server || null,
        entry.ts || null,
        entry.date || null,
        now
    )
    db.prepare('DELETE FROM speed_history WHERE id NOT IN (SELECT id FROM speed_history ORDER BY id DESC LIMIT 100)').run()
    return speedHistoryGetAll()
}

function speedHistoryClear() {
    db.prepare('DELETE FROM speed_history').run()
    return []
}

function lanCheckHistoryGetAll() {
    return db.prepare('SELECT * FROM lan_check_history ORDER BY id DESC LIMIT 120').all().map(row => ({
        ...row,
        report: row.report ? tryParse(row.report) : null,
    }))
}

function lanCheckHistoryAdd(entry) {
    const report = entry && typeof entry === 'object' ? (entry.report || entry) : null
    if (!report || typeof report !== 'object') return lanCheckHistoryGetAll()

    const summary = report.summary && typeof report.summary === 'object' ? report.summary : {}
    const stmt = db.prepare(
        `INSERT INTO lan_check_history
        (report, profile, scope, risk_score, findings, open_ports, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const now = new Date().toISOString()
    stmt.run(
        JSON.stringify(report),
        report.profile || entry.profile || null,
        report.range || entry.scope || null,
        Number.isFinite(summary.riskScore) ? Number(summary.riskScore) : null,
        Array.isArray(report.findings) ? report.findings.length : null,
        Array.isArray(report.openPorts) ? report.openPorts.length : null,
        now
    )
    db.prepare('DELETE FROM lan_check_history WHERE id NOT IN (SELECT id FROM lan_check_history ORDER BY id DESC LIMIT 120)').run()
    return lanCheckHistoryGetAll()
}

function lanCheckHistoryDelete(id) {
    const safeId = Number.parseInt(String(id), 10)
    if (!Number.isInteger(safeId)) return lanCheckHistoryGetAll()
    db.prepare('DELETE FROM lan_check_history WHERE id = ?').run(safeId)
    return lanCheckHistoryGetAll()
}

function lanCheckHistoryClear() {
    db.prepare('DELETE FROM lan_check_history').run()
    return []
}

function configGet(key) {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key)
    const decoded = row ? decodeConfigValue(key, row.value) : null
    return decoded == null ? null : tryParse(decoded)
}

function configSet(key, value) {
    const rawValue = JSON.stringify(value)
    const storedValue = encodeConfigValue(key, rawValue)
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, storedValue)
}

function configGetAll() {
    const rows = db.prepare('SELECT key, value FROM config').all()
    const output = {}
    for (const row of rows) {
        const decoded = decodeConfigValue(row.key, row.value)
        if (decoded == null) continue
        output[row.key] = tryParse(decoded)
    }
    return output
}

function configGetPublic(keys = DEFAULT_PUBLIC_CONFIG_KEYS) {
    const requestedKeys = Array.isArray(keys) && keys.length
        ? keys
        : DEFAULT_PUBLIC_CONFIG_KEYS
    const uniqueKeys = Array.from(new Set(
        requestedKeys
            .map(key => String(key || '').trim())
            .filter(key => key && !isSensitiveConfigKey(key))
    ))

    if (!uniqueKeys.length) return {}

    const placeholders = uniqueKeys.map(() => '?').join(', ')
    const rows = db.prepare(`SELECT key, value FROM config WHERE key IN (${placeholders})`).all(...uniqueKeys)
    const output = {}
    for (const row of rows) {
        const decoded = decodeConfigValue(row.key, row.value)
        if (decoded == null) continue
        output[row.key] = tryParse(decoded)
    }
    return output
}

function configDelete(key) {
    db.prepare('DELETE FROM config WHERE key = ?').run(key)
}

function close() {
    if (db) {
        db.close()
        db = null
    }
}

module.exports = {
    init,
    close,
    isSensitiveConfigKey,
    historyGetAll,
    historyAdd,
    historyClear,
    speedHistoryGetAll,
    speedHistoryAdd,
    speedHistoryClear,
    lanCheckHistoryGetAll,
    lanCheckHistoryAdd,
    lanCheckHistoryDelete,
    lanCheckHistoryClear,
    configGet,
    configSet,
    configGetAll,
    configGetPublic,
    configDelete,
}
