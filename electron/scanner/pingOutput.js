/**
 * Helpers for interpreting ping output across platforms/locales.
 *
 * Windows Spanish can print "Respuesta desde <local-ip>: Host de destino
 * inaccesible" for a failed probe. Matching only "Respuesta desde" would mark
 * that as alive, so success requires positive evidence such as TTL, time, or
 * Unix "bytes from", and rejects common failure phrases first.
 */

const PING_TIME_RE = /(?:tiempo|time|zeit|temps|tempo|tyd)[=<]\s*(\d+\.?\d*)/i

const PING_FAILURE_RE = /(?:destination host unreachable|host de destino inaccesible|destino inaccesible|unreachable|tiempo de espera agotado|request timed out|transmit failed|general failure|100%\s*(?:loss|perdidos))/i
const PING_SUCCESS_RE = /(?:ttl[=\s:]\s*\d+|bytes\s+from|\bbytes=\d+)/i

function isPingReply(output) {
    const text = String(output || '')
    if (!text.trim()) return false
    if (PING_FAILURE_RE.test(text)) return false
    return PING_SUCCESS_RE.test(text) || PING_TIME_RE.test(text)
}

module.exports = {
    PING_TIME_RE,
    isPingReply,
}
