function isActiveVpnCandidate(candidate = {}) {
    const linkConnected = candidate.adapterUp === true || candidate.ifaceConnected === true
    const hasAddress = candidate.hasAddress === true
        || (Array.isArray(candidate.localIps) && candidate.localIps.length > 0)
    const hasRoute = candidate.hasRoute === true
        || candidate.defaultRoute === true
        || Number(candidate.routeCount || 0) > 0
    return linkConnected && hasAddress && hasRoute
}

module.exports = { isActiveVpnCandidate }
