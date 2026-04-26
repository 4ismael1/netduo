/**
 * Vendor classification helpers — pure string logic, no React / lucide
 * imports. Used by both the Scanner page (to pick the right DEV_TYPES
 * profile) and the inventory / primary-label helpers (to produce clean
 * display labels). Keeping this file JSX-free means it can be unit-tested
 * in Node and consumed from any module without pulling icons into memory.
 */

/**
 * Ordered patterns mapping raw OUI descriptions (and some vendor-like
 * hostnames) to a canonical DEV_TYPES key. Order matters: more specific
 * patterns must appear before more general ones (Apple before Intel,
 * Samsung before general MediaTek, etc.). All regexes are case-insensitive.
 */
export const VENDOR_PATTERNS = [
    // Phones / mobile
    { rx: /\bapple\b/i,        key: 'Apple' },
    { rx: /\bsamsung\b/i,      key: 'Samsung' },
    { rx: /\bxiaomi\b/i,       key: 'Xiaomi' },
    { rx: /\boppo\b/i,         key: 'OPPO' },
    { rx: /\boneplus\b/i,      key: 'OnePlus' },
    { rx: /\bvivo\b/i,         key: 'Vivo' },
    { rx: /\bhuawei\b/i,       key: 'Huawei' },
    { rx: /\bhonor\b/i,        key: 'Honor' },
    { rx: /\bnokia\b/i,        key: 'Nokia' },
    { rx: /\bmotorola\b/i,     key: 'Motorola' },
    { rx: /\bgoogle\b/i,       key: 'Google' },
    // Consumer routers / mesh / ISP CPEs
    { rx: /\bkasa\b|\btapo\b/i, key: 'TP-Link Kasa' },
    { rx: /\btp-?link\b/i,     key: 'TP-Link' },
    { rx: /\btenda\b/i,        key: 'Tenda' },
    { rx: /\bnetgear\b/i,      key: 'Netgear' },
    { rx: /\bd-?link\b/i,      key: 'D-Link' },
    { rx: /\blinksys\b/i,      key: 'Linksys' },
    { rx: /\beero\b/i,         key: 'Linksys' },
    { rx: /\barris\b|\bcommscope\b/i, key: 'Technicolor' },
    { rx: /\bubee\b/i,         key: 'Technicolor' },
    { rx: /\bpace\b.*\b(micro|uk)\b|\bzyxel\b/i, key: 'ZTE' },
    { rx: /\bactiontec\b/i,    key: 'Technicolor' },
    { rx: /\btechnicolor\b/i,  key: 'Technicolor' },
    { rx: /\bmikrotik\b/i,     key: 'MikroTik' },
    { rx: /\bcisco\b/i,        key: 'Cisco' },
    { rx: /\bubiquiti\b/i,     key: 'Ubiquiti' },
    { rx: /\baruba\b/i,        key: 'Aruba' },
    { rx: /\bjuniper\b/i,      key: 'Juniper' },
    { rx: /\bfortinet\b/i,     key: 'Fortinet' },
    { rx: /\bsonicwall\b/i,    key: 'SonicWall' },
    { rx: /\bbelkin\b/i,       key: 'Belkin' },
    { rx: /\bzte\b/i,          key: 'ZTE' },
    // Printers
    { rx: /hewlett[- ]?packard|\bhp\b/i, key: 'HP' },
    { rx: /\bcanon\b/i,        key: 'Canon' },
    { rx: /\bepson\b|\bseiko epson\b/i, key: 'Epson' },
    { rx: /\bbrother\b/i,      key: 'Brother' },
    { rx: /\bricoh\b/i,        key: 'Ricoh' },
    { rx: /\bxerox\b/i,        key: 'Xerox' },
    { rx: /\bkyocera\b/i,      key: 'Kyocera' },
    // TVs / streaming
    { rx: /\blg\b.*\belectron/i, key: 'LG' },
    { rx: /\bvizio\b/i,        key: 'Vizio' },
    { rx: /\btcl\b/i,          key: 'TCL' },
    { rx: /\bhisense\b/i,      key: 'Hisense' },
    { rx: /\bamazon\b/i,       key: 'Amazon' },
    { rx: /\broku\b/i,         key: 'Roku' },
    { rx: /\bchromecast\b/i,   key: 'Chromecast' },
    { rx: /tp-?vision/i,       key: 'LG' },
    // Consoles
    { rx: /\b(sony|playstation)\b/i, key: 'PlayStation' },
    { rx: /\bnintendo\b/i,     key: 'Nintendo' },
    { rx: /\bxbox\b/i,         key: 'Xbox' },
    { rx: /\bmicrosoft\b/i,    key: 'Microsoft' },
    { rx: /\bvalve\b/i,        key: 'Valve' },
    // Smart home / security
    { rx: /\bring\b/i,         key: 'Ring' },
    { rx: /\bwyze\b/i,         key: 'Wyze' },
    { rx: /\barlo\b/i,         key: 'Arlo' },
    { rx: /\beufy\b/i,         key: 'Eufy' },
    { rx: /\bhikvision\b/i,    key: 'Hikvision' },
    { rx: /\bdahua\b/i,        key: 'Dahua' },
    { rx: /\baxis\b.*commun/i, key: 'Axis' },
    { rx: /\bnest\b|\bgoogle nest\b/i, key: 'Nest' },
    { rx: /\becobee\b/i,       key: 'Ecobee' },
    { rx: /philips hue|hue bridge|\bsignify\b/i, key: 'Philips Hue' },
    { rx: /\bsonos\b/i,        key: 'Sonos' },
    { rx: /\bbose\b/i,         key: 'Bose' },
    { rx: /harman|\bjbl\b/i,   key: 'Harman' },
    { rx: /\btuya\b|\bjinvoo\b/i, key: 'Tuya' },
    { rx: /\bshelly\b|allterco/i, key: 'Shelly' },
    { rx: /\biRobot\b/i,       key: 'iRobot' },
    { rx: /\bdyson\b/i,        key: 'Dyson' },
    { rx: /\bfitbit\b/i,       key: 'Fitbit' },
    { rx: /\bgarmin\b/i,       key: 'Garmin' },
    // Storage / servers
    { rx: /\bsynology\b/i,     key: 'Synology' },
    { rx: /\bqnap\b/i,         key: 'QNAP' },
    { rx: /western digital|\bwd\b(?!\w)/i, key: 'Western Digital' },
    { rx: /\bvmware\b/i,       key: 'VMware' },
    { rx: /\bproxmox\b/i,      key: 'Proxmox' },
    { rx: /\bsupermicro\b/i,   key: 'Supermicro' },
    // Dev boards / chips
    { rx: /\bespressif\b/i,    key: 'Espressif' },
    { rx: /raspberry pi/i,     key: 'Raspberry Pi' },
    { rx: /\brealtek\b/i,      key: 'Realtek' },
    { rx: /\bbroadcom\b/i,     key: 'Broadcom' },
    { rx: /\bmediatek\b/i,     key: 'MediaTek' },
    { rx: /\bqualcomm\b/i,     key: 'Qualcomm' },
    // Peripherals
    { rx: /\blogitech\b/i,     key: 'Logitech' },
    { rx: /\bjabra\b/i,        key: 'Jabra' },
    { rx: /plantronics/i,      key: 'Plantronics' },
    { rx: /\bgopro\b/i,        key: 'GoPro' },
    // PCs / laptops / components — matched LAST so more specific
    // vendors above win (e.g. Apple before Intel).
    { rx: /\bintel\b/i,        key: 'Intel' },
    { rx: /\bdell\b/i,         key: 'Dell' },
    { rx: /\blenovo\b/i,       key: 'Lenovo' },
    { rx: /\bacer\b/i,         key: 'Acer' },
    { rx: /\basus(?:tek)?\b/i, key: 'ASUS' },
    { rx: /\bmsi\b/i,          key: 'MSI' },
    { rx: /\brazer\b/i,        key: 'Razer' },
    { rx: /\balienware\b/i,    key: 'Alienware' },
    // ODM/laptop/board makers → best-effort into Computer
    { rx: /\bpegatron\b|\bcompal\b|\bquanta\b|\bliteon\b|\bhon hai\b|\bfoxconn\b|\belitegroup\b/i, key: 'Intel' },
]

