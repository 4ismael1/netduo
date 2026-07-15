const { createIpGeoResolver, normalizeIpWhoResponse } = require('./ipGeo')

describe('IP geolocation resolver', () => {
    it('normalizes the HTTPS provider response into the existing renderer contract', () => {
        expect(normalizeIpWhoResponse({
            success: true,
            country: 'United States',
            country_code: 'us',
            city: 'Miami',
            latitude: 25.76,
            longitude: -80.19,
            connection: { asn: 64500, isp: 'Example ISP', org: 'Example Org' },
            timezone: { id: 'America/New_York' },
        })).toEqual({
            country: 'United States',
            countryCode: 'US',
            city: 'Miami',
            isp: 'Example ISP',
            org: 'Example Org',
            lat: 25.76,
            lon: -80.19,
            timezone: 'America/New_York',
            as: 'AS64500 Example Org',
        })
    })

    it('accepts IPv6 and coalesces concurrent reads for the same address', async () => {
        let resolveLoad
        const load = vi.fn(() => new Promise(resolve => { resolveLoad = resolve }))
        const resolveGeo = createIpGeoResolver({ load })

        const first = resolveGeo('2001:db8::10')
        const second = resolveGeo('2001:db8::10')
        expect(second).toBe(first)
        expect(load).toHaveBeenCalledTimes(0)
        await Promise.resolve()
        expect(load).toHaveBeenCalledTimes(1)
        resolveLoad({ countryCode: 'US' })
        await expect(first).resolves.toEqual({ countryCode: 'US' })
    })

    it('uses a long success cache and only a short failure backoff', async () => {
        let now = 1000
        const load = vi.fn()
            .mockResolvedValueOnce({ countryCode: 'US' })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ countryCode: 'ES' })
        const resolveGeo = createIpGeoResolver({
            load,
            now: () => now,
            successTtlMs: 1000,
            failureTtlMs: 100,
        })

        await expect(resolveGeo('203.0.113.1')).resolves.toEqual({ countryCode: 'US' })
        now += 999
        await expect(resolveGeo('203.0.113.1')).resolves.toEqual({ countryCode: 'US' })
        expect(load).toHaveBeenCalledTimes(1)

        now += 2
        await expect(resolveGeo('203.0.113.1')).resolves.toEqual({})
        now += 99
        await expect(resolveGeo('203.0.113.1')).resolves.toEqual({})
        expect(load).toHaveBeenCalledTimes(2)

        now += 2
        await expect(resolveGeo('203.0.113.1')).resolves.toEqual({ countryCode: 'ES' })
        expect(load).toHaveBeenCalledTimes(3)
    })
})
