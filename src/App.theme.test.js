// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('theme bootstrap defaults', () => {
    it('uses Light consistently when no preference has been saved', () => {
        const html = read('index.html')
        const app = read('src/App.jsx')
        const settings = read('src/pages/Settings/Settings.jsx')
        const main = read('electron/main.js')

        expect(html).toMatch(/:\s*'light'\s*\n\s*var bg/)
        expect(app).toContain("? cfg.theme : 'light'")
        expect(settings).toContain("? cfg.theme : 'light'")
        expect(main).toMatch(/VALID_THEMES\.has\(savedTheme\)[\s\S]*:\s*'light'/)
    })
})
