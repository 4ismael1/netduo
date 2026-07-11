import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('production inspector hardening', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'electron', 'main.js'), 'utf8')

    it('disables Chromium DevTools in packaged builds', () => {
        expect(source).toContain('devTools: isDev')
        expect(source).toContain("win.webContents.on('before-input-event'")
        expect(source).toContain("key === 'f12'")
        expect(source).toContain("win.webContents.on('context-menu'")
    })
})
