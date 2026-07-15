// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
    app: { getPath: () => os.tmpdir() },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    dialog: { showSaveDialog: vi.fn() },
    shell: { showItemInFolder: vi.fn() },
}))

let rememberExported
let exportedPaths
let maxExportedPaths

beforeAll(async () => {
    const reports = (await import('./save.js')).default
    rememberExported = reports.rememberExported
    exportedPaths = reports._exportedPaths
    maxExportedPaths = reports._maxExportedPaths
})

afterEach(() => {
    exportedPaths.clear()
})

describe('report reveal authorization cache', () => {
    it('keeps only the most recent exported paths', () => {
        for (let index = 0; index < maxExportedPaths + 5; index += 1) {
            rememberExported(path.join(os.tmpdir(), `netduo-missing-export-${index}.pdf`))
        }

        expect(exportedPaths.size).toBe(maxExportedPaths)
        expect(exportedPaths.has(path.resolve(os.tmpdir(), 'netduo-missing-export-0.pdf'))).toBe(false)
        expect(exportedPaths.has(path.resolve(os.tmpdir(), `netduo-missing-export-${maxExportedPaths + 4}.pdf`))).toBe(true)
    })

    it('refreshes an existing path without growing the cache', () => {
        const filePath = path.join(os.tmpdir(), 'netduo-export-cache-refresh.pdf')
        fs.writeFileSync(filePath, 'report')
        try {
            rememberExported(filePath)
            rememberExported(filePath)
            expect(exportedPaths.size).toBe(1)
        } finally {
            fs.rmSync(filePath, { force: true })
        }
    })
})
