const RISK_WEIGHTS = { critical: 30, high: 18, medium: 9, low: 3, info: 0 }

export function scoreConfirmedRisk(findings = []) {
    const score = (findings || []).reduce((total, item) => total + (RISK_WEIGHTS[item?.severity] || 0), 0)
    return Math.max(0, Math.min(100, Math.round(score)))
}

export function evaluateLanAssessment({
    findings = [],
    discoveredCount = 0,
    targetCount = 0,
    confirmedServiceCount = 0,
    inconclusiveCount = 0,
    checksPerHost = 0,
} = {}) {
    const discovered = Math.max(0, Number(discoveredCount) || 0)
    const targets = Math.max(0, Number(targetCount) || 0)
    const checks = Math.max(0, targets * (Number(checksPerHost) || 0))
    const coveragePercent = discovered > 0 ? Math.min(100, Math.round((targets / discovered) * 1000) / 10) : 0
    const uncertaintyPercent = checks > 0 ? Math.min(100, Math.round((inconclusiveCount / checks) * 1000) / 10) : 0
    const confidencePercent = Math.max(0, Math.round((coveragePercent * (1 - uncertaintyPercent / 100)) * 10) / 10)
    const surfacePerHost = targets > 0 ? Math.round((confirmedServiceCount / targets) * 100) / 100 : 0

    return {
        riskScore: scoreConfirmedRisk(findings),
        coveragePercent,
        uncertaintyPercent,
        confidencePercent,
        surfacePerHost,
        isPartialCoverage: targets < discovered,
    }
}
