/**
 * IPC input validators.
 *
 * All network-facing IPC handlers MUST revalidate every string that flows
 * into a shell command or a URL. The renderer cannot be trusted — if
 * anyone ever achieves XSS in our content, they get full access to
 * `window.electronAPI`, and an unvalidated `ip` ends up interpolated in
 * `exec('ping ' + ip)` as RCE.
 *
 * Defence-in-depth: preload already exposes a narrow surface, but these
 * validators are the last line. When in doubt, reject.
 *
 * Every helper returns `true` only for inputs that are absolutely safe to
 * pass to `execFile` as a literal argv element (no quoting required) and
 * absolutely safe to embed in a URL path segment.
 */

// IPv4: four octets 0-255, no leading zeros beyond one digit, no spaces
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

// Subnet base: first three octets of an IPv4 address ("192.168.1" style).
const SUBNET_BASE_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){2}$/

// RFC 1123 hostname: labels 1-63 chars, alphanumeric + hyphen (not leading/trailing),
// dots between labels. Total length 1-253. Rejects shell metacharacters by construction.
const HOSTNAME_RE = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

// Allow either IPv4 or hostname — common in diagnostic inputs.
function isIPv4(value) {
    return typeof value === 'string' && IPV4_RE.test(value)
}

function isSubnetBase(value) {
    return typeof value === 'string' && SUBNET_BASE_RE.test(value)
}

function isHostname(value) {
    return typeof value === 'string' && HOSTNAME_RE.test(value)
}

function isHost(value) {
    return isIPv4(value) || isHostname(value)
}

function isPort(value) {
    const n = typeof value === 'string' ? Number(value) : value
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 65535
}

function isPortRangeBound(value) {
    const n = typeof value === 'string' ? Number(value) : value
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 65535
}

/**
 * Positive integer (e.g. IDs, counts). Accepts number or numeric string.
 * Rejects `"123abc"`, floats, zero, negatives, NaN.
 */
function isPositiveInt(value) {
    if (typeof value === 'number') return Number.isInteger(value) && value > 0
    if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return true
    return false
}

/**
 * Non-negative integer (includes zero).
 */
function isNonNegInt(value) {
    if (typeof value === 'number') return Number.isInteger(value) && value >= 0
    if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) return true
    return false
}

/**
 * Normalise a MAC address to 12 lowercase hex chars, or return null for
 * anything that isn't a valid 48-bit MAC. Accepts colon-, dash- or
 * dot-separated forms.
 */
function sanitizeMac(value) {
    if (typeof value !== 'string') return null
    const cleaned = value.toLowerCase().replace(/[^0-9a-f]/g, '')
    if (cleaned.length !== 12) return null
    if (cleaned === '000000000000' || cleaned === 'ffffffffffff') return null
    return cleaned
}

/**
 * Validate an HTTP/HTTPS URL. Rejects file://, data:, javascript:, and
 * anything without a real host. Does NOT enforce blocklist of private
 * ranges — that is a separate policy layer (see wan-probe-request).
 */
function isHttpUrl(value) {
    if (typeof value !== 'string') return false
    try {
        const u = new URL(value)
        return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname
    } catch {
        return false
    }
}

/**
 * HTTP methods we consider safe to forward from the renderer.
 */
const ALLOWED_HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
function isAllowedHttpMethod(value) {
    return typeof value === 'string' && ALLOWED_HTTP_METHODS.has(value.toUpperCase())
}

/**
 * Throw a normalised validation error. Keeping the prefix consistent lets
 * the renderer discriminate these from infrastructure failures.
 */
function invalidArg(name, value) {
    const shown = typeof value === 'string' && value.length > 40 ? value.slice(0, 37) + '…' : value
    const err = new Error(`Invalid argument ${name}: ${JSON.stringify(shown)}`)
    err.code = 'EINVAL'
    err.arg = name
    return err
}

module.exports = {
    isIPv4,
    isSubnetBase,
    isHostname,
    isHost,
    isPort,
    isPortRangeBound,
    isPositiveInt,
    isNonNegInt,
    sanitizeMac,
    isHttpUrl,
    isAllowedHttpMethod,
    ALLOWED_HTTP_METHODS,
    invalidArg,
}
