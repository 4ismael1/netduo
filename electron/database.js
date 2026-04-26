/**
 * SQLite persistence layer for NetDuo.
 * Stores app history, speed test history, LAN check reports, and config.
 */

const path = require('path')
const fs = require('fs')
const { safeStorage } = require('electron')
const Database = require('better-sqlite3')

let db = null
// Set to `true` by init() when a corrupt DB had to be renamed and a
// fresh one created. The renderer queries this via a config read so the
// UI can surface a toast. Reset to false after the UI acknowledges.
let recoveryFlag = false

const CONFIG_ENCRYPT_PREFIX = 'enc:v1:'
const SENSITIVE_CONFIG_KEYS = new Set(['wanProbeKey', 'wanProbePool'])
const DEFAULT_PUBLIC_CONFIG_KEYS = [
    'accentColor',
    'theme',
    'pollInterval',
    'notifications',
    'notifyNewDevices',
    'macVendorLookupOnline',
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

function createDeviceSnapshotTable(currentDb) {
    currentDb.exec(`
        CREATE TABLE IF NOT EXISTS device_snapshots (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            base_ip     TEXT NOT NULL,
            scan_ts     INTEGER NOT NULL,
            devices     TEXT NOT NULL,
            device_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_subnet_ts
            ON device_snapshots (base_ip, scan_ts DESC);
    `)
}

/**
 * Persistent inventory of every device ever seen on any LAN scanned by
 * this machine. Lets the Scanner show offline-but-known devices, flag
 * newly-seen ones, and store user-provided nicknames / type overrides
 * without losing them between scans.
 *
 * Identity strategy:
 *   - Primary key: normalized MAC (lowercase, separator-free, 12 chars).
 *   - If a device has no MAC (rare — seen-only entries with missing ARP),
 *     we fall back to an IP-derived key prefixed "ip:…" so the record
 *     is still uniquely addressable, albeit less stable.
 */
function createDeviceInventoryTable(currentDb) {
    currentDb.exec(`
        CREATE TABLE IF NOT EXISTS device_inventory (
            device_key     TEXT PRIMARY KEY,        -- normalized MAC or 'ip:<addr>'
            base_ip        TEXT,                    -- subnet last seen on (display only)
            ip             TEXT,                    -- most recent IP
            mac            TEXT,                    -- raw MAC as observed
            last_hostname  TEXT,
            last_vendor    TEXT,
            last_type      TEXT,                    -- heuristic classification
            type_override  TEXT,                    -- user-set type (wins over last_type)
            nickname       TEXT,                    -- user-set display name
            notes          TEXT,                    -- free-form notes
            first_seen     INTEGER NOT NULL,        -- epoch ms
            last_seen      INTEGER NOT NULL         -- epoch ms
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_subnet
            ON device_inventory (base_ip, last_seen DESC);
    `)
}

/**
 * Migration v5: introduces a `network_id` column so the inventory is
 * truly per-NETWORK (keyed by gateway MAC when available) rather than
 * per-SUBNET. Two routers that happen to hand out 192.168.1.x don't
 * collide anymore — each keeps its own device list.
 *
 * Existing rows get network_id = base_ip as a backfill so historical
 * data is not lost. Once the user rescans a subnet, the new network_id
 * (derived from the gateway's MAC) replaces the backfill value.
 */
function addNetworkIdColumn(currentDb) {
    // SQLite doesn't support IF NOT EXISTS on ADD COLUMN; check via pragma.
    const cols = currentDb.prepare(`PRAGMA table_info(device_inventory)`).all()
    const hasNetworkId = cols.some(c => c.name === 'network_id')
    if (!hasNetworkId) {
        currentDb.exec(`ALTER TABLE device_inventory ADD COLUMN network_id TEXT`)
    }
    // Backfill any rows missing a network_id using the subnet fallback.
    currentDb.prepare(`
        UPDATE device_inventory
           SET network_id = 'ip:' || base_ip
         WHERE network_id IS NULL AND base_ip IS NOT NULL
    `).run()
    currentDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_inventory_network
            ON device_inventory (network_id, last_seen DESC);
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

/**
 * Internal config flag tracking whether the v2 sensitive-key encryption
 * has actually been applied to the on-disk values. Decoupled from
 * `user_version` so that an install where `safeStorage` was unavailable
 * at the moment of the first launch (e.g. Linux without a configured
 * keyring) still gets encrypted on the next launch where the keyring
 * has been provisioned. Without this flag the schema-version check
 * would skip the migration forever and leave sensitive values in
 * plaintext indefinitely.
 */
const ENCRYPTION_APPLIED_KEY = '__migration.v2.encryptionApplied'

function encryptSensitiveRowsNow(currentDb) {
    const rows = currentDb.prepare(
        'SELECT key, value FROM config WHERE key IN (?, ?)'
    ).all('wanProbeKey', 'wanProbePool')
    const update = currentDb.prepare('UPDATE config SET value = ? WHERE key = ?')
    let touched = 0
    for (const row of rows) {
        if (!row?.key || typeof row.value !== 'string') continue
        if (row.value.startsWith(CONFIG_ENCRYPT_PREFIX)) continue
        update.run(encodeConfigValue(row.key, row.value), row.key)
        touched++
    }
    return touched
}

function setEncryptionAppliedFlag(currentDb, applied) {
    currentDb.prepare(
        'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)'
    ).run(ENCRYPTION_APPLIED_KEY, JSON.stringify(applied))
}

function migrateSensitiveConfigValues(currentDb) {
    // The schema migration ALWAYS records its outcome — never silently
    // skip just because safeStorage isn't ready. If encryption is
    // unavailable, leave the flag false so the next launch retries.
    if (!canEncryptConfig()) {
        setEncryptionAppliedFlag(currentDb, false)
        return
    }
    encryptSensitiveRowsNow(currentDb)
    setEncryptionAppliedFlag(currentDb, true)
}

/**
 * Re-attempt the v2 encryption pass when the previous run had to skip
 * it (keyring unavailable). Called after `runMigrations` finishes —
 * `user_version` may already be >= 2 from a prior boot, but the flag
 * tells us whether the actual values are still in plaintext.
 */
function ensureSensitiveConfigEncrypted(currentDb) {
    let appliedRow
    try {
        appliedRow = currentDb.prepare(
            'SELECT value FROM config WHERE key = ?'
        ).get(ENCRYPTION_APPLIED_KEY)
    } catch {
        // Config table not ready yet — defer to a later boot.
        return
    }
    // If the flag exists and is true, nothing to do.
    if (appliedRow && appliedRow.value === 'true') return
    // If the flag exists and is false (keyring was unavailable last time)
    // OR the flag is missing but a v2-aware boot just happened, retry
    // when the keyring is now available.
    if (!canEncryptConfig()) return
    encryptSensitiveRowsNow(currentDb)
    setEncryptionAppliedFlag(currentDb, true)
}

/**
 * Migration v6: persistent history for WAN Probe scans.
 *
 * Columns mirror lan_check_history (report JSON blob + denormalised
 * summary fields for fast rendering) so list views don't have to parse
 * the full report. `probes` is the count of probe endpoints involved;
 * `findings` is the total count across all probes; `risk_score` is the
 * aggregate from the report payload.
 */
function createWanProbeHistoryTable(currentDb) {
    currentDb.exec(`
        CREATE TABLE IF NOT EXISTS wan_probe_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            report      TEXT NOT NULL,
            probes      INTEGER,
            findings    INTEGER,
            risk_score  INTEGER,
            target      TEXT,
            timestamp   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wan_probe_history_ts
            ON wan_probe_history (timestamp DESC);
    `)
}

function runMigrations(currentDb) {
    const currentVersion = Number(currentDb.pragma('user_version', { simple: true }) || 0)
    const migrations = [
        { version: 1, apply: createTables },
        { version: 2, apply: migrateSensitiveConfigValues },
        { version: 3, apply: createDeviceSnapshotTable },
        { version: 4, apply: createDeviceInventoryTable },
        { version: 5, apply: addNetworkIdColumn },
        { version: 6, apply: createWanProbeHistoryTable },
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

const { isCorruptionError } = require('./dbCorruption')

/**
 * Strictly coerce an IPC-provided value to a positive integer.
 *
 * Accepts: `7`, `"7"`. Rejects: `"7abc"` (old parseInt silently accepted),
 * `7.5`, `0`, negatives, NaN, null/undefined. Returns `null` on rejection
 * so callers can decide whether to no-op or throw.
 */
function toStrictPositiveInt(value) {
    if (typeof value === 'number') {
        return Number.isInteger(value) && value > 0 ? value : null
    }
    if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
        return Number.parseInt(value, 10)
    }
    return null
}


function openAndMigrate(dbPath) {
    const next = new Database(dbPath)
    next.pragma('journal_mode = WAL')
    next.pragma('foreign_keys = ON')
    // Quick integrity check. If the file is corrupt this throws or
    // returns anything other than 'ok', which we escalate as corruption.
    const integrity = next.pragma('integrity_check', { simple: true })
    if (integrity && integrity !== 'ok') {
        const err = new Error(`integrity_check returned ${JSON.stringify(integrity)}`)
        err.code = 'SQLITE_CORRUPT'
        throw err
    }
    runMigrations(next)
    // Retry the v2 sensitive-config encryption if the previous boot
    // skipped it (typically: keyring not configured at first launch).
    ensureSensitiveConfigEncrypted(next)
    return next
}

/**
 * Open the SQLite file, migrate, and recover gracefully from corruption.
 *
 * Recovery strategy:
 *   1. Try to open + integrity_check + migrate normally.
 *   2. If that throws a corruption-shaped error, rename the corrupt
 *      file (and any WAL/SHM sidecars) to `${path}.corrupt.<timestamp>`
 *      and create a fresh DB in its place.
 *   3. If the second attempt also fails, fall back to an in-memory DB
 *      so the app can at least start; the renderer will see the
 *      recovery flag and can warn the user that nothing will persist.
 *
 * The recovery flag is exposed to the renderer via config key
 * `__db.recovered` which is transient — it's set to `true` here and
 * cleared once the UI reads it.
 */
function init(userDataPath) {
    const dbPath = path.join(userDataPath, 'netduo.db')
    try {
        db = openAndMigrate(dbPath)
        return db
    } catch (err) {
        if (!isCorruptionError(err)) throw err

        // Rename the corrupt files so we don't lose forensics — the
        // user can send them in for triage if needed.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const sidecars = ['', '-wal', '-shm']
        for (const suffix of sidecars) {
            const src = dbPath + suffix
            if (fs.existsSync(src)) {
                try { fs.renameSync(src, `${src}.corrupt.${stamp}`) } catch { /* keep going */ }
            }
        }

        try {
            db = openAndMigrate(dbPath)
            recoveryFlag = true
            return db
        } catch (inner) {
            // Last-resort fallback: in-memory DB so the app can render
            // something. Nothing will persist until the user restarts.
            db = new Database(':memory:')
            db.pragma('foreign_keys = ON')
            runMigrations(db)
            recoveryFlag = true
            const wrapped = new Error(`DB corruption unrecoverable, falling back to in-memory: ${inner.message}`)
            wrapped.cause = inner
            console.error('[database]', wrapped)
            return db
        }
    }
}

/**
 * Returns (and clears) the transient flag set when init() recovered
 * from DB corruption. The UI calls this once on startup; subsequent
 * calls return false.
 */
function consumeRecoveryFlag() {
    const was = recoveryFlag
    recoveryFlag = false
    return was
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
    // Strict parse: reject `"123abc"`, floats, negatives, zero.
    const safeId = toStrictPositiveInt(id)
    if (safeId === null) return lanCheckHistoryGetAll()
    db.prepare('DELETE FROM lan_check_history WHERE id = ?').run(safeId)
    return lanCheckHistoryGetAll()
}

function lanCheckHistoryClear() {
    db.prepare('DELETE FROM lan_check_history').run()
    return []
}

/* ─── WAN Probe history ─── */

/**
 * Return every persisted WAN Probe report ordered newest-first. The
 * `report` field is JSON-parsed so callers can render summary cards
 * without touching the raw string.
 */
function wanProbeHistoryGetAll() {
    return db.prepare('SELECT * FROM wan_probe_history ORDER BY id DESC LIMIT 120').all().map(row => ({
        ...row,
        report: row.report ? tryParse(row.report) : null,
    }))
}

/**
 * Persist a WAN Probe aggregate report. Shape expected:
 *   { target, generatedAt, summary: { probes, findingsCount, riskScore }, probes: [...], findings: [...] }
 * A wrapper `{ report: {...} }` is also accepted for symmetry with
 * the LAN Check history API.
 */
function wanProbeHistoryAdd(entry) {
    const report = entry && typeof entry === 'object' ? (entry.report || entry) : null
    if (!report || typeof report !== 'object') return wanProbeHistoryGetAll()

    const summary = report.summary && typeof report.summary === 'object' ? report.summary : {}
    const probesCount = Number.isFinite(summary.probes)
        ? Number(summary.probes)
        : (Array.isArray(report.probes) ? report.probes.length : null)
    const findingsCount = Number.isFinite(summary.findingsCount)
        ? Number(summary.findingsCount)
        : (Array.isArray(report.findings) ? report.findings.length : null)
    const riskScore = Number.isFinite(summary.riskScore) ? Number(summary.riskScore) : null
    const target = typeof report.target === 'string' ? report.target : null
    const now = new Date().toISOString()

    db.prepare(`
        INSERT INTO wan_probe_history (report, probes, findings, risk_score, target, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(JSON.stringify(report), probesCount, findingsCount, riskScore, target, now)

    // Cap at 120 latest entries — parallel cap to lan_check_history.
    db.prepare(`
        DELETE FROM wan_probe_history
         WHERE id NOT IN (SELECT id FROM wan_probe_history ORDER BY id DESC LIMIT 120)
    `).run()

    return wanProbeHistoryGetAll()
}

function wanProbeHistoryDelete(id) {
    const safeId = toStrictPositiveInt(id)
    if (safeId === null) return wanProbeHistoryGetAll()
    db.prepare('DELETE FROM wan_probe_history WHERE id = ?').run(safeId)
    return wanProbeHistoryGetAll()
}

function wanProbeHistoryClear() {
    db.prepare('DELETE FROM wan_probe_history').run()
    return []
}

/* ─── Device snapshots (LAN scan history for change tracking) ─── */

const DEVICE_SNAPSHOT_RETENTION = 50  // keep the last N snapshots per subnet

function deviceSnapshotAdd(baseIP, devices) {
    if (!baseIP || !Array.isArray(devices)) return null
    const scanTs = Date.now()
    const payload = JSON.stringify(devices)
    const info = db.prepare(`
        INSERT INTO device_snapshots (base_ip, scan_ts, devices, device_count)
        VALUES (?, ?, ?, ?)
    `).run(baseIP, scanTs, payload, devices.length)

    // Prune older snapshots for this subnet beyond the retention window.
    db.prepare(`
        DELETE FROM device_snapshots
        WHERE base_ip = ?
          AND id NOT IN (
              SELECT id FROM device_snapshots
              WHERE base_ip = ?
              ORDER BY scan_ts DESC
              LIMIT ?
          )
    `).run(baseIP, baseIP, DEVICE_SNAPSHOT_RETENTION)

    return { id: info.lastInsertRowid, scanTs, baseIP, deviceCount: devices.length }
}

function deviceSnapshotLatest(baseIP, beforeTs = null) {
    const row = beforeTs
        ? db.prepare(`
            SELECT id, base_ip, scan_ts, devices, device_count
            FROM device_snapshots
            WHERE base_ip = ? AND scan_ts < ?
            ORDER BY scan_ts DESC LIMIT 1
        `).get(baseIP, beforeTs)
        : db.prepare(`
            SELECT id, base_ip, scan_ts, devices, device_count
            FROM device_snapshots
            WHERE base_ip = ?
            ORDER BY scan_ts DESC LIMIT 1
        `).get(baseIP)

    if (!row) return null
    return {
        id: row.id,
        baseIP: row.base_ip,
        scanTs: row.scan_ts,
        deviceCount: row.device_count,
        devices: tryParse(row.devices) || [],
    }
}

function deviceSnapshotList(baseIP, limit = 20) {
    // Clamp limit into [1, 100]. Rejects non-integer / negative input
    // outright instead of silently truncating via `| 0` which accepted
    // floats and flipped negatives into huge unsigned values.
    const parsedLimit = toStrictPositiveInt(limit) ?? 20
    const safeLimit = Math.max(1, Math.min(100, parsedLimit))
    const rows = db.prepare(`
        SELECT id, base_ip, scan_ts, device_count
        FROM device_snapshots
        WHERE base_ip = ?
        ORDER BY scan_ts DESC
        LIMIT ?
    `).all(baseIP, safeLimit)

    return rows.map(r => ({
        id: r.id,
        baseIP: r.base_ip,
        scanTs: r.scan_ts,
        deviceCount: r.device_count,
    }))
}

function deviceSnapshotGet(id) {
    // Reject non-integer IDs up front — `id | 0` used to coerce
    // strings like "7abc" to 7 silently.
    const safeId = toStrictPositiveInt(id)
    if (safeId === null) return null
    const row = db.prepare(`
        SELECT id, base_ip, scan_ts, devices, device_count
        FROM device_snapshots WHERE id = ?
    `).get(safeId)
    if (!row) return null
    return {
        id: row.id,
        baseIP: row.base_ip,
        scanTs: row.scan_ts,
        deviceCount: row.device_count,
        devices: tryParse(row.devices) || [],
    }
}

function deviceSnapshotClear(baseIP) {
    if (baseIP) {
        db.prepare('DELETE FROM device_snapshots WHERE base_ip = ?').run(baseIP)
    } else {
        db.prepare('DELETE FROM device_snapshots').run()
    }
    return true
}

/* ─── Device inventory (persistent known-device registry) ─── */

/**
 * Build a stable key for an inventory record. Mirrors the renderer-side
 * `stableKey()` in src/lib/deviceDiff.js so both code paths agree on
 * what "the same device" means across scans.
 */
function inventoryKey(device) {
    if (!device) return null
    if (typeof device.mac === 'string') {
        const cleaned = device.mac.toLowerCase().replace(/[^0-9a-f]/g, '')
        if (cleaned.length === 12 && cleaned !== '000000000000' && cleaned !== 'ffffffffffff') {
            // Match the renderer-side stableKey() in src/lib/deviceDiff.js
            // so both sides agree on "same device across scans".
            return `mac:${cleaned}`
        }
    }
    if (device.ip) return `ip:${device.ip}`
    return null
}

/**
 * Query the inventory for devices belonging to a specific network. The
 * caller passes a `networkId` derived from the gateway's MAC (preferred)
 * or the subnet (fallback) — see deriveNetworkId() in the Scanner page.
 *
 * Accepting `null` returns every device across every known network,
 * which is useful for a global "All networks" view (not wired to UI yet
 * but kept as an option).
 */
function deviceInventoryList(networkId) {
    const rows = networkId
        ? db.prepare(`
            SELECT * FROM device_inventory
            WHERE network_id = ?
            ORDER BY last_seen DESC
        `).all(networkId)
        : db.prepare(`SELECT * FROM device_inventory ORDER BY last_seen DESC`).all()

    return rows.map(toInventoryView)
}

function deviceInventoryGet(deviceKey) {
    const row = db.prepare(`SELECT * FROM device_inventory WHERE device_key = ?`).get(deviceKey)
    return row ? toInventoryView(row) : null
}

function toInventoryView(row) {
    return {
        deviceKey: row.device_key,
        networkId: row.network_id || (row.base_ip ? `ip:${row.base_ip}` : null),
        baseIP: row.base_ip || null,
        ip: row.ip || null,
        mac: row.mac || null,
        hostname: row.last_hostname || null,
        vendor: row.last_vendor || null,
        type: row.last_type || null,
        typeOverride: row.type_override || null,
        nickname: row.nickname || null,
        notes: row.notes || null,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
    }
}

/**
 * Rekey legacy (pre-scoping) inventory rows to the new network-scoped
 * primary key. See deviceInventoryMergeScan for the motivating bug.
 *
 * Handles three cases per legacy row:
 *
 *  1. Uncurated (no nickname / notes / type_override): DELETE. These are
 *     proxy-ARP phantoms from earlier buggy scans. Re-scanning the same
 *     network will resurrect anything that is actually present.
 *
 *  2. Curated, no conflict at the scoped key: in-place rekey:
 *     `UPDATE device_key = scopedKey, network_id = networkId WHERE rowid = ?`.
 *
 *  3. Curated, conflict at the scoped key (scoped row already exists
 *     from a previous scan): merge. User metadata wins from whichever
 *     row has it; if both curated, legacy wins (it's the one the user
 *     claimed earliest and hasn't been overwritten). first_seen = min,
 *     last_seen = max, observed fields (hostname/vendor/type/mac/ip) use
 *     the row with the most recent last_seen. Then DELETE the legacy row.
 *
 * Everything happens in a single transaction.
 */
function consolidateLegacyRows(networkId, baseIP, now) {
    const legacyNetworkId = `ip:${baseIP}`

    // Snapshot all legacy rows for this subnet up-front so we iterate a
    // stable list (we're about to DELETE / UPDATE them).
    const legacyRows = db.prepare(`
        SELECT * FROM device_inventory
         WHERE network_id = ?
           AND device_key NOT LIKE '%::%'
    `).all(legacyNetworkId)

    if (!legacyRows.length) return { rekeyed: 0, merged: 0, dropped: 0 }

    const selectScoped = db.prepare(`SELECT * FROM device_inventory WHERE device_key = ?`)
    const rekeyStmt = db.prepare(`
        UPDATE device_inventory
           SET device_key = ?, network_id = ?
         WHERE device_key = ?
    `)
    const deleteStmt = db.prepare(`DELETE FROM device_inventory WHERE device_key = ?`)
    const mergeUpdateStmt = db.prepare(`
        UPDATE device_inventory SET
            base_ip       = ?,
            ip            = ?,
            mac           = ?,
            last_hostname = ?,
            last_vendor   = ?,
            last_type     = ?,
            type_override = ?,
            nickname      = ?,
            notes         = ?,
            first_seen    = ?,
            last_seen     = ?
         WHERE device_key = ?
    `)

    let rekeyed = 0
    let merged = 0
    let dropped = 0

    const pickNewer = (a, b, field) => {
        const aSeen = a?.last_seen || 0
        const bSeen = b?.last_seen || 0
        if (aSeen >= bSeen) return a?.[field] ?? b?.[field] ?? null
        return b?.[field] ?? a?.[field] ?? null
    }
    const coalesceUserField = (legacy, scoped, field) => {
        // Legacy wins if it has a value (it's the original user claim);
        // otherwise fall back to whatever the scoped row had.
        return legacy?.[field] != null ? legacy[field] : (scoped?.[field] ?? null)
    }

    const tx = db.transaction(() => {
        for (const legacy of legacyRows) {
            const hasMeta = !!(legacy.nickname || legacy.notes || legacy.type_override)
            if (!hasMeta) {
                // Phantom legacy row. Drop it so Scanner's mount-time
                // fallback to `ip:<subnet>` can't resurrect it.
                deleteStmt.run(legacy.device_key)
                dropped++
                continue
            }

            const scopedKey = `${networkId}::${legacy.device_key}`
            const existing = selectScoped.get(scopedKey)

            if (!existing) {
                // Clean rekey — no conflict.
                rekeyStmt.run(scopedKey, networkId, legacy.device_key)
                rekeyed++
                continue
            }

            // Conflict: merge legacy's curation into the scoped row.
            mergeUpdateStmt.run(
                existing.base_ip || legacy.base_ip || baseIP,
                pickNewer(existing, legacy, 'ip'),
                pickNewer(existing, legacy, 'mac'),
                pickNewer(existing, legacy, 'last_hostname'),
                pickNewer(existing, legacy, 'last_vendor'),
                pickNewer(existing, legacy, 'last_type'),
                coalesceUserField(legacy, existing, 'type_override'),
                coalesceUserField(legacy, existing, 'nickname'),
                coalesceUserField(legacy, existing, 'notes'),
                Math.min(legacy.first_seen || now, existing.first_seen || now),
                Math.max(legacy.last_seen || 0, existing.last_seen || 0),
                scopedKey,
            )
            deleteStmt.run(legacy.device_key)
            merged++
        }
    })
    tx()

    return { rekeyed, merged, dropped }
}

/**
 * Merge a fresh scan's results into the persistent inventory.
 *
 * - INSERTs records for devices never seen before on this NETWORK
 *   (first_seen = last_seen = now). Note: "new" is scoped to the
 *   network_id, so the same MAC seen on a DIFFERENT network counts as
 *   new for that network.
 * - UPDATEs last_seen + latest observed hostname/vendor/type/ip for
 *   devices already recorded on this network. User-provided nickname /
 *   type_override / notes are preserved (never overwritten here).
 *
 * The matching composite key is (network_id, device_key) — a MAC seen
 * on two networks exists as two separate rows, each with its own
 * nickname/type/history.
 *
 * @param {string}        networkId  e.g. "mac:04:95:e6:79:bc:80" or "ip:192.168.1"
 * @param {string}        baseIP     e.g. "192.168.1" (stored for display)
 * @param {Array<object>} devices    LAN scan result list
 * @returns {{ updatedKeys: string[], newKeys: string[] }}
 */
function deviceInventoryMergeScan(networkId, baseIP, devices) {
    if (!Array.isArray(devices) || devices.length === 0) {
        return { updatedKeys: [], newKeys: [] }
    }
    const now = Date.now()

    // Consolidate legacy rows before the main merge runs.
    //
    // Context: migration v5 added `network_id` as a TEXT column and
    // backfilled old rows with `network_id='ip:<subnet>'`, but left the
    // primary key `device_key` as the bare base key (no `${networkId}::`
    // prefix). Since the merge below uses the scoped form, a legacy
    // curated row with PK `mac:aabbcc...` never matches the lookup for
    // `mac:<gw>::mac:aabbcc...` — it inserts a brand-new row, leaving
    // the curated metadata orphaned and creating a visible duplicate.
    //
    // Fix: rekey curated legacy rows in place, merging with any existing
    // scoped row if there's a conflict. Uncurated legacy rows are still
    // dropped — they're proxy-ARP phantoms from buggy earlier scans.
    //
    // The whole thing runs in one DB transaction so a mid-flight crash
    // can't leave half-migrated state.
    if (networkId && networkId.startsWith('mac:') && baseIP) {
        consolidateLegacyRows(networkId, baseIP, now)
    }
    // We match per-network so the same MAC seen on two networks doesn't
    // collide. The `device_key` PRIMARY KEY is still just the MAC, so we
    // concatenate network_id into the stored key to keep rows unique.
    const selectStmt = db.prepare(`SELECT device_key FROM device_inventory WHERE device_key = ?`)
    const insertStmt = db.prepare(`
        INSERT INTO device_inventory
        (device_key, network_id, base_ip, ip, mac, last_hostname, last_vendor, last_type,
         type_override, nickname, notes, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
    `)
    const updateStmt = db.prepare(`
        UPDATE device_inventory SET
            network_id    = ?,
            base_ip       = ?,
            ip            = ?,
            mac           = COALESCE(?, mac),
            last_hostname = COALESCE(?, last_hostname),
            last_vendor   = COALESCE(?, last_vendor),
            last_type     = COALESCE(?, last_type),
            last_seen     = ?
        WHERE device_key = ?
    `)

    const newKeys = []
    const updatedKeys = []

    const tx = db.transaction(() => {
        for (const device of devices) {
            const baseKey = inventoryKey(device)
            if (!baseKey) continue
            // Scope the DB primary key to the network so the same MAC on
            // two networks doesn't overwrite the other's metadata.
            const scopedKey = networkId ? `${networkId}::${baseKey}` : baseKey
            const existing = selectStmt.get(scopedKey)
            if (existing) {
                updateStmt.run(
                    networkId || null,
                    baseIP || null,
                    device.ip || null,
                    device.mac || null,
                    device.hostname || null,
                    device.vendor || null,
                    device.deviceType || device.type || null,
                    now,
                    scopedKey,
                )
                updatedKeys.push(scopedKey)
            } else {
                insertStmt.run(
                    scopedKey,
                    networkId || null,
                    baseIP || null,
                    device.ip || null,
                    device.mac || null,
                    device.hostname || null,
                    device.vendor || null,
                    device.deviceType || device.type || null,
                    now,
                    now,
                )
                newKeys.push(scopedKey)
            }
        }
    })
    tx()

    return { updatedKeys, newKeys }
}

/**
 * Patch user-controlled metadata (nickname / type_override / notes) on an
 * inventory record. Pass `null` for a field to clear it; omit to leave it
 * untouched.
 */
function deviceInventoryUpdateMeta(deviceKey, patch = {}) {
    if (!deviceKey) return null
    const existing = db.prepare(`SELECT * FROM device_inventory WHERE device_key = ?`).get(deviceKey)
    if (!existing) return null

    const next = {
        nickname: 'nickname' in patch ? patch.nickname : existing.nickname,
        type_override: 'typeOverride' in patch ? patch.typeOverride : existing.type_override,
        notes: 'notes' in patch ? patch.notes : existing.notes,
    }

    db.prepare(`
        UPDATE device_inventory
           SET nickname = ?, type_override = ?, notes = ?
         WHERE device_key = ?
    `).run(next.nickname, next.type_override, next.notes, deviceKey)

    return deviceInventoryGet(deviceKey)
}

function deviceInventoryRemove(deviceKey) {
    if (!deviceKey) return false
    const info = db.prepare(`DELETE FROM device_inventory WHERE device_key = ?`).run(deviceKey)
    return info.changes > 0
}

/**
 * Purge ghost entries from a network's inventory.
 *
 * A "ghost" is a phantom device inserted by an earlier scan that ran
 * before proxy-ARP filtering was adequate. We identify them with two
 * signatures that cannot match a legitimate LAN device:
 *
 * 1. NO MAC: the device_key is IP-based (`ip:192.168.x.y`) AND the
 *    entry wasn't seen in the current full-range scan. A real host on
 *    a LAN almost always resolves to a MAC; if it doesn't after a full
 *    sweep, it's a ping-only phantom.
 *
 * 2. SHARED MAC: the entry's MAC is used by ≥ 4 other entries on the
 *    same network. This is the hallmark of a proxy-ARP router that
 *    answered for unused IPs with its own MAC.
 *
 * User-curated entries (nickname, notes, or type_override set) are
 * NEVER purged — the user has explicitly claimed them, so even if the
 * heuristic thinks they're ghosts, we honour the curation.
 *
 * Requires the caller to pass `scanCoveredFullRange = true` only when
 * the full /24 was scanned (start=1 end=254), because rule 1 depends
 * on "not in current scan" being a reliable absence signal.
 *
 * @param {string} networkId               network identity (required)
 * @param {Set<string>} seenKeys           device_keys present in current scan
 * @param {boolean} scanCoveredFullRange   whether 1-254 was scanned
 * @returns {number} rows deleted
 */
function deviceInventoryPurgeGhosts(networkId, seenKeys, scanCoveredFullRange, gatewayDeviceKey = null) {
    if (!networkId) return 0
    const keys = seenKeys instanceof Set ? seenKeys : new Set(seenKeys || [])

    const rows = db.prepare(`
        SELECT device_key, mac, nickname, notes, type_override
          FROM device_inventory
         WHERE network_id = ?
    `).all(networkId)

    // Tally MAC occurrences for signature 2.
    const macCounts = new Map()
    for (const r of rows) {
        if (!r.mac) continue
        const k = r.mac.toLowerCase()
        macCounts.set(k, (macCounts.get(k) || 0) + 1)
    }

    // Find the gateway's MAC so we can exempt its row from the shared-MAC
    // deletion. Without this, a proxy-ARP router that answers for 4+ ghost
    // IPs with its own MAC would take the gateway down with the ghosts.
    let gatewayMac = null
    if (gatewayDeviceKey) {
        const gwRow = rows.find(r => r.device_key === gatewayDeviceKey)
        if (gwRow?.mac) gatewayMac = gwRow.mac.toLowerCase()
    }

    const toDelete = []
    for (const r of rows) {
        // Preserve user curation no matter what.
        if (r.nickname || r.notes || r.type_override) continue

        // Never purge the gateway's own row, even if it shares its MAC
        // with many ghosts (which is exactly what proxy-ARP looks like).
        if (gatewayDeviceKey && r.device_key === gatewayDeviceKey) continue

        const macKey = r.mac ? r.mac.toLowerCase() : null

        // Signature 1: no-MAC entry missing from current full scan.
        const isMaclessGhost = !r.mac && scanCoveredFullRange && !keys.has(r.device_key)

        // Signature 2: MAC shared by 4+ rows on this network. If that MAC
        // is the gateway's, any row sharing it is a proxy-ARP ghost —
        // but the gateway itself has already been exempted above.
        const isSharedMacGhost = macKey && (macCounts.get(macKey) || 0) >= 4

        if (isMaclessGhost || isSharedMacGhost) {
            toDelete.push(r.device_key)
        }
    }

    if (!toDelete.length) return 0

    const stmt = db.prepare(`DELETE FROM device_inventory WHERE device_key = ?`)
    const tx = db.transaction(() => {
        for (const key of toDelete) stmt.run(key)
    })
    tx()
    // gatewayMac is computed above for diagnostics/future heuristics; the
    // gateway-exempt path uses device_key directly.
    void gatewayMac
    return toDelete.length
}

function deviceInventoryClear(networkId) {
    if (networkId) {
        db.prepare(`DELETE FROM device_inventory WHERE network_id = ?`).run(networkId)
    } else {
        db.prepare(`DELETE FROM device_inventory`).run()
    }
    return true
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
    consumeRecoveryFlag,
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
    wanProbeHistoryGetAll,
    wanProbeHistoryAdd,
    wanProbeHistoryDelete,
    wanProbeHistoryClear,
    deviceSnapshotAdd,
    deviceSnapshotLatest,
    deviceSnapshotList,
    deviceSnapshotGet,
    deviceSnapshotClear,
    deviceInventoryList,
    deviceInventoryGet,
    deviceInventoryMergeScan,
    deviceInventoryUpdateMeta,
    deviceInventoryRemove,
    deviceInventoryClear,
    deviceInventoryPurgeGhosts,
    configGet,
    configSet,
    configGetAll,
    configGetPublic,
    configDelete,
}
