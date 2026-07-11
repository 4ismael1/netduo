import { describe, expect, it } from 'vitest'
import { evaluateLanAssessment, scoreConfirmedRisk } from './lanRisk'

describe('LAN risk assessment', () => {
    it('does not treat informational or inconclusive evidence as confirmed risk', () => {
        expect(scoreConfirmedRisk([{ severity: 'info' }])).toBe(0)
        expect(evaluateLanAssessment({ findings: [], targetCount: 10, discoveredCount: 10, inconclusiveCount: 80, checksPerHost: 10 }).riskScore).toBe(0)
    })

    it('reports coverage and confidence separately', () => {
        const result = evaluateLanAssessment({
            findings: [{ severity: 'medium' }],
            discoveredCount: 40,
            targetCount: 20,
            confirmedServiceCount: 10,
            inconclusiveCount: 20,
            checksPerHost: 10,
        })
        expect(result).toEqual(expect.objectContaining({
            riskScore: 9,
            coveragePercent: 50,
            uncertaintyPercent: 10,
            confidencePercent: 45,
            surfacePerHost: 0.5,
            isPartialCoverage: true,
        }))
    })

    it('does not claim full confidence when no active host was assessed', () => {
        expect(evaluateLanAssessment({ discoveredCount: 0, targetCount: 0 })).toEqual(expect.objectContaining({
            coveragePercent: 0,
            confidencePercent: 0,
        }))
    })
})
