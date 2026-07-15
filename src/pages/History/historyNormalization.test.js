import { describe, expect, it } from 'vitest'
import { normalizeSpecializedHistory } from './historyNormalization.js'

describe('unified history normalization', () => {
    it('uses specialized speed history as canonical while preserving unmatched legacy rows', () => {
        const timestamp = '2026-07-15T10:00:00.000Z'
        const rows = normalizeSpecializedHistory({
            general: [
                {
                    id: 1,
                    module: 'Speed Test',
                    timestamp: '2026-07-15T10:00:00.020Z',
                    results: { timestamp, download: 500, upload: 100, latency: 8 },
                },
                {
                    id: 2,
                    module: 'Speed Test',
                    timestamp: '2025-01-01T00:00:00.000Z',
                    results: { download: 50, upload: 10, latency: 20 },
                },
            ],
            speed: [{ id: 9, timestamp, download: 500, upload: 100, latency: 8 }],
            lan: [],
            wan: [],
        })

        expect(rows.filter(row => row.module === 'Speed Test')).toHaveLength(2)
        expect(rows.map(row => row.id)).toContain('speed-9')
        expect(rows.map(row => row.id)).toContain('general-2')
        expect(rows.map(row => row.id)).not.toContain('general-1')
    })
})
