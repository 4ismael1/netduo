export function canProbeGateway(network = {}) {
    return Boolean(network.connected && network.gateway && !network.isVpn)
}
