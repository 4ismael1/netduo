import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSmoothValue } from './useSmoothValue.js'

function Probe({ target }) {
    const value = useSmoothValue(target)
    return <output>{value.toFixed(2)}</output>
}

describe('useSmoothValue', () => {
    let callbacks
    let nextId
    let visibility
    let visibilitySpy

    beforeEach(() => {
        callbacks = new Map()
        nextId = 0
        visibility = 'visible'
        visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
        vi.stubGlobal('requestAnimationFrame', vi.fn(callback => {
            const id = ++nextId
            callbacks.set(id, callback)
            return id
        }))
        vi.stubGlobal('cancelAnimationFrame', vi.fn(id => callbacks.delete(id)))
    })

    afterEach(() => {
        visibilitySpy.mockRestore()
        vi.unstubAllGlobals()
    })

    function flushFrames(limit = 200) {
        let count = 0
        while (callbacks.size && count < limit) {
            const [id, callback] = callbacks.entries().next().value
            callbacks.delete(id)
            callback(performance.now())
            count += 1
        }
        return count
    }

    it('stops requesting frames after convergence and restarts for a new target', () => {
        const view = render(<Probe target={0} />)
        act(() => { flushFrames() })
        expect(callbacks.size).toBe(0)
        const idleCalls = requestAnimationFrame.mock.calls.length

        act(() => { flushFrames() })
        expect(requestAnimationFrame).toHaveBeenCalledTimes(idleCalls)

        view.rerender(<Probe target={100} />)
        let frames
        act(() => { frames = flushFrames() })
        expect(frames).toBeGreaterThan(1)
        expect(callbacks.size).toBe(0)
        expect(screen.getByRole('status')).toHaveTextContent('100.00')
    })

    it('does not animate while hidden and resumes when visible', () => {
        visibility = 'hidden'
        render(<Probe target={50} />)
        expect(callbacks.size).toBe(0)

        visibility = 'visible'
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'))
            flushFrames()
        })
        expect(screen.getByRole('status')).toHaveTextContent('50.00')
        expect(callbacks.size).toBe(0)
    })
})
