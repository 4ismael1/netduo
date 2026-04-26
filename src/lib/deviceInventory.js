/**
 * Renderer-side utilities for combining a live LAN scan with the persistent
 * device inventory so the Scanner can show Online / Offline / New state.
 *
 * The main exports are:
 *   - stableKey(device)          — mirrors the DB key derivation
 *   - mergeScanWithInventory(...) — produce the unified device list
 */

import { stableKey as diffStableKey } from './deviceDiff'
import { cleanVendorName } from './vendorClassify'

/**
 * Re-export of the diff-side stable key so any consumer can call a single
 * function to identify "the same device" across scans.
 */
export const stableKey = diffStableKey

/**
 * The DB stores device_key in its scoped form `${networkId}::${baseKey}` so
 * the same MAC on two networks doesn't collide. Matching against a live
 * scan (which produces unscoped `mac:xxxx` keys via stableKey) requires
 * stripping that prefix first — otherwise every device shows up as two
 * rows: once "online" from the scan and once "offline" from the inventory.
 */
export function unscopeKey(key) {
    if (!key || typeof key !== 'string') return key
    const idx = key.indexOf('::')
    return idx >= 0 ? key.slice(idx + 2) : key
}

/**
 * Detect "locally-administered" / randomized MAC addresses (used by modern
 * phones, wearables and some IoT devices for privacy). The check looks at
 * the second nibble of the first octet: 2, 6, A or E indicate a locally-
 * administered address. Re-implemented here (instead of imported from
 * main.js) so the renderer can use it without an IPC round-trip.
 */
function isRandomizedMac(mac) {
    if (!mac || typeof mac !== 'string') return false
    const cleaned = mac.toLowerCase().replace(/[^0-9a-f]/g, '')
    if (cleaned.length !== 12) return false
    const secondNibble = cleaned[1]
    return secondNibble === '2' || secondNibble === '6' || secondNibble === 'a' || secondNibble === 'e'
}

function isEmptyMac(mac) {
    if (!mac) return true
    const cleaned = String(mac).toLowerCase().replace(/[^0-9a-f]/g, '')
    if (cleaned.length !== 12) return true
    return cleaned === '000000000000' || cleaned === 'ffffffffffff'
}

/**
 * Combine a live scan result with the persistent inventory list.
 *
 * @param {Array<object>} scanDevices    Devices returned by bridge.lanScan
 * @param {Array<object>} inventoryItems Rows returned by bridge.deviceInventoryList
 * @param {Set<string>|null} newKeySet   Optional set of device_keys that were
 *                                        reported as "new" by the merge IPC.
 *                                        Used to flag devices as 🆕.
 *
 * @returns {Array<object>} merged devices where each entry has:
 *   - every field from the scanned device (when online)
 *   - inventory-only fields (nickname, typeOverride, notes, firstSeen)
 *   - `presence`: 'online' | 'cached' | 'offline' | 'new'
 *   - `deviceKey`: stable identifier
 *   - `lastSeen`: epoch ms of most recent observation
 *   - `firstSeen`: epoch ms of first observation (if in inventory)
 *   - `inventoryId`: the deviceKey (convenience for UI callbacks)
 */
export function mergeScanWithInventory(scanDevices, inventoryItems, newKeySet = null) {
    const scanByKey = new Map()
    for (const device of scanDevices || []) {
        const k = stableKey(device)
        if (k) scanByKey.set(k, device)
    }

    const inventoryByKey = new Map()
    for (const item of inventoryItems || []) {
        if (!item?.deviceKey) continue
        // Scan-side keys are unscoped (`mac:xxxx`); inventory-side keys
        // are scoped (`networkId::mac:xxxx`). Strip to match.
        inventoryByKey.set(unscopeKey(item.deviceKey), item)
    }

    // newKeySet can contain either scoped (from DB merge result) or unscoped
    // (from diff logic) keys — normalise to unscoped so `.has()` matches the
    // unscoped key we derive from the scan device below.
    const newRaw = newKeySet instanceof Set
        ? Array.from(newKeySet)
        : (Array.isArray(newKeySet) ? newKeySet : [])
    const newSet = new Set(newRaw.map(unscopeKey))

    const merged = []
    const seenKeys = new Set()

    // Primary pass: iterate the live scan so active devices preserve their
    // freshly-discovered ordering (by IP).
    //
    // Neighbor-cache-only rows are visible but not online. That matters
    // because Windows can keep disconnected devices in Stale state long
    // after they stopped replying to probes.
    //
    //   • Pro: Wi-Fi sleepers (phones in power-save) don't get
    //     hidden when they miss a single ICMP — they're still in
    //     ARP cache because they were just there.
    //   • Con: a device that just disconnected may still be in ARP
    //     cache for a few minutes (Stale state), so we show it as cached.
    //
    // Active ICMP/mDNS/SSDP responders still render as online/new; cache-only
    // evidence renders as cached so the user sees the device without a false
    // Online claim.
    for (const [key, device] of scanByKey) {
        seenKeys.add(key)
        const inventory = inventoryByKey.get(key) || null
        const isNew = newSet.has(key)
        merged.push(buildEntry(device, inventory, presenceForScanDevice(device, isNew), isNew))
    }

    // Secondary pass: add inventory rows that weren't in the scan (offline
    // known devices). Preserve their descending last_seen order.
    for (const [key, inventory] of inventoryByKey) {
        if (seenKeys.has(key)) continue
        merged.push(buildEntry(null, inventory, 'offline', false))
    }

    return merged
}

