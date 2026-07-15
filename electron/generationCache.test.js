const {
    createGenerationCache,
    invalidateGenerationCache,
    readGenerationCache,
} = require('./generationCache')

function deferred() {
    let resolve
    const promise = new Promise(res => { resolve = res })
    return { promise, resolve }
}

describe('generation-aware native cache', () => {
    it('never serves or stores a result started in the previous generation', async () => {
        const oldRead = deferred()
        const currentRead = deferred()
        const load = vi.fn()
            .mockReturnValueOnce(oldRead.promise)
            .mockReturnValueOnce(currentRead.promise)
        const cache = createGenerationCache()

        const oldConsumer = readGenerationCache(cache, load, { ttlMs: 4000 })
        await Promise.resolve()
        invalidateGenerationCache(cache)
        const currentConsumer = readGenerationCache(cache, load, { ttlMs: 4000 })
        expect(load).toHaveBeenCalledTimes(1)

        oldRead.resolve({ ssid: 'Old network' })
        for (let turn = 0; turn < 8 && load.mock.calls.length < 2; turn += 1) {
            await Promise.resolve()
        }
        expect(load).toHaveBeenCalledTimes(2)
        currentRead.resolve({ ssid: 'Current network' })

        await expect(oldConsumer).resolves.toEqual({ ssid: 'Current network' })
        await expect(currentConsumer).resolves.toEqual({ ssid: 'Current network' })
        expect(cache.value).toEqual({ ssid: 'Current network' })
    })

    it('coalesces every caller in the current generation into one load', async () => {
        const nativeRead = deferred()
        const load = vi.fn(() => nativeRead.promise)
        const cache = createGenerationCache()
        const first = readGenerationCache(cache, load, { ttlMs: 4000 })
        const second = readGenerationCache(cache, load, { ttlMs: 4000 })
        expect(second).toBe(first)
        await Promise.resolve()
        expect(load).toHaveBeenCalledTimes(1)
        nativeRead.resolve({ connected: false })
        await first
    })

    it('does not cache a non-authoritative null result', async () => {
        const load = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ connected: false })
        const cache = createGenerationCache()
        await expect(readGenerationCache(cache, load, { ttlMs: 4000 })).resolves.toBeNull()
        await expect(readGenerationCache(cache, load, { ttlMs: 4000 })).resolves.toEqual({ connected: false })
        expect(load).toHaveBeenCalledTimes(2)
    })
})
