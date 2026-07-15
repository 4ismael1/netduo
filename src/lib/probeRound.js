export function buildProbeTargets(externalTargets, gateway, includeGateway) {
    const targets = Array.from(new Set((externalTargets || []).filter(Boolean)))
    if (includeGateway && gateway && !targets.includes(gateway)) targets.push(gateway)
    return targets
}

/**
 * Measure one coherent latency round. Every target is started before the
 * round waits for completion, and every result shares the same sample time.
 */
export async function measureProbeRound({
    externalTargets,
    gateway,
    includeGateway,
    ping,
    now = () => Date.now(),
}) {
    const targets = buildProbeTargets(externalTargets, gateway, includeGateway)
    const rows = await Promise.all(targets.map(async target => {
        try {
            const result = await ping(target)
            return [target, result?.time ?? null]
        } catch {
            return [target, null]
        }
    }))

    const values = Object.fromEntries(rows)
    const external = Object.fromEntries((externalTargets || []).map(target => [target, values[target] ?? null]))
    return {
        sampledAt: now(),
        external,
        gateway: includeGateway && gateway ? (values[gateway] ?? null) : null,
        gatewayMeasured: Boolean(includeGateway && gateway),
    }
}

export function probeStartsPerMinute(intervalMs, targetCount) {
    const safeInterval = Math.max(1000, Number(intervalMs) || 1000)
    const safeTargetCount = Math.max(0, Number(targetCount) || 0)
    return Math.ceil(60000 / safeInterval) * safeTargetCount
}