function presenceForScanDevice(device, isNew) {
    if (device?.alive === true) return isNew ? 'new' : 'online'
    if (device?.presenceHint === 'cached') return 'cached'
    if (device?.seenOnly && device?.alive !== true) return 'cached'
    if (device?.alive === false) return 'cached'
    return isNew ? 'new' : 'online'
}

function buildEntry(scanDevice, inventory, presence, isNew = false) {
    const base = scanDevice || {}
    const inv = inventory || {}

    // Offline devices come from the inventory alone, so flags like isGateway
    // / isRandomized / macEmpty that the scan would normally set are absent.
    // Re-derive them so cards keep their proper icon, badge and label after
    // a remount (e.g. when the user navigates away and back to Scanner).
    const ip = base.ip || inv.ip || null
    const mac = base.mac || inv.mac || null
    const lastOctet = ip ? parseInt(String(ip).split('.').pop(), 10) : NaN
    const ipSuggestsGateway = lastOctet === 1 || lastOctet === 254
    const isGateway = base.isGateway === true || (scanDevice == null && ipSuggestsGateway)
    const isRandomized = base.isRandomized ?? isRandomizedMac(mac)
    const macEmpty = base.macEmpty ?? isEmptyMac(mac)

    // When the device is currently online, prefer its freshly-observed fields
    // (IP might have changed, hostname might have finally resolved). When
    // offline we fall back to whatever we had last time.
    return {
        // core identity
        deviceKey: inv.deviceKey || stableKey(base) || null,
        ip,
        mac,

        // presentation / classification
        hostname: base.hostname || inv.hostname || null,
        displayName: base.displayName || inv.hostname || inv.vendor || null,
        vendor: base.vendor || inv.vendor || null,
        deviceType: inv.typeOverride || base.deviceType || inv.type || 'Unknown',
        rawDeviceType: base.deviceType || inv.type || 'Unknown',

        // user-controlled metadata (from inventory)
        nickname: inv.nickname || null,
        typeOverride: inv.typeOverride || null,
        notes: inv.notes || null,

        // scan-time fields (null when offline)
        alive: presence === 'online' || presence === 'new',
        time: base.time ?? null,
        seenOnly: base.seenOnly ?? false,
        neighborState: base.neighborState || null,
        neighborSource: base.neighborSource || null,
        activeSource: base.activeSource || null,
        discoveryOnly: base.discoveryOnly === true,
        discoverySources: Array.isArray(base.discoverySources) ? base.discoverySources : [],
        modelName: base.modelName || null,
        modelDescription: base.modelDescription || null,
        modelNumber: base.modelNumber || null,
        serialNumber: base.serialNumber || null,
        presentationUrl: base.presentationUrl || null,
        ssdpDeviceType: base.ssdpDeviceType || null,
        ssdpUdn: base.ssdpUdn || null,
        serviceTypes: Array.isArray(base.serviceTypes) ? base.serviceTypes : [],
        ssdpServer: base.ssdpServer || null,
        isGateway,
        isLocal: base.isLocal === true,
        isRandomized,
        macEmpty,
        nameSource: base.nameSource || null,
        vendorSource: base.vendorSource || null,

        // lifetime bookkeeping
        firstSeen: inv.firstSeen || null,
        lastSeen: presence === 'offline' ? (inv.lastSeen || null) : Date.now(),

        presence,
        isNew: isNew || presence === 'new',
    }
}

/**
 * Returns the label the UI should show as a device's primary name.
 * Resolution order:
 *   nickname → hostname → displayName → cleaned vendor → deviceType
 *   → "Gateway" (when isGateway) → "Unknown Device"
 *
 * We trim noisy corporate suffixes off the vendor ("Foo Tech Co., Ltd.") so
 * the row title stays readable when the OUI description is verbose.
 */
export function primaryLabel(device) {
    const vendorLabel = trimVendorForLabel(device?.vendor)
    const typeLabel = device?.deviceType && device.deviceType !== 'Unknown'
        ? device.deviceType
        : null
    return (
        device?.nickname ||
        device?.hostname ||
        device?.displayName ||
        vendorLabel ||
        typeLabel ||
        (device?.isGateway ? 'Gateway' : 'Unknown Device')
    )
}

/**
 * Display-friendly vendor label: thin wrapper over vendorClassify's
 * cleanVendorName that also enforces a hard length cap for list row
 * titles. Returns null when the vendor string yields no useful text.
 */
function trimVendorForLabel(raw) {
    const cleaned = cleanVendorName(raw)
    if (!cleaned) return null
    if (cleaned.length > 28) return cleaned.slice(0, 26).trim() + '…'
    return cleaned
}

/**
 * Returns true if the device should be hidden by the "show offline" toggle
 * when that toggle is OFF. Keeps gateway and local device visible regardless.
 */
export function isHideableWhenOffline(device) {
    if (!device) return false
    if (device.presence !== 'offline') return false
    if (device.isGateway || device.isLocal) return false
    return true
}
