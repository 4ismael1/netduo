/**
 * DevTools seed: inject a single LAN Check history entry with 300
 * devices so the History + Report views can be stress-tested against
 * the new pagination and layout changes.
 *
 * HOW TO USE
 *   1. Launch NetDuo (`npm run dev` or an installed build).
 *   2. Open DevTools: Ctrl+Shift+I (or View → Toggle DevTools).
 *   3. Switch to the Console tab.
 *   4. Copy the ENTIRE contents of this file and paste into the Console.
 *   5. Press Enter.
 *   6. Navigate to LAN Check → History — the new entry appears at top.
 *   7. Click it to open the report; scroll to "Asset Snapshot" and check
 *      the pagination (15 per page, 20 pages total).
 *
 * REMOVING THE SEED
 *   Open LAN Check → History and click the trash icon on the seed row,
 *   or click "Clear All" to wipe history.
 *
 * This file is NOT imported anywhere — it's a standalone, dev-only
 * utility. Not shipped to production.
 */
(async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.lanCheckHistoryAdd) {
        console.error('[seed-lancheck] electronAPI not available. Open this in NetDuo DevTools, not a browser.')
        return
    }

    const BASE_IP = '192.168.100'
    const TOTAL_DEVICES = 300

    // Vendor + hostname pools to produce varied, realistic-looking rows.
    const vendorPool = [
        'Tenda Technology Co.,Ltd', 'TP-Link Corporation Limited', 'Raspberry Pi Foundation',
        'Intel Corporate', 'Apple, Inc.', 'Samsung Electronics Co.,Ltd', 'Google, Inc.',
        'Xiaomi Communications Co Ltd', 'Amazon Technologies Inc.', 'Sonos, Inc.',
        'Philips Lighting BV', 'Espressif Inc.', 'Tuya Smart Inc.', 'Netgear',
        'Ubiquiti Networks Inc.', 'Cisco Systems, Inc', 'Hewlett Packard', 'Dell Inc.',
        'Lenovo', 'Nintendo Co., Ltd.', 'Sony Corporation', 'LG Electronics',
        'Microsoft Corporation', 'Roku, Inc.', 'Nest Labs Inc.',
    ]
    const hostnamePool = [
        'living-tv', 'bedroom-hue', 'kitchen-echo', 'office-desktop',
        'laptop-work', 'thermostat', 'robot-vacuum', 'baby-cam',
        'nas-storage', 'printer-hp', 'doorbell', 'outlet-01', 'outlet-02',
        'soundbar', 'chromecast', 'fire-tv', 'raspi-dev', 'home-server',
        'iphone-ismael', 'android-backup', null, null, null, // some devices with no hostname
    ]

    function randomMac(randomized = false) {
        const bytes = []
        for (let i = 0; i < 6; i++) bytes.push(Math.floor(Math.random() * 256))
        if (randomized) {
            // Locally-administered + unicast: set bit 1 of first octet.
            bytes[0] = (bytes[0] & 0xfc) | 0x02
        } else {
            // Global + unicast: clear bits 0 and 1.
            bytes[0] = bytes[0] & 0xfc
        }
        return bytes.map(b => b.toString(16).padStart(2, '0')).join(':')
    }

    const devices = []
    for (let i = 1; i <= TOTAL_DEVICES; i++) {
        // Spread across .1–.254 then wrap to simulate a multi-subnet or
        // just-weird network that reports more hosts than a /24.
        const octet = 1 + ((i - 1) % 254)
        const isGateway = i === 1
        const isLocal = i === 2
        const randomized = Math.random() < 0.12
        const hasHostname = Math.random() < 0.55
        const hasVendor = Math.random() < 0.8

        devices.push({
            ip: `${BASE_IP}.${octet}`,
            mac: randomMac(randomized),
            hostname: hasHostname ? (hostnamePool[Math.floor(Math.random() * hostnamePool.length)] || null) : null,
            vendor: hasVendor ? vendorPool[Math.floor(Math.random() * vendorPool.length)] : null,
            isGateway,
            isLocal,
            isRandomized: randomized,
            macEmpty: false,
            displayName: null,
            alive: Math.random() < 0.82,
        })
    }

    const findings = [
        {
            id: 'lan-smb-surface',
            severity: 'medium',
            title: 'SMB file-sharing surface detected',
            description: 'Found 6 SMB-related confirmed-open entries (tcp/139 or tcp/445).',
            recommendation: 'Limit SMB to trusted hosts, disable legacy SMB and enforce credential hardening.',
            category: 'lateral-movement',
        },
        {
            id: 'lan-snmp-udp',
            severity: 'medium',
            title: 'SNMP exposed over UDP',
            description: 'Detected 2 SNMP responder(s) on udp/161.',
            recommendation: 'Restrict SNMP to admin hosts, use ACLs, and enforce strong communities or SNMPv3.',
            category: 'management-plane',
        },
        {
            id: 'lan-unknown-assets',
            severity: 'low',
            title: 'Multiple unidentified assets',
            description: '42 hosts have weak inventory fingerprinting.',
            recommendation: 'Tag unknown devices and move non-trusted assets to guest/IoT segments.',
            category: 'asset-inventory',
        },
    ]

    const openPorts = []
    const commonPorts = [22, 53, 80, 139, 443, 445, 554, 631, 1883, 3000, 3389, 5000, 5353, 8080, 8443, 9000]
    for (let k = 0; k < 38; k++) {
        const host = devices[Math.floor(Math.random() * Math.min(50, devices.length))]
        openPorts.push({
            ip: host.ip,
            port: commonPorts[Math.floor(Math.random() * commonPorts.length)],
            protocol: Math.random() < 0.85 ? 'tcp' : 'udp',
            service: null,
            banner: null,
        })
    }

    const nowIso = new Date().toISOString()
    const report = {
        generatedAt: nowIso,
        profile: 'standard',
        range: `${BASE_IP}.1-${BASE_IP}.254`,
        summary: {
            riskScore: 58,
            riskBand: 'Moderate',
            devicesTotal: devices.length,
            targetsScanned: Math.min(devices.length, 120),
            findingsBySeverity: { high: 0, medium: 2, low: 1, info: 0 },
            elapsedMs: 187_000,
        },
        devices,
        findings,
        openPorts,
        upnp: { count: 0, entries: [] },
    }

    try {
        await window.electronAPI.lanCheckHistoryAdd({ report })
        console.log(`[seed-lancheck] Inserted 1 report with ${devices.length} devices, ${openPorts.length} open ports, ${findings.length} findings.`)
        console.log('[seed-lancheck] Navigate to LAN Check → History to see it.')
    } catch (err) {
        console.error('[seed-lancheck] Failed to insert:', err)
    }
})()
