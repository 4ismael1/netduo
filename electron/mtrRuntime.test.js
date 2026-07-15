const {
    createHopStats,
    recordHopSample,
    mapWithConcurrency,
    publicHopStats,
} = require('./mtrRuntime')

describe('MTR bounded runtime helpers', () => {
    it('keeps constant-size samples and computes aggregate statistics incrementally', () => {
        const stats = createHopStats(1, '192.168.1.1')
        for (let value = 1; value <= 10000; value += 1) recordHopSample(stats, value)
        recordHopSample(stats, null)

        expect(stats.times).toEqual([])
        expect(stats.sent).toBe(10001)
        expect(stats.received).toBe(10000)
        expect(stats.lost).toBe(1)
        expect(stats.min).toBe(1)
        expect(stats.max).toBe(10000)
        expect(stats.avg).toBe('5000.5')
        expect(publicHopStats(stats)).not.toHaveProperty('totalTime')
        expect(publicHopStats(stats)).not.toHaveProperty('received')
    })

    it('never exceeds the requested worker concurrency', async () => {
        let active = 0
        let maximum = 0
        let release
        const gate = new Promise(resolve => { release = resolve })
        const pending = mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async value => {
            active += 1
            maximum = Math.max(maximum, active)
            await gate
            active -= 1
            return value * 2
        })

        await vi.waitFor(() => expect(active).toBe(3))
        expect(maximum).toBe(3)
        release()
        await expect(pending).resolves.toEqual([2, 4, 6, 8, 10, 12])
    })
})
