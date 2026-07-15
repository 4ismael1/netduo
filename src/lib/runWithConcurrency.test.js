import { describe, expect, it, vi } from 'vitest'
import { runWithConcurrency } from './runWithConcurrency.js'

function deferred() {
    let resolve
    const promise = new Promise(next => { resolve = next })
    return { promise, resolve }
}

describe('runWithConcurrency', () => {
    it('does not claim new tasks after cancellation', async () => {
        const controller = new AbortController()
        const gates = [deferred(), deferred()]
        const starts = []
        const onEach = vi.fn()
        const tasks = Array.from({ length: 6 }, (_, index) => async () => {
            starts.push(index)
            if (index < gates.length) await gates[index].promise
            return index
        })

        const running = runWithConcurrency(tasks, 2, onEach, controller.signal)
        expect(starts).toEqual([0, 1])

        controller.abort()
        gates.forEach(gate => gate.resolve())
        await running

        expect(starts).toEqual([0, 1])
        expect(onEach).not.toHaveBeenCalled()
    })
})
