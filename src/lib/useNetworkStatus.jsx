import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from 'react'
import bridge from './electronBridge'
import { logBridgeWarning } from './devLog.js'
import useAppVisibility from './useAppVisibility.js'

const NetworkStatusContext = createContext(null)

const WIFI_NAME_RE = /(wi-?fi|wlan|wireless|802\.11)/i
const ETHERNET_NAME_RE = /(ethernet|local area connection|lan|eth\d*|enp\d+|eno\d+|realtek|intel\(r\).*ethernet|gigabit)/i
const VPN_NAME_RE = /(vpn|openvpn|wireguard|wg\d+|wintun|nordlynx|tailscale|zerotier|hamachi|ppp|utun\d*|tun\d*|tap\d*|ikev2|l2tp|sstp|pptp)/i
const VIRTUAL_NAME_RE = /(virtual|vmware|vethernet|hyper-v|loopback|bluetooth|hamachi|zerotier|tailscale|wireguard|wintun|tun|tap)/i
const PUBLIC_IDENTITY_REFRESH_MS = 5 * 60 * 1000
export const MINIMUM_INITIAL_SKELETON_MS = 500
const TERMINAL_ENRICHMENT_STATES = new Set(['ready', 'partial', 'error'])

const INITIAL_NETWORK_STATE = {
    wifi: null,
    interfaces: [],
    localIP: null,
    gateway: null,
    ifaceName: null,
    publicIP: null,
    geo: null,
    dns: [],
    sysInfo: null,
    connected: false,
    linkType: 'other',
    isVpn: false,
    vpnStatus: null,
    networkContext: null,
    networkContexts: [],
    underlay: null,
    underlayGateway: null,
    overlay: { type: 'vpn', active: false, tunnel: null, authoritative: false },
    networkEpoch: 0,
    underlayIdentityKey: null,
    transitioning: false,
    presentationStale: false,
    transitionStatus: 'idle',
    enrichmentStatus: 'pending',
}

function inferLinkType(iface = {}) {
    const name = String(iface?.name || iface?.interfaceName || '')
    const desc = String(iface?.interfaceDescription || '')
    const probe = `${name} ${desc}`.trim()
    if (VPN_NAME_RE.test(probe)) return 'vpn'
    if (WIFI_NAME_RE.test(probe)) return 'wifi'
    if (ETHERNET_NAME_RE.test(probe)) return 'ethernet'
    return 'other'
}

function scoreInterface(iface, wifiConnected) {
    const name = String(iface?.name || '')
    const desc = String(iface?.interfaceDescription || '')
    const type = inferLinkType(iface)
    let score = 0
    if (!VIRTUAL_NAME_RE.test(name)) score += 40
    if (desc && !VIRTUAL_NAME_RE.test(desc)) score += 10
    if (type === 'vpn') score -= 30
    if (type === 'ethernet') score += 20
    if (type === 'wifi') score += wifiConnected ? 30 : 10
    return score
}

function pickPrimaryInterface(list, wifiConnected) {
    const ipv4External = (list || []).filter(item => item.family === 'IPv4' && !item.internal)
    if (!ipv4External.length) return null
    return ipv4External
        .map(item => ({ item, score: scoreInterface(item, wifiConnected) }))
        .sort((a, b) => b.score - a.score)[0]?.item || null
}

function snapshotEpoch(snapshot) {
    const value = Number(snapshot?.networkEpoch ?? snapshot?.generation ?? 0)
    return Number.isInteger(value) && value >= 0 ? value : 0
}

