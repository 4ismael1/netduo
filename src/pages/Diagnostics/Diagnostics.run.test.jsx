import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Diagnostics from './Diagnostics.jsx'
import bridge from '../../lib/electronBridge.js'
import { resetOperationsForTests } from '../../lib/operationRegistry.js'
import { resetPersistentSessionsForTests, setSessionValue } from '../../lib/persistentSession.js'

vi.mock('../../lib/electronBridge.js', () => ({
    default: {
        checkPort: vi.fn(),
        dnsLookup: vi.fn(),
    },
}))

function deferred() {
    let resolve
    const promise = new Promise(next => { resolve = next })
    return { promise, resolve }
}

describe('Diagnostics run ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetOperationsForTests()
        resetPersistentSessionsForTests()
    })

    it('does not mix DNS records from an older lookup into a newer domain', async () => {
        const requests = new Map()
        bridge.dnsLookup.mockImplementation((host, type) => {
            const item = deferred()
            requests.set(`${host}:${type}`, item)
            return item.promise
        })

        render(<Diagnostics />)
        fireEvent.click(screen.getByRole('button', { name: /DNS Resolution/i }))

        const input = screen.getByPlaceholderText(/Domain name/i)
        fireEvent.change(input, { target: { value: 'old.example' } })
        fireEvent.click(screen.getByRole('button', { name: /Resolve Records/i }))
        fireEvent.change(input, { target: { value: 'new.example' } })
        fireEvent.click(screen.getByRole('button', { name: /Resolve Records/i }))

        await act(async () => {
            for (const [key, item] of requests) {
                if (!key.startsWith('new.example:')) continue
                const type = key.split(':')[1]
                item.resolve({ type, addresses: [`new-${type}`], time: 2 })
            }
            await Promise.resolve()
        })
        expect(await screen.findByText('new-A')).toBeInTheDocument()

        await act(async () => {
            for (const [key, item] of requests) {
                if (!key.startsWith('old.example:')) continue
                const type = key.split(':')[1]
                item.resolve({ type, addresses: [`old-${type}`], time: 99 })
            }
            await Promise.resolve()
        })

        expect(screen.queryByText('old-A')).not.toBeInTheDocument()
        expect(screen.getByText('new-A')).toBeInTheDocument()
    })

    it('clears an in-flight DNS lookup on epoch change and ignores its late replies', async () => {
        const pending = []
        bridge.dnsLookup.mockImplementation(() => {
            const item = deferred()
            pending.push(item)
            return item.promise
        })
        setSessionValue('network-runtime', 'epoch', 4)
        render(<Diagnostics />)
        fireEvent.click(screen.getByRole('button', { name: /DNS Resolution/i }))
        fireEvent.click(screen.getByRole('button', { name: /Resolve Records/i }))

        act(() => { setSessionValue('network-runtime', 'epoch', 5) })
        expect(screen.getByText(/previous DNS results were cleared/i)).toBeInTheDocument()

        await act(async () => {
            pending.forEach(item => item.resolve({ type: 'A', addresses: ['stale-answer'], time: 1 }))
            await Promise.resolve()
        })
        expect(screen.queryByText('stale-answer')).not.toBeInTheDocument()
        expect(screen.queryByText(/Resolving/i)).not.toBeInTheDocument()
    })

    it('clears a single-port check on epoch change and ignores its late result', async () => {
        const pending = deferred()
        bridge.checkPort.mockReturnValue(pending.promise)
        setSessionValue('network-runtime', 'epoch', 8)
        render(<Diagnostics />)
        fireEvent.click(screen.getByRole('button', { name: /Port Checker/i }))
        fireEvent.change(screen.getByPlaceholderText(/Host or IP/i), { target: { value: 'example.com' } })
        fireEvent.click(screen.getByRole('button', { name: /^Check$/i }))

        act(() => { setSessionValue('network-runtime', 'epoch', 9) })
        expect(screen.getByText(/previous port result was cleared/i)).toBeInTheDocument()

        await act(async () => {
            pending.resolve({ open: true, time: 1 })
            await pending.promise
        })
        expect(screen.queryByText(/is Open/i)).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /^Check$/i })).toBeEnabled()
    })
})
