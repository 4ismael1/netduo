export async function runWithConcurrency(tasks, limit, onEach, signal = null) {
    const outputs = new Array(tasks.length)
    let cursor = 0
    let completed = 0

    async function worker() {
        while (!signal?.aborted && cursor < tasks.length) {
            const index = cursor
            cursor += 1
            if (signal?.aborted) return
            try { outputs[index] = await tasks[index]() } catch { outputs[index] = null }
            if (signal?.aborted) return
            completed += 1
            onEach?.(completed, tasks.length)
        }
    }

    const size = Math.max(1, Math.min(limit, tasks.length || 1))
    await Promise.all(Array.from({ length: size }, () => worker()))
    return outputs
}
