/**
 * speedtest.test.js
 * Tests for SpeedTest grading logic and performance thresholds
 */
import { describe, it, expect } from 'vitest'

// ─── Grade function (pure) ────────────────────────────────────────────────
function grade(mbps) {
    if (!mbps) return null
    if (mbps > 100) return { label: 'Excellent', color: '#10B981' }
    if (mbps > 25) return { label: 'Good', color: '#22D3EE' }
    if (mbps > 5) return { label: 'Fair', color: '#F59E0B' }
    return { label: 'Poor', color: '#EF4444' }
}

describe('SpeedTest grade()', () => {
    it('returns null for null/0/undefined', () => {
        expect(grade(null)).toBeNull()
        expect(grade(0)).toBeNull()
        expect(grade(undefined)).toBeNull()
    })

    it('returns Excellent for > 100 Mbps', () => {
        expect(grade(101).label).toBe('Excellent')
        expect(grade(500).label).toBe('Excellent')
        expect(grade(1000).label).toBe('Excellent')
    })

    it('returns Good for 26–100 Mbps', () => {
        expect(grade(26).label).toBe('Good')
        expect(grade(50).label).toBe('Good')
        expect(grade(100).label).toBe('Good')
    })

    it('returns Fair for 6–25 Mbps', () => {
        expect(grade(6).label).toBe('Fair')
        expect(grade(15).label).toBe('Fair')
        expect(grade(25).label).toBe('Fair')
    })

    it('returns Poor for ≤ 5 Mbps', () => {
        expect(grade(5).label).toBe('Poor')
        expect(grade(1).label).toBe('Poor')
        expect(grade(0.1).label).toBe('Poor')
    })

    it('each grade has a valid hex color', () => {
        ['Excellent', 'Good', 'Fair', 'Poor'].forEach((_, i) => {
            const g = grade([200, 50, 10, 2][i])
            expect(g.color).toMatch(/^#[0-9a-fA-F]{6}$/)
        })
    })

    it('boundary 100 Mbps is Good not Excellent', () => {
        expect(grade(100).label).toBe('Good')
    })

    it('boundary 5 Mbps is Poor not Fair', () => {
        expect(grade(5).label).toBe('Poor')
    })
})

// ─── Latency quality thresholds ───────────────────────────────────────────
function latencyQuality(ms) {
    if (ms == null) return 'unknown'
    if (ms < 50) return 'excellent'
    if (ms < 150) return 'good'
    if (ms < 300) return 'fair'
    return 'poor'
}

describe('Latency quality thresholds', () => {
    it('< 50ms is excellent', () => expect(latencyQuality(20)).toBe('excellent'))
    it('50-149ms is good', () => expect(latencyQuality(80)).toBe('good'))
    it('150-299ms is fair', () => expect(latencyQuality(200)).toBe('fair'))
    it('>= 300ms is poor', () => expect(latencyQuality(400)).toBe('poor'))
    it('null is unknown', () => expect(latencyQuality(null)).toBe('unknown'))
})

// ─── Progress calculation ─────────────────────────────────────────────────
describe('SpeedTest stage progress', () => {
    function stageProgress(stage) {
        return { idle: 0, latency: 35, download: 70, done: 100 }[stage] ?? 0
    }

    it('idle starts at 0', () => expect(stageProgress('idle')).toBe(0))
    it('latency stage is 35%', () => expect(stageProgress('latency')).toBe(35))
    it('download stage is 70%', () => expect(stageProgress('download')).toBe(70))
    it('done is 100%', () => expect(stageProgress('done')).toBe(100))
    it('unknown stage is 0', () => expect(stageProgress('other')).toBe(0))
})
