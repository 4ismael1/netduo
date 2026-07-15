function createHopStats(hop, ip) {
    return {
        hop,
        ip,
        sent: 0,
        lost: 0,
        received: 0,
        totalTime: 0,
        // The renderer only needs the latest value for its Last column.
        // Keep the public shape while bounding memory to one sample.
        times: [],
        min: null,
        max: null,
        avg: null,
        loss: '0',
    }
}

function recordHopSample(stats, time) {
    stats.sent += 1
    if (!Number.isFinite(time)) {
        stats.lost += 1
        stats.times = []
    } else {
        stats.received += 1
        stats.totalTime += time
        stats.times = [time]
        stats.min = stats.min == null ? time : Math.min(stats.min, time)
        stats.max = stats.max == null ? time : Math.max(stats.max, time)
        stats.avg = (stats.totalTime / stats.received).toFixed(1)
    }
    stats.loss = ((stats.lost / stats.sent) * 100).toFixed(0)
    return stats
}

async function mapWithConcurrency(items, limit, worker) {
    const source = Array.from(items || [])
    if (!source.length) return []
    const output = new Array(source.length)
    let cursor = 0
    const size = Math.max(1, Math.min(Math.floor(Number(limit) || 1), source.length))

    async function runWorker() {
        while (cursor < source.length) {
            const index = cursor
            cursor += 1
            output[index] = await worker(source[index], index)
        }
    }

    await Promise.all(Array.from({ length: size }, () => runWorker()))
    return output
}

function publicHopStats(stats) {
    const { received: _received, totalTime: _totalTime, ...result } = stats
    return result
}

module.exports = {
    createHopStats,
    recordHopSample,
    mapWithConcurrency,
    publicHopStats,
}
