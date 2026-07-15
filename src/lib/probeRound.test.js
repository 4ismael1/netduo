import { buildProbeTargets, measureProbeRound, probeStartsPerMinute } from './probeRound.js'

describe('dashboard latency rounds', () => {
    it('preserves all external targets and the gateway without duplicates', () => {
        expect(buildProbeTargets(['1.1.1.1', '8.8.8.8', 'google.com'], '192.168.1.1', true)).toEqual([
            '1.1.1.1', '8.8.8.8', 'google.com', '192.168.1.1',
        ])
        expect(buildProbeTargets(['1.1.1.1'], '1.1.1.1', true)).toEqual(['1.1.1.1'])
    })

    it('starts every target together and returns one coherent timestamp', async () => {
        const resolvers = new Map()
        const ping = vi.fn(target => new Promise(resolve => resolvers.set(target, resolve)))
        const pending = measureProbeRound({
            externalTargets: ['a', 'b', 'c'],
            gateway: 'gateway',
            includeGateway: true,
            ping,
            now: () => 123456,
        })

        await Promise.resolve()
        expect(ping.mock.calls.map(([target]) => target)).toEqual(['a', 'b', 'c', 'gateway'])
        for (const [target, resolve] of resolvers) resolve({ host: target, time: target.length })

        await expect(pending).resolves.toEqual({
            sampledAt: 123456,
            external: { a: 1, b: 1, c: 1 },
            gateway: 7,
            gatewayMeasured: true,
        })
    })

    it('keeps failed targets in the same round without discarding successful peers', async () => {
        const result = await measureProbeRound({
            externalTargets: ['a', 'b'],
            gateway: null,
            includeGateway: false,
            ping: target => target === 'a' ? Promise.resolve({ time: 12 }) : Promise.reject(new Error('blocked')),
            now: () => 99,
        })
        expect(result).toEqual({
            sampledAt: 99,
            external: { a: 12, b: null },
            gateway: null,
            gatewayMeasured: false,
        })
    })

    it('retains the original default cadence for every target', () => {
        expect(probeStartsPerMinute(3000, 4)).toBe(80)
        expect(probeStartsPerMinute(3000, 3)).toBe(60)
    })
})
