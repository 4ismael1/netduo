// @vitest-environment node
/**
 * Audits SQLite migration behavior with real better-sqlite3 databases.
 *
 * Mocked database tests cannot prove real SQLite schema behavior. These tests
 * exercise virgin, legacy, and repeated-init paths through the current v6
 * schema against actual SQLite files.
 *
 * NOTE on skip behaviour: better-sqlite3 ships with native bindings
 * compiled against Electron's NODE_MODULE_VERSION (143 for Electron 40),
 * not the system Node ABI (137 for Node 24). The IIFE below detects this
 * mismatch and skips the suite. Re-enabling these tests requires
 * rebuilding the binding for system Node:
 *
 *     npm rebuild better-sqlite3 --build-from-source --runtime=node
 *
 * After running them, restore the Electron ABI:
 *
 *     npx electron-builder install-app-deps
 *
 * Skipping is intentional and tracked — pure-JS coverage in
 * electron/database.test.js exercises the same migrations against a
 * FakeDatabase that mocks PRAGMA / SQL surface.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import database from '../electron/database.js'

let tmpDir

const canUseNativeSqlite = (() => {
    try {
        const probe = new Database(':memory:')
        probe.close()
        return true
    } catch {
        return false
    }
})()

function makeTempDir() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netduo-migration-'))
    return tmpDir
}

afterEach(() => {
    database.close()
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = null
})

describe.skipIf(!canUseNativeSqlite)('database migrations v1 to v6', () => {
    it('creates a virgin database at user_version 6 with current inventory and WAN history schemas', () => {
        const db = database.init(makeTempDir())
        const version = db.pragma('user_version', { simple: true })
        const cols = db.prepare('PRAGMA table_info(device_inventory)').all().map(c => c.name)

        expect(version).toBe(6)
        expect(cols).toContain('network_id')
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_inventory_network'").get()).toBeTruthy()
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wan_probe_history'").get()).toBeTruthy()
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_wan_probe_history_ts'").get()).toBeTruthy()
    })

    it('is idempotent when init runs repeatedly against the same DB', () => {
        const dir = makeTempDir()
        let db = database.init(dir)
        db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('theme', JSON.stringify('dark'))
        database.close()

        db = database.init(dir)
        database.close()
        db = database.init(dir)

        expect(db.pragma('user_version', { simple: true })).toBe(6)
        expect(database.configGet('theme')).toBe('dark')
    })

    it('backfills pre-v5 inventory rows with ip:<base_ip> network ids', () => {
        const dir = makeTempDir()
        const dbPath = path.join(dir, 'netduo.db')
        const legacy = new Database(dbPath)
        legacy.exec(`
            CREATE TABLE device_inventory (
                device_key     TEXT PRIMARY KEY,
                base_ip        TEXT,
                ip             TEXT,
                mac            TEXT,
                last_hostname  TEXT,
                last_vendor    TEXT,
                last_type      TEXT,
                type_override  TEXT,
                nickname       TEXT,
                notes          TEXT,
                first_seen     INTEGER NOT NULL,
                last_seen      INTEGER NOT NULL
            );
            INSERT INTO device_inventory
            (device_key, base_ip, ip, mac, first_seen, last_seen)
            VALUES ('mac:aabbccddee10', '192.168.1', '192.168.1.10', 'aa:bb:cc:dd:ee:10', 1, 2);
            PRAGMA user_version = 4;
        `)
        legacy.close()

        const migrated = database.init(dir)
        const row = migrated.prepare('SELECT device_key, network_id FROM device_inventory').get()

        expect(migrated.pragma('user_version', { simple: true })).toBe(6)
        expect(row).toEqual({ device_key: 'mac:aabbccddee10', network_id: 'ip:192.168.1' })
    })

    it('keeps rows with null base_ip migratable without throwing', () => {
        const dir = makeTempDir()
        const dbPath = path.join(dir, 'netduo.db')
        const legacy = new Database(dbPath)
        legacy.exec(`
            CREATE TABLE device_inventory (
                device_key     TEXT PRIMARY KEY,
                base_ip        TEXT,
                ip             TEXT,
                mac            TEXT,
                last_hostname  TEXT,
                last_vendor    TEXT,
                last_type      TEXT,
                type_override  TEXT,
                nickname       TEXT,
                notes          TEXT,
                first_seen     INTEGER NOT NULL,
                last_seen      INTEGER NOT NULL
            );
            INSERT INTO device_inventory
            (device_key, base_ip, ip, mac, first_seen, last_seen)
            VALUES ('ip:10.0.0.5', NULL, '10.0.0.5', NULL, 1, 2);
            PRAGMA user_version = 4;
        `)
        legacy.close()

        const migrated = database.init(dir)
        const row = migrated.prepare('SELECT device_key, network_id FROM device_inventory').get()

        expect(migrated.pragma('user_version', { simple: true })).toBe(6)
        expect(row).toEqual({ device_key: 'ip:10.0.0.5', network_id: null })
    })
})
