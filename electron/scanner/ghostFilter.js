/**
 * Deterministic proxy-ARP ghost filter.
 *
 * Given the raw results of a ping sweep + ARP enrichment (`{ ip, alive,
 * mac, isLocal, isGateway, macEmpty, ... }` shape), drop rows that are
 * definitively phantoms. Two rules, no thresholds, no heuristics:
 *
 *   Rule A — alive && !mac → ghost
 *     mDNS/SSDP active replies are exempt because they are not ICMP proxy ghosts.
 *     To receive an ICMP echo-reply the kernel MUST learn the
 *     responder's L2 MAC into its ARP cache. If after the ARP
 *     enrichment a pinged IP still has no MAC, the reply came from a
 *     different L2 endpoint (the router answering via proxy-ARP / ICMP
 *     proxy). There is no real host at that IP.
 *
 *   Rule B — alive && mac === gateway.mac && !isGateway → ghost
 *     Every NIC has a globally unique MAC. Sharing the gateway's MAC
 *     on a host that isn't the gateway means the router is answering
 *     ARP for that IP on behalf of nobody — classic proxy-ARP.
 *
 * Rule A applies to `isGateway` hosts too.
 *
 *   `isGateway` in the scan output is only a HEURISTIC based on the
 *   last IP octet (`.1` or `.254`). It is NOT authoritative. A real
 *   router ALWAYS has its MAC in the kernel ARP cache after a
 *   successful ping — there is no scenario where a legitimate gateway
 *   responds to ICMP but leaves ARP empty. So a MAC-less "gateway"
 *   candidate is the classic proxy-ARP phantom at `.254`: we must drop
 *   it, otherwise it leaks into the inventory as "Gateway NEW".
 *
 * The only truly unconditional exemption is `isLocal` — our own
 * machine may not be in our own ARP table, especially on loopback /
 * VPN / tun interfaces.
 *
 * MAC normalisation: we canonicalise to 12 lowercase hex chars before
 * comparing so `AA-BB-CC-DD-EE-FF` and `aa:bb:cc:dd:ee:ff` match. An
 * empty / invalid MAC is treated as "no MAC" for Rule A.
 */

function normMac(value) {
    if (typeof value !== 'string') return null
    const cleaned = value.toLowerCase().replace(/[^0-9a-f]/g, '')
    if (cleaned.length !== 12) return null
    if (cleaned === '000000000000' || cleaned === 'ffffffffffff') return null
    return cleaned
}

function hasMac(row) {
    if (row.macEmpty) return false
    return !!normMac(row.mac)
}

function hasActiveDiscoveryProof(row) {
    if (!row?.discoveryOnly && !row?.activeSource) return false
    return row.activeSource === 'mdns' || row.activeSource === 'ssdp'
}

function filterGhosts(results) {
    if (!Array.isArray(results) || results.length === 0) return results

    // Real gateway = marked by the heuristic AND has a resolvable MAC.
    // If the heuristic flags two candidates (`.1` and `.254`, common
    // when the router answers proxy-ARP at `.254`), the one with a
    // real MAC is authentic; the other is a phantom and will be
    // dropped by Rule A below.
    const gateway = results.find(r => r && r.alive && r.isGateway && hasMac(r))
    const gatewayMac = gateway ? normMac(gateway.mac) : null

    return results.filter(r => {
        if (!r) return false
        if (!r.alive) return true          // offline / seenOnly rows pass through
        if (r.isLocal) return true         // our own host is always real

        // Rule A applies even when `isGateway` is true — see module
        // header. Exception: mDNS/SSDP replies are active L2 multicast
        // discovery proofs, not proxy-ARP ICMP echoes.
        if (!hasMac(r)) return hasActiveDiscoveryProof(r)

        // Real gateway with MAC: keep regardless of Rule B.
        if (r.isGateway) return true

        // Rule B: shares the real gateway's MAC without being it.
        if (gatewayMac && normMac(r.mac) === gatewayMac) return false

        return true
    })
}

module.exports = {
    filterGhosts,
    // Exported for direct unit-testing and internal reuse only.
    _normMac: normMac,
    _hasMac: hasMac,
    _hasActiveDiscoveryProof: hasActiveDiscoveryProof,
}
