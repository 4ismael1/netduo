// @vitest-environment node

import Module from 'node:module'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeStatement {
    constructor(handlers = {}) {
        this.handlers = handlers
    }

    run(...args) {
        return this.handlers.run ? this.handlers.run(...args) : { changes: 0 }
    }

    get(...args) {
        return this.handlers.get ? this.handlers.get(...args) : undefined
    }

    all(...args) {
        return this.handlers.all ? this.handlers.all(...args) : []
    }
}

class FakeDatabase {
    constructor(filename) {
        this.filename = filename
        this.userVersion = 0
        this.tables = {
            config: new Map(),
        }
        // Minimal column metadata surfaced via PRAGMA table_info(...).
        // When migration v5 asks about `device_inventory`, we lie and say
        // `network_id` already exists so the ALTER TABLE path is skipped
        // — the fake doesn't persist row data for that table anyway, and
        // the backfill UPDATE is a no-op against the empty store.
        this.tableColumns = {
            device_inventory: [
                { cid: 0, name: 'device_key', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
                { cid: 1, name: 'base_ip', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
                { cid: 2, name: 'ip', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
                { cid: 3, name: 'mac', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
                { cid: 4, name: 'last_hostname', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
                { cid: 5, name: 'last_vendor', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
                { cid: 6, name: 'last_type', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
                { cid: 7, name: 'type_override', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
                { cid: 8, name: 'nickname', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
                { cid: 9, name: 'notes', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
                { cid: 10, name: 'first_seen', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
                { cid: 11, name: 'last_seen', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
                { cid: 12, name: 'network_id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
            ],
        }
    }

    pragma(command, options = {}) {
        const normalized = String(command || '').trim().toLowerCase()
        if (normalized === 'user_version') return options.simple ? this.userVersion : [{ user_version: this.userVersion }]
        if (normalized.startsWith('user_version =')) {
            this.userVersion = Number.parseInt(normalized.split('=').pop()?.trim() || '0', 10) || 0
            return this.userVersion
        }
        // table_info("name") support — migration v5 (addNetworkIdColumn)
        // calls this to decide whether to ALTER TABLE ADD COLUMN. Since
        // the fake doesn't actually run CREATE TABLE, we return the best
        // approximation: the columns we know the code adds/expects for
        // each table we stub. Unknown tables → empty (no columns), which
        // lets the migration code assume the table is fresh / empty.
        const tableInfoMatch = normalized.match(/^table_info\((?:'|"|)([a-z_]+)(?:'|"|)\)$/)
        if (tableInfoMatch) {
            const tableName = tableInfoMatch[1]
            const columns = this.tableColumns?.[tableName] || []
            return options.simple ? (columns[0]?.name || 0) : columns.map(c => ({ ...c }))
        }
        return options.simple ? 0 : []
    }

    exec() {
        return this
    }

    transaction(callback) {
        return (...args) => callback(...args)
    }

    prepare(sql) {
        const normalized = String(sql || '').replace(/\s+/g, ' ').trim().toUpperCase()
        const configTable = this.tables.config

        // `PRAGMA table_info(device_inventory)` is sometimes run via
        // `prepare().all()` (migration v5). Route it through pragma().
        const pragmaMatch = normalized.match(/^PRAGMA\s+TABLE_INFO\s*\(\s*['"]?([A-Z_]+)['"]?\s*\)$/i)
        if (pragmaMatch) {
            const tableName = pragmaMatch[1].toLowerCase()
            const columns = this.tableColumns?.[tableName] || []
            return new FakeStatement({
                all: () => columns.map(c => ({ ...c })),
                get: () => columns[0] ? { ...columns[0] } : undefined,
            })
        }

        // Device-inventory / snapshot statements aren't exercised by these
        // tests; stub them as no-ops so migrations run to completion
        // without needing to reimplement the whole schema in memory.
        if (
            normalized.startsWith('UPDATE DEVICE_INVENTORY')
            || normalized.startsWith('INSERT INTO DEVICE_INVENTORY')
            || normalized.startsWith('INSERT OR REPLACE INTO DEVICE_INVENTORY')
            || normalized.startsWith('DELETE FROM DEVICE_INVENTORY')
            || normalized.startsWith('SELECT') && normalized.includes('FROM DEVICE_INVENTORY')
            || normalized.startsWith('SELECT') && normalized.includes('DEVICE_SNAPSHOTS')
            || normalized.startsWith('INSERT INTO DEVICE_SNAPSHOTS')
            || normalized.startsWith('DELETE FROM DEVICE_SNAPSHOTS')
        ) {
            return new FakeStatement({
                run: () => ({ changes: 0 }),
                get: () => undefined,
                all: () => [],
            })
        }

        if (normalized === 'SELECT VALUE FROM CONFIG WHERE KEY = ?') {
            return new FakeStatement({
                get: (key) => {
                    if (!configTable.has(key)) return undefined
                    return { value: configTable.get(key) }
                },
            })
        }

        if (normalized === 'INSERT OR REPLACE INTO CONFIG (KEY, VALUE) VALUES (?, ?)') {
            return new FakeStatement({
                run: (key, value) => {
                    configTable.set(key, value)
                    return { changes: 1 }
                },
            })
        }

        if (normalized === 'SELECT KEY, VALUE FROM CONFIG') {
            return new FakeStatement({
                all: () => Array.from(configTable.entries()).map(([key, value]) => ({ key, value })),
            })
        }

        if (normalized.startsWith('SELECT KEY, VALUE FROM CONFIG WHERE KEY IN (')) {
            return new FakeStatement({
                all: (...keys) => keys
                    .filter(key => configTable.has(key))
                    .map(key => ({ key, value: configTable.get(key) })),
            })
        }

        if (normalized === 'UPDATE CONFIG SET VALUE = ? WHERE KEY = ?') {
            return new FakeStatement({
                run: (value, key) => {
                    if (!configTable.has(key)) return { changes: 0 }
                    configTable.set(key, value)
                    return { changes: 1 }
                },
            })
        }

        if (normalized === 'DELETE FROM CONFIG WHERE KEY = ?') {
            return new FakeStatement({
                run: (key) => ({ changes: configTable.delete(key) ? 1 : 0 }),
            })
        }

        throw new Error(`Unsupported SQL in FakeDatabase: ${sql}`)
    }

    close() {
        this.tables.config.clear()
    }
}

const originalLoad = Module._load

function buildSafeStorageMock() {
    return {
        isEncryptionAvailable: () => false,
        encryptString: (value) => Buffer.from(String(value), 'utf8'),
        decryptString: (value) => Buffer.from(value).toString('utf8'),
    }
}

async function loadDatabaseModule() {
    vi.resetModules()
    const mod = await import('./database.js')
    return mod.default || mod
}

let database = null

beforeAll(() => {
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'better-sqlite3') return FakeDatabase
        if (request === 'electron') return { safeStorage: buildSafeStorageMock() }
        return originalLoad.call(this, request, parent, isMain)
    }
})

afterAll(() => {
    Module._load = originalLoad
})

describe('electron/database', () => {
    beforeEach(async () => {
        database = await loadDatabaseModule()
        database.init('C:\\temp\\netduo-test')
    })

    afterEach(() => {
        database?.close?.()
        database = null
    })

    it('returns only public config keys by default', () => {
        database.configSet('theme', 'dark')
        database.configSet('pollInterval', '5')
        database.configSet('wanProbeKey', 'secret-token')
        database.configSet('wanProbePool', [{ url: 'https://probe.example', apiKey: 'secret-token' }])

        const publicConfig = database.configGetPublic()

        expect(publicConfig.theme).toBe('dark')
        expect(publicConfig.pollInterval).toBe('5')
        expect(publicConfig.wanProbeKey).toBeUndefined()
        expect(publicConfig.wanProbePool).toBeUndefined()
    })

    it('supports requesting a filtered public config subset', () => {
        database.configSet('theme', 'light')
        database.configSet('accentColor', '#3b82f6')
        database.configSet('notifications', true)
        database.configSet('wanProbeKey', 'hidden')

        const publicConfig = database.configGetPublic(['theme', 'notifications', 'wanProbeKey'])

        expect(publicConfig).toEqual({
            theme: 'light',
            notifications: true,
        })
    })
})
