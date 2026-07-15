const net = require('net')

function normalizeIpWhoResponse(raw) {
    if (!raw || raw.success === false) return {}
    const asn = Number(raw.connection?.asn)
    return {
        country: String(raw.country || '').trim(),
        countryCode: String(raw.country_code || '').trim().toUpperCase(),
        city: String(raw.city || '').trim(),
        isp: String(raw.connection?.isp || '').trim(),
        org: String(raw.connection?.org || '').trim(),
        lat: Number.isFinite(Number(raw.latitude)) ? Number(raw.latitude) : null,
        lon: Number.isFinite(Number(raw.longitude)) ? Number(raw.longitude) : null,
        timezone: String(raw.timezone?.id || '').trim(),
        as: Number.isFinite(asn)
            ? `AS${asn}${raw.connection?.org ? ` ${String(raw.connection.org).trim()}` : ''}`
            : '',
    }
}

function hasGeoValue(value) {
    return Boolean(value && typeof value === 'object' && (
        value.country
        || value.countryCode
        || value.city
        || value.isp
        || Number.isFinite(value.lat)
        || Number.isFinite(value.lon)
    ))
}

function createIpGeoResolver({
    load,
    now = () => Date.now(),
    successTtlMs = 6 * 60 * 60 * 1000,
    failureTtlMs = 60 * 1000,
    maxEntries = 8,
} = {}) {
    if (typeof load !== 'function') throw new TypeError('load is required')
    const cache = new Map()

    return function resolveIpGeo(rawIp) {
        const ip = String(rawIp || '').trim()
        if (net.isIP(ip) === 0) return Promise.resolve({})
        const current = cache.get(ip)
        if (current?.pending) return current.pending
        if (current && current.expiresAt > now()) return Promise.resolve(current.value)

        const pending = Promise.resolve()
            .then(() => load(ip))
            .then(value => value && typeof value === 'object' ? value : {})
            .catch(() => ({}))
            .then(value => {
                const ttl = hasGeoValue(value) ? successTtlMs : failureTtlMs
                cache.delete(ip)
                cache.set(ip, { value, expiresAt: now() + Math.max(0, ttl), pending: null })
                while (cache.size > Math.max(1, maxEntries)) cache.delete(cache.keys().next().value)
                return value
            })
            .finally(() => {
                const latest = cache.get(ip)
                if (latest?.pending === pending) cache.set(ip, { ...latest, pending: null })
            })
        cache.set(ip, {
            value: current?.value || {},
            expiresAt: current?.expiresAt || 0,
            pending,
        })
        return pending
    }
}

module.exports = { createIpGeoResolver, normalizeIpWhoResponse }
