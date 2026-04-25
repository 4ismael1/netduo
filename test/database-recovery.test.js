// @vitest-environment node
/**
 * Verifies the DB corruption classifier used by electron/database.js
 * init() to decide whether to quarantine and recreate the SQLite file.
 *
 * We test the pure helper (no Electron runtime) to keep the suite fast
 * and ABI-independent from better-sqlite3.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const localRequire = createRequire(import.meta.url)
const { isCorruptionError } = localRequire('../electron/dbCorruption.js')

describe('isCorruptionError', () => {
    it('recognises SQLITE_CORRUPT code', () => {
        expect(isCorruptionError({ code: 'SQLITE_CORRUPT', message: 'database disk image is malformed' })).toBe(true)
    })

    it('recognises SQLITE_NOTADB code', () => {
        expect(isCorruptionError({ code: 'SQLITE_NOTADB', message: 'file is not a database' })).toBe(true)
    })

    it('recognises SQLITE_CANTOPEN code', () => {
        expect(isCorruptionError({ code: 'SQLITE_CANTOPEN', message: 'unable to open db' })).toBe(true)
    })

    it('recognises malformed by message (no code)', () => {
        expect(isCorruptionError({ message: 'database disk image is malformed' })).toBe(true)
    })

    it('recognises encrypted-file by message', () => {
        expect(isCorruptionError({ message: 'file is encrypted or is not a database' })).toBe(true)
    })

    it('ignores unrelated errors', () => {
        expect(isCorruptionError({ code: 'EACCES', message: 'permission denied' })).toBe(false)
        expect(isCorruptionError({ message: 'SQL syntax error' })).toBe(false)
        expect(isCorruptionError(new Error('boom'))).toBe(false)
    })

    it('handles null / undefined safely', () => {
        expect(isCorruptionError(null)).toBe(false)
        expect(isCorruptionError(undefined)).toBe(false)
    })
})
