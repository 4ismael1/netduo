function createGenerationCache() {
    return { value: null, ts: 0, pending: null, generation: 0 }
}

function invalidateGenerationCache(cache) {
    cache.value = null
    cache.ts = 0
    cache.generation += 1
}

function readGenerationCache(cache, load, {
    ttlMs,
    now = () => Date.now(),
    isCacheable = value => value != null,
} = {}) {
    const ttl = Math.max(0, Number(ttlMs) || 0)
    if (isCacheable(cache.value) && (now() - cache.ts) < ttl) return Promise.resolve(cache.value)

    const generation = cache.generation
    if (cache.pending) {
        if (cache.pending.generation === generation) return cache.pending.promise
        return cache.pending.promise.then(() => readGenerationCache(cache, load, { ttlMs: ttl, now, isCacheable }))
    }

    const entry = { generation, promise: null }
    const pending = Promise.resolve()
        .then(load)
        .then(value => {
            if (cache.generation !== generation) {
                if (cache.pending === entry) cache.pending = null
                return readGenerationCache(cache, load, { ttlMs: ttl, now, isCacheable })
            }
            if (isCacheable(value)) {
                cache.value = value
                cache.ts = now()
            }
            return value
        })
        .finally(() => {
            if (cache.pending === entry) cache.pending = null
        })
    entry.promise = pending
    cache.pending = entry
    return pending
}

module.exports = {
    createGenerationCache,
    invalidateGenerationCache,
    readGenerationCache,
}
