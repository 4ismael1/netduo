import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import bridge from './electronBridge'

/**
 * useNetworkStatus — centralized Context-based hook that tracks the live
 * WiFi / network state.  The provider lives in App.jsx so the state is
 * **never** torn down when navigating between pages — no more "Connecting…"
 * flash when returning to Dashboard.
 *
 * Returns:
 *   { wifi, interfaces, localIP, gateway, ifaceName, publicIP, geo, dns,
 *     sysInfo, connected, linkType, isWifi, isEthernet, isVpn, vpnStatus,
 *     loading, refresh }
 */

const NetworkStatusContext = createContext(null)

const WIFI_NAME_RE = /(wi-?fi|wlan|wireless|802\.11)/i
const ETHERNET_NAME_RE = /(ethernet|local area connection|lan|eth\d*|enp\d+|eno\d+|realtek|intel\(r\).*ethernet|gigabit)/i
const VPN_NAME_RE = /(vpn|openvpn|wireguard|wg\d+|wintun|nordlynx|tailscale|zerotier|hamachi|ppp|utun\d*|tun\d*|tap\d*|ikev2|l2tp|sstp|pptp)/i
const VIRTUAL_NAME_RE = /(virtual|vmware|vethernet|hyper-v|loopback|bluetooth|hamachi|zerotier|tailscale|wireguard|wintun|tun|tap)/i

