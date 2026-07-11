// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.join(process.cwd(), 'src', 'pages', 'Scanner', 'Scanner.jsx'), 'utf8')

describe('Scanner progressive configuration UI', () => {
    it('starts with the recommended automatic configuration', () => {
        expect(source).toContain("useState('auto')")
        expect(source).toContain("useState('balanced')")
        expect(source).not.toContain("configGet?.('scanner.discoveryMode')")
        expect(source).toContain('Recommended (default)')
        expect(source).toContain('Detect automatically (default)')
    })

    it('keeps technical controls behind a collapsed accessible panel', () => {
        expect(source).toContain('const [advancedOpen, setAdvancedOpen] = useState(false)')
        expect(source).toContain('aria-expanded={advancedOpen}')
        expect(source).toContain('aria-controls="scanner-advanced-options"')
        expect(source).toContain('{advancedOpen && (')
        expect(source).toContain('You normally do not need to change these settings.')
    })
})