export function deriveNetworkPresentation(snapshot) {
    const list = Array.isArray(snapshot?.interfaces) ? snapshot.interfaces : []
    const explicitUnderlay = snapshot?.underlay && typeof snapshot.underlay === 'object'
        ? snapshot.underlay
        : null
    const candidateWifi = explicitUnderlay
        ? explicitUnderlay.wifi
        : snapshot?.wifi
    const nextWifi = candidateWifi?.connected === false ? null : (candidateWifi || null)
    const wifiConnected = Boolean(nextWifi?.ssid || nextWifi?.connected)
    const context = explicitUnderlay?.context || snapshot?.networkContext || null
    const primary = context?.address
        ? (list.find(item => item?.family === 'IPv4' && item?.address === context.address) || pickPrimaryInterface(list, wifiConnected))
        : pickPrimaryInterface(list, wifiConnected)

    const status = snapshot?.overlay?.status || snapshot?.vpnStatus || null
    const overlayDeclared = snapshot?.overlay && typeof snapshot.overlay === 'object'
    const vpnActive = overlayDeclared ? snapshot.overlay.active === true : status?.active === true
    const tunnel = vpnActive
        ? (overlayDeclared ? (snapshot.overlay.tunnel || null) : (status?.tunnel || null))
        : null
    const overlay = {
        type: 'vpn',
        active: vpnActive,
        tunnel,
        authoritative: overlayDeclared ? snapshot.overlay.authoritative !== false : Boolean(status),
        status: status ? { ...status, active: vpnActive, tunnel } : null,
    }

    let linkType = explicitUnderlay?.type || (nextWifi ? 'wifi' : inferLinkType(primary || context || {}))
    if (linkType === 'vpn') linkType = nextWifi ? 'wifi' : 'other'
    const underlay = explicitUnderlay || (primary || context || nextWifi ? {
        type: linkType,
        connected: true,
        interfaceName: context?.interfaceName || primary?.name || null,
        interfaceDescription: context?.interfaceDescription || primary?.interfaceDescription || null,
        localIp: context?.address || primary?.address || null,
        gateway: context?.gateway || null,
        context,
        wifi: nextWifi,
    } : null)

    const physicalLocalIp = underlay?.localIp || context?.address || primary?.address || null
    const physicalInterface = underlay?.interfaceName || context?.interfaceName || primary?.name || null
    const connected = Boolean(underlay?.connected || physicalLocalIp || vpnActive || snapshot?.linkState === 'connected')

    return {
        wifi: nextWifi,
        interfaces: list,
        localIP: physicalLocalIp || (vpnActive ? tunnel?.localIp || null : null),
        gateway: vpnActive ? null : (underlay?.gateway || context?.gateway || null),
        ifaceName: physicalInterface || (vpnActive ? tunnel?.interfaceName || null : null),
        dns: Array.isArray(snapshot?.dns) ? snapshot.dns : [],
        sysInfo: snapshot?.sysInfo || null,
        connected,
        linkType,
        isVpn: vpnActive,
        vpnStatus: overlay.status,
        networkContext: underlay?.context || context,
        networkContexts: Array.isArray(snapshot?.networkContexts) ? snapshot.networkContexts : [],
        underlay,
        underlayGateway: underlay?.gateway || null,
        overlay,
        networkEpoch: snapshotEpoch(snapshot),
        underlayIdentityKey: snapshot?.underlayIdentityKey || null,
        transitioning: snapshot?.transitioning === true,
        presentationStale: snapshot?.presentationStale === true,
        transitionStatus: snapshot?.transitionStatus || 'idle',
        enrichmentStatus: snapshot?.enrichmentStatus || 'pending',
    }
}

function validPublicIp(value) {
    return Boolean(value && value !== 'Unavailable' && value !== 'Unknown')
}

function validGeo(value) {
    return Boolean(value && typeof value === 'object' && (
        value.country
        || value.countryCode
        || value.city
        || value.isp
        || Number.isFinite(value.lat)
        || Number.isFinite(value.lon)
    ))
}