function inferLinkType(iface = {}) {
    const name = String(iface?.name || '')
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

export function NetworkStatusProvider({ children }) {
    const [wifi, setWifi] = useState(null)
    const [interfaces, setInterfaces] = useState([])
    const [localIP, setLocalIP] = useState(null)
    const [gateway, setGateway] = useState(null)
    const [ifaceName, setIfaceName] = useState(null)
    const [publicIP, setPublicIP] = useState(null)
    const [geo, setGeo] = useState(null)
    const [dns, setDns] = useState([])
    const [sysInfo, setSysInfo] = useState(null)
    const [connected, setConnected] = useState(true)
    const [linkType, setLinkType] = useState('other')
    const [isVpn, setIsVpn] = useState(false)
    const [vpnStatus, setVpnStatus] = useState(null)
    const [loading, setLoading] = useState(true)
    const mountedRef = useRef(true)
    const wifiRef = useRef(null)
    const publicIPRef = useRef(null)
    const vpnStatusRef = useRef(null)

    useEffect(() => {
        wifiRef.current = wifi
    }, [wifi])

    useEffect(() => {
        publicIPRef.current = publicIP
    }, [publicIP])

    useEffect(() => {
        vpnStatusRef.current = vpnStatus
    }, [vpnStatus])

    const fetchAll = useCallback(async ({ skipWifi = false, skipGeo = false } = {}) => {
        try {
            const calls = [
                bridge.getNetworkInterfaces(),
                skipWifi ? Promise.resolve(undefined) : bridge.getWifiInfo(),
                bridge.getDnsServers(),
                bridge.getSystemInfo(),
                bridge.getVpnStatus ? bridge.getVpnStatus() : Promise.resolve(null),
            ]
            const [ifaces, w, d, sys, vpn] = await Promise.allSettled(calls)

            if (!mountedRef.current) return

            const nextVpnStatus = (vpn.status === 'fulfilled' && vpn.value)
                ? vpn.value
                : vpnStatusRef.current

            if (nextVpnStatus !== vpnStatusRef.current) {
                setVpnStatus(nextVpnStatus || null)
            }

            if (ifaces.status === 'fulfilled') {
                const list = ifaces.value || []
                setInterfaces(list)

                const nextWifi = (!skipWifi && w.status === 'fulfilled' && w.value !== undefined)
                    ? w.value
                    : wifiRef.current
                const wifiConnected = Boolean(nextWifi?.ssid)
                const primary = pickPrimaryInterface(list, wifiConnected)
                const hasVpnInterface = list.some(item =>
                    item?.family === 'IPv4' &&
                    !item?.internal &&
                    VPN_NAME_RE.test(`${String(item?.name || '')} ${String(item?.interfaceDescription || '')}`),
                )
                const vpnActiveFromProbe = Boolean(nextVpnStatus?.active)

                if (primary) {
                    const detectedType = inferLinkType(primary)
                    const vpnActive = vpnActiveFromProbe || hasVpnInterface || detectedType === 'vpn'
                    setLocalIP(primary.address)
                    setIfaceName(primary.name)
                    setConnected(true)
                    setLinkType(detectedType)
                    setIsVpn(vpnActive)
                    if (vpnActive || detectedType === 'vpn') {
                        setGateway(null)
                    } else {
                        const parts = primary.address.split('.')
                        parts[3] = '1'
                        setGateway(parts.join('.'))
                    }
                } else if (vpnActiveFromProbe) {
                    setLocalIP(nextVpnStatus?.tunnel?.localIp || null)
                    setIfaceName(nextVpnStatus?.tunnel?.interfaceName || null)
                    setGateway(null)
                    setConnected(true)
                    setLinkType('vpn')
                    setIsVpn(true)
                } else {
                    setLocalIP(null)
                    setIfaceName(null)
                    setGateway(null)
                    setConnected(false)
                    setLinkType('other')
                    setIsVpn(false)
                }
            }
            if (!skipWifi && w.status === 'fulfilled' && w.value !== undefined) {
                setWifi(w.value)
            }
            if (d.status === 'fulfilled') setDns(d.value || [])
            if (sys.status === 'fulfilled') setSysInfo(sys.value)

            // Public IP + geo (slightly slower)
            if (!skipGeo) {
                try {
                    const pip = await bridge.getPublicIP()
                    if (!mountedRef.current) return
                    setPublicIP(pip)
                    if (pip && pip !== 'Unavailable') {
                        const g = await bridge.getIPGeo(pip)
                        if (mountedRef.current) setGeo(g)
                    }
                } catch { /* ok */ }
            } else if (!publicIPRef.current) {
                try {
                    const pip = await bridge.getPublicIP()
                    if (!mountedRef.current) return
                    setPublicIP(pip)
                } catch { /* ok */ }
            }
        } catch { /* silent */ }
        finally { if (mountedRef.current) setLoading(false) }
    }, [])

    useEffect(() => {
        mountedRef.current = true
        fetchAll({ skipWifi: false, skipGeo: false })

        // Listen for network changes from Electron
        const offChanged = bridge.onNetworkChanged(() => {
            if (!mountedRef.current) return
            fetchAll({ skipWifi: false, skipGeo: true })
        })

        const offSignal = bridge.onNetworkSignal((data) => {
            if (!mountedRef.current) return
            setWifi(prev => prev ? { ...prev, signal: data.signal } : prev)
        })

        // Keep Ethernet/Wi-Fi status fresh even if no WLAN event is emitted.
        const fastPoll = setInterval(() => {
            fetchAll({ skipWifi: true, skipGeo: true })
        }, 5000)

        // Refresh public internet identity periodically.
        const slowPoll = setInterval(() => {
            fetchAll({ skipWifi: false, skipGeo: false })
        }, 60000)

        const onOnline = () => fetchAll({ skipWifi: false, skipGeo: true })
        const onOffline = () => fetchAll({ skipWifi: false, skipGeo: true })
        window.addEventListener('online', onOnline)
        window.addEventListener('offline', onOffline)

        return () => {
            mountedRef.current = false
            if (typeof offChanged === 'function') offChanged()
            if (typeof offSignal === 'function') offSignal()
            bridge.offNetworkEvents?.()
            clearInterval(fastPoll)
            clearInterval(slowPoll)
            window.removeEventListener('online', onOnline)
            window.removeEventListener('offline', onOffline)
        }
    }, [fetchAll])

    const value = {
        wifi, interfaces, localIP, gateway, ifaceName,
        publicIP, geo, dns, sysInfo,
        connected,
        linkType,
        isWifi: linkType === 'wifi',
        isEthernet: linkType === 'ethernet',
        isVpn,
        vpnStatus,
        loading,
        refresh: () => fetchAll({ skipWifi: false, skipGeo: false }),
    }

    return (
        <NetworkStatusContext.Provider value={value}>
            {children}
        </NetworkStatusContext.Provider>
    )
}

export default function useNetworkStatus() {
    const ctx = useContext(NetworkStatusContext)
    if (!ctx) throw new Error('useNetworkStatus must be used inside <NetworkStatusProvider>')
    return ctx
}