/**
 * Hostname-based fallback patterns: even when the OUI is generic, the
 * hostname itself often leaks the device kind (office printers named
 * "laserjet-5f", game consoles named "ps5-living", etc.).
 */
export const HOSTNAME_PATTERNS = [
    { rx: /\b(laserjet|deskjet|officejet|hewlett[-_ ]?packard|\bhp[-_ ])/i, key: 'HP' },
    { rx: /\b(printer|airprint|ipp-printer)\b/i,        key: 'Printer' },
    { rx: /\b(iphone|ipad|imac|macbook|homepod|apple[-_ ]?tv|appletv)\b/i, key: 'Apple' },
    { rx: /\b(pixel|google[-_ ]?nest|nest[-_ ]?mini|nest[-_ ]?hub)\b/i, key: 'Google' },
    { rx: /\b(android|galaxy)\b/i,                      key: 'Samsung' },
    { rx: /\b(chromecast)\b/i,                          key: 'Chromecast' },
    { rx: /\b(roku)\b/i,                                key: 'Roku' },
    { rx: /\b(fire[-_ ]?tv|echo[-_ ]?(dot|show|studio)?|alexa)\b/i, key: 'Amazon' },
    { rx: /\b(playstation|ps[345])\b/i,                 key: 'PlayStation' },
    { rx: /\b(xbox)\b/i,                                key: 'Xbox' },
    { rx: /\b(nintendo|switch)\b/i,                     key: 'Nintendo' },
    { rx: /\b(sonos)\b/i,                               key: 'Sonos' },
    { rx: /\b(kasa|tapo|smart[-_ ]?plug)\b/i,           key: 'TP-Link Kasa' },
    { rx: /\b(ring)\b/i,                                key: 'Ring' },
    { rx: /\b(arlo)\b/i,                                key: 'Arlo' },
    { rx: /\b(wyze)\b/i,                                key: 'Wyze' },
    { rx: /\b(eufy)\b/i,                                key: 'Eufy' },
    { rx: /\b(hikvision)\b/i,                           key: 'Hikvision' },
    { rx: /\b(dahua)\b/i,                               key: 'Dahua' },
    { rx: /\b(onvif|ip[-_ ]?cam|camera)\b/i,            key: 'IP Camera' },
    { rx: /\b(hue|signify)\b/i,                         key: 'Philips Hue' },
    { rx: /\b(lightbulb|smart[-_ ]?light)\b/i,          key: 'Smart Light' },
    { rx: /\b(ecobee)\b/i,                              key: 'Ecobee' },
    { rx: /\b(thermostat)\b/i,                          key: 'Thermostat' },
    { rx: /\b(webos|bravia|smart[-_ ]?tv)\b/i,          key: 'Smart TV' },
    { rx: /\b(qnap)\b/i,                                key: 'QNAP' },
    { rx: /\b(raspberrypi|raspi)\b/i,                   key: 'Raspberry Pi' },
    { rx: /\b(synology|ds\d+)\b/i,                      key: 'Synology' },
    { rx: /\b(nas)\b/i,                                 key: 'NAS' },
]