export function NetworkStatusProvider({ children, minimumSkeletonMs = MINIMUM_INITIAL_SKELETON_MS }) {
    const appVisible = useAppVisibility()
    const [network, setNetwork] = useState(INITIAL_NETWORK_STATE)
    const [loading, setLoading] = useState(true)
    const [onlineNetworkInfo, setOnlineNetworkInfo] = useState(true)
    const mountedRef = useRef(true)
    const activeEpochRef = useRef(-1)
    const appliedRevisionRef = useRef(-1)
    const identityRef = useRef({ epoch: -1, publicIP: null, geo: null })
    // Privacy-sensitive enrichment stays off until the persisted preference
    // has been read; public IP itself remains a core diagnostic value.
    const onlineNetworkInfoRef = useRef(false)
    const identityInFlightRef = useRef(null)
    const queuedIdentityRef = useRef(null)
    const bootStartedAtRef = useRef(Date.now())
    const revealTimerRef = useRef(null)
    const appVisibleRef = useRef(appVisible)
    const presentationRef = useRef({ snapshotEpoch: null, identityEpoch: null, revealed: false })

    useEffect(() => {
        appVisibleRef.current = appVisible
    }, [appVisible])

    const revealWhenCoherent = useCallback(() => {
        const presentation = presentationRef.current
        if (
            presentation.revealed
            || presentation.snapshotEpoch == null
            || presentation.identityEpoch !== presentation.snapshotEpoch
        ) return
        if (revealTimerRef.current) return

        const minimumMs = Math.max(0, Number(minimumSkeletonMs) || 0)
        const remainingMs = Math.max(0, minimumMs - (Date.now() - bootStartedAtRef.current))
        const reveal = () => {
            revealTimerRef.current = null
            if (!mountedRef.current || presentationRef.current.revealed) return
            presentationRef.current.revealed = true
            setLoading(false)
        }
        if (remainingMs === 0) reveal()
        else revealTimerRef.current = setTimeout(reveal, remainingMs)
    }, [minimumSkeletonMs])

    const markIdentitySettled = useCallback(epoch => {
        if (!mountedRef.current || epoch !== activeEpochRef.current) return
        presentationRef.current.identityEpoch = epoch
        revealWhenCoherent()
    }, [revealWhenCoherent])

    const queueIdentityRequest = useCallback(options => {
        const current = queuedIdentityRef.current
        if (!current || current.epoch !== options.epoch) {
            queuedIdentityRef.current = { ...options }
        } else {
            current.includeGeo = current.includeGeo || options.includeGeo
            current.refreshPublicIp = current.refreshPublicIp || options.refreshPublicIp
        }
    }, [])

    const fetchInternetIdentity = useCallback((options = {}) => {
        function dispatchIdentityRequest({
            epoch = activeEpochRef.current,
            includeGeo = false,
            refreshPublicIp = false,
        } = {}) {
            if (!Number.isInteger(epoch) || epoch < 0 || epoch !== activeEpochRef.current) return Promise.resolve()
            const inFlight = identityInFlightRef.current
            if (inFlight) {
                if (inFlight.epoch !== epoch) {
                    queueIdentityRequest({ epoch, includeGeo, refreshPublicIp: true })
                } else {
                    if (refreshPublicIp && inFlight.publicDecisionMade) {
                        queueIdentityRequest({ epoch, includeGeo, refreshPublicIp: true })
                    } else {
                        inFlight.refreshPublicIp = inFlight.refreshPublicIp || refreshPublicIp
                    }
                    if (includeGeo && inFlight.geoDecisionMade) {
                        queueIdentityRequest({ epoch, includeGeo: true, refreshPublicIp: false })
                    } else {
                        inFlight.includeGeo = inFlight.includeGeo || includeGeo
                    }
                }
                return inFlight.promise
            }

            const request = {
                epoch,
                includeGeo,
                refreshPublicIp,
                publicDecisionMade: false,
                geoDecisionMade: false,
                promise: null,
            }
            const pending = Promise.resolve().then(async () => {
                let identity = identityRef.current.epoch === epoch
                    ? identityRef.current
                    : { epoch, publicIP: null, geo: null }
                let pip = identity.publicIP
                request.publicDecisionMade = true
                if (request.refreshPublicIp || !validPublicIp(pip)) {
                    try {
                        const nextPublicIp = await bridge.getPublicIP()
                        if (!mountedRef.current || activeEpochRef.current !== epoch) return
                        const publicIpChanged = nextPublicIp !== identity.publicIP
                        pip = nextPublicIp
                        identity = { epoch, publicIP: pip, geo: publicIpChanged ? null : identity.geo }
                        identityRef.current = identity
                        setNetwork(previous => previous.networkEpoch === epoch
                            ? { ...previous, publicIP: pip, geo: identity.geo }
                            : previous)
                    } catch { /* an unavailable provider is a settled diagnostic result */ }
                }

                request.geoDecisionMade = true
                if (
                    onlineNetworkInfoRef.current
                    && request.includeGeo
                    && validPublicIp(pip)
                    && !validGeo(identity.geo)
                    && mountedRef.current
                    && activeEpochRef.current === epoch
                ) {
                    try {
                        const nextGeo = await bridge.getIPGeo(pip)
                        if (!mountedRef.current || activeEpochRef.current !== epoch || identityRef.current.publicIP !== pip) return
                        identityRef.current = { epoch, publicIP: pip, geo: nextGeo }
                        setNetwork(previous => previous.networkEpoch === epoch
                            ? { ...previous, publicIP: pip, geo: nextGeo }
                            : previous)
                    } catch { /* preserve the public identity for this epoch */ }
                }
                markIdentitySettled(epoch)
            }).finally(() => {
                if (identityInFlightRef.current === request) identityInFlightRef.current = null
                const queued = queuedIdentityRef.current
                if (queued && mountedRef.current) {
                    queuedIdentityRef.current = null
                    dispatchIdentityRequest(queued)
                }
            })
            request.promise = pending
            identityInFlightRef.current = request
            return pending
        }

        return dispatchIdentityRequest(options)
    }, [markIdentitySettled, queueIdentityRequest])

    const applySnapshot = useCallback(snapshot => {
        if (!mountedRef.current || !snapshot) return { applied: false }
        const epoch = snapshotEpoch(snapshot)
        const revision = Number(snapshot.revision ?? 0)
        if (epoch < activeEpochRef.current) return { applied: false, stale: true }
        if (epoch === activeEpochRef.current && Number.isFinite(revision) && revision < appliedRevisionRef.current) {
            return { applied: false, stale: true }
        }

        const previousEpoch = activeEpochRef.current
        const epochChanged = previousEpoch >= 0 && epoch !== previousEpoch
        const presentation = deriveNetworkPresentation(snapshot)
        activeEpochRef.current = epoch
        appliedRevisionRef.current = Number.isFinite(revision) ? revision : appliedRevisionRef.current

        if (epochChanged) {
            identityRef.current = { epoch, publicIP: null, geo: null }
            presentationRef.current.identityEpoch = presentation.connected ? null : epoch
        }
        setNetwork(previous => ({
            ...presentation,
            publicIP: epochChanged ? null : previous.publicIP,
            geo: epochChanged ? null : previous.geo,
        }))

        const terminal = snapshot.coreStatus !== 'pending'
            && TERMINAL_ENRICHMENT_STATES.has(snapshot.enrichmentStatus)
            && snapshot.transitioning !== true
        if (terminal) {
            presentationRef.current.snapshotEpoch = epoch
            if (!presentation.connected) markIdentitySettled(epoch)
            revealWhenCoherent()
        }
        return { applied: true, epoch, epochChanged, terminal, connected: presentation.connected }
    }, [markIdentitySettled, revealWhenCoherent])

    useEffect(() => {
        mountedRef.current = true
        bridge.getNetworkSnapshot().then(snapshot => {
            const applied = applySnapshot(snapshot)
            if (!applied.applied) return
            if (applied.connected) {
                fetchInternetIdentity({ epoch: applied.epoch, includeGeo: onlineNetworkInfoRef.current })
            } else {
                markIdentitySettled(applied.epoch)
            }
        }).catch(error => {
            logBridgeWarning('network-status:initial-snapshot', error)
            if (!mountedRef.current) return
            const epoch = Math.max(0, activeEpochRef.current)
            presentationRef.current.snapshotEpoch = epoch
            markIdentitySettled(epoch)
        })

        bridge.configGetPublic(['onlineNetworkInfo']).then(cfg => {
            if (!mountedRef.current) return
            const enabled = cfg?.onlineNetworkInfo !== false
            onlineNetworkInfoRef.current = enabled
            setOnlineNetworkInfo(enabled)
            if (enabled && activeEpochRef.current >= 0) {
                fetchInternetIdentity({ epoch: activeEpochRef.current, includeGeo: true })
            }
        }).catch(error => logBridgeWarning('network-status:config-load', error))

        const offSnapshot = bridge.onNetworkSnapshot(snapshot => {
            const applied = applySnapshot(snapshot)
            if (!applied.applied || !applied.terminal || !applied.epochChanged) return
            if (applied.connected) {
                fetchInternetIdentity({
                    epoch: applied.epoch,
                    includeGeo: onlineNetworkInfoRef.current,
                    refreshPublicIp: true,
                })
            } else {
                markIdentitySettled(applied.epoch)
            }
        })
        const offConfigChanged = bridge.onConfigChanged?.(({ key, value, deleted }) => {
            if (!mountedRef.current || key !== 'onlineNetworkInfo') return
            const enabled = deleted || value === true
            onlineNetworkInfoRef.current = enabled
            setOnlineNetworkInfo(enabled)
            if (enabled && activeEpochRef.current >= 0) {
                fetchInternetIdentity({ epoch: activeEpochRef.current, includeGeo: true })
            } else if (!enabled) {
                identityRef.current = { ...identityRef.current, geo: null }
                setNetwork(previous => ({ ...previous, geo: null }))
            }
        })

        const identityPoll = setInterval(() => {
            if (activeEpochRef.current < 0 || !appVisibleRef.current) return
            fetchInternetIdentity({
                epoch: activeEpochRef.current,
                includeGeo: onlineNetworkInfoRef.current,
                refreshPublicIp: true,
            })
        }, PUBLIC_IDENTITY_REFRESH_MS)

        const refreshSnapshot = () => {
            bridge.refreshNetworkSnapshot().then(snapshot => {
                const applied = applySnapshot(snapshot)
                if (applied.applied && applied.connected) {
                    fetchInternetIdentity({ epoch: applied.epoch, includeGeo: false, refreshPublicIp: true })
                }
            }).catch(() => {})
        }
        window.addEventListener('online', refreshSnapshot)
        window.addEventListener('offline', refreshSnapshot)

        return () => {
            mountedRef.current = false
            if (typeof offSnapshot === 'function') offSnapshot()
            if (typeof offConfigChanged === 'function') offConfigChanged()
            clearInterval(identityPoll)
            if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
            revealTimerRef.current = null
            window.removeEventListener('online', refreshSnapshot)
            window.removeEventListener('offline', refreshSnapshot)
        }
    }, [applySnapshot, fetchInternetIdentity, markIdentitySettled])

    const refresh = useCallback(() => {
        bridge.refreshNetworkSnapshot().then(snapshot => {
            const applied = applySnapshot(snapshot)
            if (applied.applied && applied.connected) {
                fetchInternetIdentity({
                    epoch: applied.epoch,
                    includeGeo: onlineNetworkInfoRef.current,
                    refreshPublicIp: true,
                })
            }
        }).catch(() => {})
    }, [applySnapshot, fetchInternetIdentity])

    const value = useMemo(() => ({
        ...network,
        isWifi: network.linkType === 'wifi',
        isEthernet: network.linkType === 'ethernet',
        onlineNetworkInfo,
        loading,
        refresh,
    }), [loading, network, onlineNetworkInfo, refresh])

    return <NetworkStatusContext.Provider value={value}>{children}</NetworkStatusContext.Provider>
}

export default function useNetworkStatus() {
    const ctx = useContext(NetworkStatusContext)
    if (!ctx) throw new Error('useNetworkStatus must be used inside <NetworkStatusProvider>')
    return ctx
}
