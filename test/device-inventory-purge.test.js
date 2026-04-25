// @vitest-environment node
/**
 * Audits DB-side inventory consolidation and ghost purging.
 *
 * These tests use a real temporary SQLite DB because the defects depend on
 * primary-key shape, migration state, and DELETE/UPDATE ordering.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import database from '../electron/database.js'

let tmpDir
let db

const canUseNativeSqlite = (() => {
    try {
        const probe = new Database(':memory:')
        probe.close()
        return true
    } catch {
        return false
    }
})()

function insertInventory(row) {
    db.prepare(`
        INSERT INTO device_inventory
        (device_key, network_id, base_ip, ip, mac, last_hostname, last_vendor, last_type,
         type_override, nickname, notes, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        row.deviceKey,
        row.networkId ?? null,
        row.baseIP ?? '192.168.1',
        row.ip ?? null,
        row.mac ?? null,
        row.hostname ?? null,
        row.vendor ?? null,
        row.type ?? null,
        row.typeOverride ?? null,
        row.nickname ?? null,
        row.notes ?? null,
        row.firstSeen ?? 100,
        row.lastSeen ?? 100,
    )
}

beforeEach(() => {
    if (!canUseNativeSqlite) return
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netduo-audit-'))
    db = database.init(tmpDir)
})

afterEach(() => {
    database.close()
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = null
    db = null
})

describe.skipIf(!canUseNativeSqlite)('deviceInventoryMergeScan legacy consolidation', () => {
    it('removes uncurated ip-scoped legacy rows when a MAC-scoped network is known', () => {
        insertInventory({
            deviceKey: 'mac:aabbccddee10',
            networkId: 'ip:192.168.1',
            ip: '192.168.1.10',
            mac: 'aa:bb:cc:dd:ee:10',
        })

        const result = database.deviceInventoryMergeScan('mac:001122334455', '192.168.1', [
            { ip: '192.168.1.10', mac: 'aa:bb:cc:dd:ee:10', hostname: 'pc' },
        ])

        expect(result.newKeys).toEqual(['mac:001122334455::mac:aabbccddee10'])
        expect(database.deviceInventoryList('ip:192.168.1')).toEqual([])
        expect(database.deviceInventoryList('mac:001122334455')).toHaveLength(1)
    })

    it('preserves curated legacy metadata without creating a duplicate row', () => {
        insertInventory({
            deviceKey: 'mac:aabbccddee20',
            networkId: 'ip:192.168.1',
            ip: '192.168.1.20',
            mac: 'aa:bb:cc:dd:ee:20',
            nickname: 'Living room TV',
            notes: 'Pinned by user',
            typeOverride: 'Smart TV',
        })

        database.deviceInventoryMergeScan('mac:001122334455', '192.168.1', [
            { ip: '192.168.1.20', mac: 'aa:bb:cc:dd:ee:20', hostname: 'tv' },
        ])

        const rows = database.deviceInventoryList('mac:001122334455')
        expect(rows).toHaveLength(1)
        expect(rows[0].deviceKey).toBe('mac:001122334455::mac:aabbccddee20')
        expect(rows[0].nickname).toBe('Living room TV')
        expect(rows[0].notes).toBe('Pinned by user')
        expect(rows[0].typeOverride).toBe('Smart TV')
    })

    it('keeps separate scoped rows for the same MAC on two different networks', () => {
        database.deviceInventoryMergeScan('mac:aaaaaaaaaaaa', '192.168.1', [
            { ip: '192.168.1.50', mac: 'de:ad:be:ef:00:50', hostname: 'phone-a' },
        ])
        database.deviceInventoryMergeScan('mac:bbbbbbbbbbbb', '192.168.1', [
            { ip: '192.168.1.60', mac: 'de:ad:be:ef:00:50', hostname: 'phone-b' },
        ])

        expect(database.deviceInventoryList('mac:aaaaaaaaaaaa')).toHaveLength(1)
        expect(database.deviceInventoryList('mac:bbbbbbbbbbbb')).toHaveLength(1)
        expect(database.deviceInventoryList(null).map(r => r.deviceKey).sort()).toEqual([
            'mac:aaaaaaaaaaaa::mac:deadbeef0050',
            'mac:bbbbbbbbbbbb::mac:deadbeef0050',
        ])
    })
})

describe.skipIf(!canUseNativeSqlite)('deviceInventoryPurgeGhosts', () => {
    it('purges macless ghosts only after a full-range scan', () => {
        insertInventory({
            deviceKey: 'mac:001122334455::ip:192.168.1.77',
            networkId: 'mac:001122334455',
            ip: '192.168.1.77',
            mac: null,
        })

        expect(database.deviceInventoryPurgeGhosts('mac:001122334455', new Set(), false)).toBe(0)
        expect(database.deviceInventoryList('mac:001122334455')).toHaveLength(1)

        expect(database.deviceInventoryPurgeGhosts('mac:001122334455', new Set(), true)).toBe(1)
        expect(database.deviceInventoryList('mac:001122334455')).toHaveLength(0)
    })

    it('preserves curated ghosts even when purge signatures match', () => {
        insertInventory({
            deviceKey: 'mac:001122334455::ip:192.168.1.88',
            networkId: 'mac:001122334455',
            ip: '192.168.1.88',
            mac: null,
            nickname: 'Manual device',
        })

        expect(database.deviceInventoryPurgeGhosts('mac:001122334455', new Set(), true)).toBe(0)
        expect(database.deviceInventoryList('mac:001122334455')[0].nickname).toBe('Manual device')
    })

    it('does not delete the real gateway when purging proxy-ARP shared-MAC ghosts', () => {
        const networkId = 'mac:aabbccddee01'
        insertInventory({
            deviceKey: `${networkId}::mac:aabbccddee01`,
            networkId,
            ip: '192.168.1.1',
            mac: 'aa:bb:cc:dd:ee:01',
            hostname: 'gateway',
            type: 'Gateway / Router',
        })
        for (const octet of [40, 41, 42, 43]) {
            insertInventory({
                deviceKey: `${networkId}::ip:192.168.1.${octet}`,
                networkId,
                ip: `192.168.1.${octet}`,
                mac: 'aa:bb:cc:dd:ee:01',
            })
        }

        const deleted = database.deviceInventoryPurgeGhosts(
            networkId,
            new Set([`${networkId}::mac:aabbccddee01`]),
            true,
        )

        const rows = database.deviceInventoryList(networkId)
        expect(deleted).toBe(4)
        expect(rows).toHaveLength(1)
        expect(rows[0].ip).toBe('192.168.1.1')
    })
})
