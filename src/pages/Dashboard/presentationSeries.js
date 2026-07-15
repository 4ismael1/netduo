const PRESENTATION_SEED = '__dashboardPresentationSeed'

/**
 * Give the first plottable Dashboard sample enough geometry to render a line.
 * The extra point exists only in this chart series and is removed as soon as
 * another real sample arrives. It never triggers or persists telemetry.
 */
export function appendDashboardChartSample(history, sample, { valueKey, maxPoints }) {
    const limit = Math.max(2, Math.floor(Number(maxPoints) || 2))
    const realHistory = (Array.isArray(history) ? history : [])
        .filter(point => point?.[PRESENTATION_SEED] !== true)
    const hasPlottableHistory = realHistory.some(point => Number.isFinite(point?.[valueKey]))
    const currentIsPlottable = Number.isFinite(sample?.[valueKey])

    if (!hasPlottableHistory && currentIsPlottable) {
        const priorLimit = limit - 2
        const retainedHistory = priorLimit > 0 ? realHistory.slice(-priorLimit) : []
        return [
            ...retainedHistory,
            { ...sample, [PRESENTATION_SEED]: true },
            sample,
        ]
    }

    return [...realHistory, sample].slice(-limit)
}

export function isDashboardPresentationSeed(point) {
    return point?.[PRESENTATION_SEED] === true
}
