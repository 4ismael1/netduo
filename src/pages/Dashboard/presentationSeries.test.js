import {
    appendDashboardChartSample,
    isDashboardPresentationSeed,
} from './presentationSeries.js'

describe('Dashboard initial chart presentation', () => {
    it('renders the first real latency as one temporary duplicate and one real sample', () => {
        const sample = { t: 1000, ms: 20 }

        const series = appendDashboardChartSample([], sample, { valueKey: 'ms', maxPoints: 30 })

        expect(series).toHaveLength(2)
        expect(series.map(point => ({ t: point.t, ms: point.ms }))).toEqual([sample, sample])
        expect(isDashboardPresentationSeed(series[0])).toBe(true)
        expect(isDashboardPresentationSeed(series[1])).toBe(false)
    })

    it('removes the presentation duplicate when the second real sample arrives', () => {
        const first = { t: 1000, ms: 20 }
        const seeded = appendDashboardChartSample([], first, { valueKey: 'ms', maxPoints: 30 })
        const second = { t: 3000, ms: 24 }

        const series = appendDashboardChartSample(seeded, second, { valueKey: 'ms', maxPoints: 30 })

        expect(series).toEqual([first, second])
        expect(series.some(isDashboardPresentationSeed)).toBe(false)
    })

    it('does not seed an unavailable value and seeds the first later value only for presentation', () => {
        const unavailable = appendDashboardChartSample([], { t: 1000, ms: null }, { valueKey: 'ms', maxPoints: 30 })
        const recovered = appendDashboardChartSample(unavailable, { t: 3000, ms: 18 }, { valueKey: 'ms', maxPoints: 30 })

        expect(unavailable).toEqual([{ t: 1000, ms: null }])
        expect(recovered).toHaveLength(3)
        expect(isDashboardPresentationSeed(recovered[1])).toBe(true)
        expect(isDashboardPresentationSeed(recovered[2])).toBe(false)
    })

    it('keeps the configured Dashboard series limit including the temporary seed', () => {
        const unavailable = Array.from({ length: 30 }, (_, index) => ({ t: index, ms: null }))

        const series = appendDashboardChartSample(
            unavailable,
            { t: 31, ms: 15 },
            { valueKey: 'ms', maxPoints: 30 },
        )

        expect(series).toHaveLength(30)
        expect(series.filter(isDashboardPresentationSeed)).toHaveLength(1)
    })
})
