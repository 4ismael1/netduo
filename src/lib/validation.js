const IPV4_PART_RE = /^\d{1,3}$/
const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
const MAC_COLON_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i
const MAC_HYPHEN_RE = /^([0-9a-f]{2}-){5}[0-9a-f]{2}$/i

export function normalizeTargetInput(value = '') {
    let s = String(value ?? '').trim()
    if (!s) return ''

    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    if (s.includes('@')) s = s.split('@').pop()
    s = s.split(/[/?#]/, 1)[0]
    s = s.replace(/\.$/, '')

    // Strip :port for IPv4/domain targets (not IPv6).
    const portMatch = s.match(/^(.*):(\d{1,5})$/)
    if (portMatch && !portMatch[1].includes(':')) s = portMatch[1]

    return s.trim()
}

export function isValidIpv4(value = '') {
    const s = String(value ?? '').trim()
    const parts = s.split('.')
    if (parts.length !== 4) return false
    return parts.every(part => IPV4_PART_RE.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

export function isValidHostname(value = '') {
    const s = String(value ?? '').trim()
    if (!s || s.length > 253 || !s.includes('.')) return false

    const labels = s.split('.')
    if (labels.some(label => !label || label.length > 63 || !HOST_LABEL_RE.test(label))) return false

    const tld = labels[labels.length - 1]
    return tld.length >= 2 && /[a-z]/i.test(tld)
}

export function isValidTarget(value = '') {
    const normalized = normalizeTargetInput(value)
    return isValidIpv4(normalized) || isValidHostname(normalized)
}

export function normalizeMac(value = '') {
    return String(value ?? '').trim().replace(/-/g, ':').toLowerCase()
}

export function isValidMac(value = '') {
    const s = String(value ?? '').trim()
    return MAC_COLON_RE.test(s) || MAC_HYPHEN_RE.test(s)
}

export function parseInteger(value) {
    if (typeof value === 'number') return Number.isInteger(value) ? value : Number.NaN
    const s = String(value ?? '').trim()
    if (!/^-?\d+$/.test(s)) return Number.NaN
    return Number(s)
}

export function isValidPort(value) {
    const n = parseInteger(value)
    return Number.isInteger(n) && n >= 1 && n <= 65535
}

export function isValidPortRange(start, end, min = 1, max = 65535) {
    const s = parseInteger(start)
    const e = parseInteger(end)
    return Number.isInteger(s) && Number.isInteger(e) && s >= min && e <= max && s <= e
}

export function normalizeBaseSubnet(value = '') {
    return String(value ?? '').trim().replace(/\.$/, '')
}

export function isValidBaseSubnet(value = '') {
    const s = normalizeBaseSubnet(value)
    const parts = s.split('.')
    if (parts.length !== 3) return false
    return parts.every(part => IPV4_PART_RE.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

export function validateLanScanInputs(baseIP, rangeStart, rangeEnd) {
    const subnet = normalizeBaseSubnet(baseIP)
    const start = parseInteger(rangeStart)
    const end = parseInteger(rangeEnd)

    if (!isValidBaseSubnet(subnet)) {
        return { ok: false, error: 'Invalid base IP - use format like 192.168.1' }
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
        return { ok: false, error: 'Range values must be whole numbers' }
    }
    if (start < 1 || start > 254 || end < 1 || end > 254) {
        return { ok: false, error: 'Range must be between 1 and 254' }
    }
    if (start > end) {
        return { ok: false, error: 'Start must be <= End' }
    }
    return { ok: true, baseIP: subnet, start, end }
}