/**
 * Resolve a raw vendor string (as returned by the OUI lookup) to a key
 * usable by the Scanner's DEV_TYPES catalogue. Returns null when no
 * pattern matches; callers should fall back to `cleanVendorName` to
 * produce a readable label from the raw string.
 */
export function resolveVendorKey(rawVendor) {
    if (!rawVendor || typeof rawVendor !== 'string') return null
    for (const { rx, key } of VENDOR_PATTERNS) {
        if (rx.test(rawVendor)) return key
    }
    return null
}

/**
 * Hostname-based classifier. Useful when vendor didn't yield a key but
 * the hostname contains an unambiguous clue.
 */
export function resolveHostnameHint(hostname) {
    if (!hostname || typeof hostname !== 'string') return null
    for (const { rx, key } of HOSTNAME_PATTERNS) {
        if (rx.test(hostname)) return key
    }
    return null
}

/**
 * Strip the noisy "Inc.", "Corp.", "Corporate", "Co., Ltd.", trailing
 * branch suffixes, trademark marks, etc. from an OUI-derived vendor
 * description so it reads as a friendly label. Returns null for empty
 * / non-string input. Callers that want a hard length cap should apply
 * it after — this function intentionally doesn't truncate mid-word.
 */
export function cleanVendorName(raw) {
    if (!raw || typeof raw !== 'string') return null
    let s = raw.trim()
    // Branch suffixes first: "Tenda Technology Co.,Ltd.Dongguan branch"
    // drops "Dongguan branch" before we iterate corporate suffixes. We
    // allow `[\s,.]*` before the city word because some OUIs omit the
    // separator ("Ltd.Dongguan").
    s = s.replace(/[\s,.]*\S+\s+(branch|office|division|sucursal|region)\.?\s*$/i, '')
    // Iteratively peel corporate suffixes so layered forms like
    // "Co., Ltd., Inc." flatten cleanly.
    const SUFFIX_RX = /[\s,.]+(inc|corp|corporation|corporate|incorporated|co\.?\s*,?\s*ltd\.?|co\.?|ltd|limited|gmbh|ag|s\.?a\.?|b\.?v\.?|llc|plc|pty|pte|oy|sas|kg|srl|spa)\.?\s*$/i
    let prev
    do {
        prev = s
        s = s.replace(SUFFIX_RX, '')
    } while (s !== prev && s.length)
    s = s.replace(/\s+/g, ' ').replace(/^[\s.,;:-]+|[\s.,;:-]+$/g, '')
    if (!s) return null
    return s
}
