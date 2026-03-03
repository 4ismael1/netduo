/**
 * database.js — SQLite persistence layer for NetDuo
 * Uses better-sqlite3 for synchronous, fast, single-file storage.
 *
 * Tables:
 *   history        – general app activity log (Scanner, Tools, etc.)
 *   speed_history   – dedicated speed-test results
 *   config          – key/value app settings
 */

const path = require('path')
const Database = require('better-sqlite3')

let db = null

/**
 * Initialise (or open) the database.
 * Call this once after app.getPath('userData') is available.
 */
function init(userDataPath) {
    const dbPath = path.join(userDataPath, 'netduo.db')
    db = new Database(dbPath)

    // WAL mode for better concurrency & performance
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    // ── Create tables ──────────────────────────────────────
    db.exec(`
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

    return db
}

// ══════════════════════════════════════════════════════════
//   GENERAL HISTORY
// ══════════════════════════════════════════════════════════

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
        now,
    )
    // Prune if over 500
    db.prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 500)').run()
    return historyGetAll()
}

function historyClear() {
    db.prepare('DELETE FROM history').run()
    return []
}

// ══════════════════════════════════════════════════════════
//   SPEED-TEST HISTORY
// ══════════════════════════════════════════════════════════

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
        now,
    )
    // Prune if over 100
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
        now,
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

// ══════════════════════════════════════════════════════════
//   CONFIG (key/value)
// ══════════════════════════════════════════════════════════

function configGet(key) {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key)
    return row ? tryParse(row.value) : null
}

function configSet(key, value) {
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, JSON.stringify(value))
}

function configGetAll() {
    const rows = db.prepare('SELECT key, value FROM config').all()
    const obj = {}
    for (const r of rows) obj[r.key] = tryParse(r.value)
    return obj
}

function configDelete(key) {
    db.prepare('DELETE FROM config WHERE key = ?').run(key)
}

// ── Helpers ─────────────────────────────────────────────
function tryParse(str) {
    try { return JSON.parse(str) } catch { return str }
}

function close() {
    if (db) { db.close(); db = null }
}

module.exports = {
    init,
    close,
    // General history
    historyGetAll,
    historyAdd,
    historyClear,
    // Speed-test history
    speedHistoryGetAll,
    speedHistoryAdd,
    speedHistoryClear,
    // LAN Check report history
    lanCheckHistoryGetAll,
    lanCheckHistoryAdd,
    lanCheckHistoryDelete,
    lanCheckHistoryClear,
    // Config
    configGet,
    configSet,
    configGetAll,
    configDelete,
}
