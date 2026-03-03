/**
 * electronBridge.test.js
 * Tests all mock API functions in electronBridge (browser mode, no Electron)
 */
import { describe, it, expect, beforeEach } from 'vitest'

// window.electronAPI is undefined in test env → bridge always uses mocks
import bridge from '../lib/electronBridge'

// ── isElectron ────────────────────────────────────────────────────────────
describe('electronBridge.isElectron', () => {
    it('returns false when window.electronAPI is not present', () => {
        expect(bridge.isElectron).toBe(false)
    })
})

// ── getNetworkInterfaces ──────────────────────────────────────────────────
describe('electronBridge.getNetworkInterfaces', () => {
    it('resolves to a non-empty array', async () => {
        const ifaces = await bridge.getNetworkInterfaces()
        expect(Array.isArray(ifaces)).toBe(true)
        expect(ifaces.length).toBeGreaterThan(0)
    })

    it('each interface has required fields', async () => {
        const ifaces = await bridge.getNetworkInterfaces()
        for (const iface of ifaces) {
            expect(iface).toHaveProperty('name')
            expect(iface).toHaveProperty('address')
            expect(iface).toHaveProperty('family')
            expect(iface).toHaveProperty('mac')
            expect(typeof iface.internal).toBe('boolean')
        }
    })

    it('has at least one non-internal IPv4 interface', async () => {
        const ifaces = await bridge.getNetworkInterfaces()
        const ipv4External = ifaces.find(i => i.family === 'IPv4' && !i.internal)
        expect(ipv4External).toBeDefined()
        expect(ipv4External.address).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    })
})

// ── getSystemInfo ─────────────────────────────────────────────────────────
describe('electronBridge.getSystemInfo', () => {
    it('resolves with required system fields', async () => {
        const info = await bridge.getSystemInfo()
        expect(info).toHaveProperty('hostname')
        expect(info).toHaveProperty('platform')
        expect(info).toHaveProperty('cpus')
        expect(info).toHaveProperty('totalmem')
        expect(info).toHaveProperty('freemem')
        expect(info).toHaveProperty('uptime')
    })

    it('totalmem is greater than freemem', async () => {
        const info = await bridge.getSystemInfo()
        expect(info.totalmem).toBeGreaterThan(info.freemem)
    })

    it('cpus is a positive integer', async () => {
        const info = await bridge.getSystemInfo()
        expect(Number.isInteger(info.cpus)).toBe(true)
        expect(info.cpus).toBeGreaterThan(0)
    })

    it('uptime is a positive number', async () => {
        const info = await bridge.getSystemInfo()
        expect(info.uptime).toBeGreaterThan(0)
    })
})

// ── getPublicIP ───────────────────────────────────────────────────────────
describe('electronBridge.getPublicIP', () => {
    it('resolves to a non-empty string', async () => {
        const ip = await bridge.getPublicIP()
        expect(typeof ip).toBe('string')
        expect(ip.length).toBeGreaterThan(0)
    })

    it('looks like a valid IP address', async () => {
        const ip = await bridge.getPublicIP()
        expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
    })
})

// ── getIPGeo ──────────────────────────────────────────────────────────────
describe('electronBridge.getIPGeo', () => {
    it('resolves with geo fields', async () => {
        const geo = await bridge.getIPGeo('203.0.113.45')
        expect(geo).toHaveProperty('country')
        expect(geo).toHaveProperty('city')
        expect(geo).toHaveProperty('isp')
        expect(geo).toHaveProperty('lat')
        expect(geo).toHaveProperty('lon')
    })
})

// ── pingSingle ────────────────────────────────────────────────────────────
describe('electronBridge.pingSingle', () => {
    it('resolves with time and success fields', async () => {
        const r = await bridge.pingSingle('1.1.1.1')
        expect(r).toHaveProperty('host', '1.1.1.1')
        expect(r).toHaveProperty('success', true)
        expect(typeof r.time).toBe('number')
    }, 10000)

    it('time is a positive number within realistic range', async () => {
        const r = await bridge.pingSingle('8.8.8.8')
        expect(r.time).toBeGreaterThan(0)
        expect(r.time).toBeLessThan(2000)
    }, 10000)
})

// ── pingHost ──────────────────────────────────────────────────────────────
describe('electronBridge.pingHost', () => {
    it('resolves with avg/min/max/loss/raw', async () => {
        const r = await bridge.pingHost('google.com', 4)
        expect(r).toHaveProperty('avg')
        expect(r).toHaveProperty('min')
        expect(r).toHaveProperty('max')
        expect(r).toHaveProperty('loss')
        expect(r).toHaveProperty('raw')
        expect(r).toHaveProperty('success', true)
    }, 10000)

    it('avg is within min..max range', async () => {
        const r = await bridge.pingHost('1.1.1.1', 4)
        expect(parseFloat(r.avg)).toBeGreaterThanOrEqual(parseFloat(r.min))
        expect(parseFloat(r.avg)).toBeLessThanOrEqual(parseFloat(r.max))
    }, 10000)
})

// ── startTraceroute ────────────────────────────────────────────────────────────
describe('electronBridge.startTraceroute', () => {
    it('resolves with hops array sequentially', async () => {
        const hops = []
        await new Promise(resolve => {
            bridge.startTraceroute('google.com', hop => hops.push(hop), () => resolve())
        })
        expect(hops.length).toBeGreaterThan(0)
        expect(hops[0]).toHaveProperty('hop')
        expect(hops[0]).toHaveProperty('ip')
    }, 15000)

    it('each hop has a hop number and times', async () => {
        const hops = []
        await new Promise(resolve => {
            bridge.startTraceroute('8.8.8.8', hop => hops.push(hop), () => resolve())
        })
        for (const hop of hops) {
            expect(hop).toHaveProperty('hop')
            expect(typeof hop.hop).toBe('number')
            expect(Array.isArray(hop.times)).toBe(true)
        }
    }, 15000)
})

// ── dnsLookup ─────────────────────────────────────────────────────────────
describe('electronBridge.dnsLookup', () => {
    it('resolves A records for a domain', async () => {
        const r = await bridge.dnsLookup('google.com', 'A')
        expect(r).toHaveProperty('type', 'A')
        expect(Array.isArray(r.addresses)).toBe(true)
    }, 10000)

    it('resolves MX records', async () => {
        const r = await bridge.dnsLookup('google.com', 'MX')
        expect(r).toHaveProperty('type', 'MX')
        expect(Array.isArray(r.addresses)).toBe(true)
    }, 10000)

    it('includes timing info', async () => {
        const r = await bridge.dnsLookup('google.com', 'TXT')
        expect(typeof r.time).toBe('number')
        expect(r.time).toBeGreaterThan(0)
    }, 10000)
})

// ── checkPort ─────────────────────────────────────────────────────────────
describe('electronBridge.checkPort', () => {
    it('resolves with port and open status', async () => {
        const r = await bridge.checkPort('google.com', 443)
        expect(r).toHaveProperty('port', 443)
        expect(typeof r.open).toBe('boolean')
        expect(r).toHaveProperty('time')
    }, 10000)

    it('port 80 is considered open in mock', async () => {
        const r = await bridge.checkPort('localhost', 80)
        expect(r.open).toBe(true)
    }, 5000)
})

// ── scanPorts ─────────────────────────────────────────────────────────────
describe('electronBridge.scanPorts', () => {
    it('returns an array of open ports', async () => {
        const r = await bridge.scanPorts('localhost', 1, 100)
        expect(Array.isArray(r)).toBe(true)
    }, 10000)

    it('each open port entry has port property', async () => {
        const r = await bridge.scanPorts('localhost', 20, 90)
        for (const entry of r) {
            expect(entry).toHaveProperty('port')
            expect(typeof entry.port).toBe('number')
        }
    }, 10000)

    it('respects port range boundaries', async () => {
        const r = await bridge.scanPorts('localhost', 50, 55)
        for (const entry of r) {
            expect(entry.port).toBeGreaterThanOrEqual(50)
            expect(entry.port).toBeLessThanOrEqual(55)
        }
    }, 10000)
})

// ── httpTest ──────────────────────────────────────────────────────────────
describe('electronBridge.httpTest', () => {
    it('resolves with status, time, headers', async () => {
        const r = await bridge.httpTest('https://httpbin.org/get', 'GET')
        expect(r).toHaveProperty('status')
        expect(r).toHaveProperty('time')
        expect(r).toHaveProperty('headers')
        expect(typeof r.time).toBe('number')
        expect(r.time).toBeGreaterThan(0)
    }, 10000)

    it('returns status 200 for successful mock', async () => {
        const r = await bridge.httpTest('https://example.com', 'GET')
        expect(r.status).toBe(200)
    }, 10000)
})

// ── lanScan ───────────────────────────────────────────────────────────────
describe('electronBridge.lanScan', () => {
    it('returns array of devices', async () => {
        const devices = await bridge.lanScan('192.168.1', 1, 254)
        expect(Array.isArray(devices)).toBe(true)
        expect(devices.length).toBeGreaterThan(0)
    }, 15000)

    it('each device has ip and alive status', async () => {
        const devices = await bridge.lanScan('192.168.1', 1, 254)
        for (const device of devices) {
            expect(device).toHaveProperty('ip')
            expect(device).toHaveProperty('alive')
            expect(device.alive).toBe(true)
        }
    }, 15000)

    it('device IPs match the base prefix', async () => {
        const devices = await bridge.lanScan('10.0.0', 1, 100)
        for (const device of devices) {
            expect(device.ip.startsWith('10.0.0.')).toBe(true)
        }
    }, 15000)
})

// ── speedLatency ─────────────────────────────────────────────────────────
describe('electronBridge.speedLatency', () => {
    it('resolves with latency and jitter', async () => {
        const r = await bridge.speedLatency()
        expect(typeof parseFloat(r.latency)).toBe('number')
        expect(typeof parseFloat(r.jitter)).toBe('number')
        expect(parseFloat(r.latency)).toBeGreaterThan(0)
        expect(parseFloat(r.jitter)).toBeGreaterThan(0)
    }, 15000)
})

// ── speedDownload ─────────────────────────────────────────────────────────
describe('electronBridge.speedDownload', () => {
    it('resolves with speedMbps in realistic range', async () => {
        const r = await bridge.speedDownload()
        expect(typeof r.speedMbps).toBe('number')
        expect(r.speedMbps).toBeGreaterThan(0)
        expect(r.speedMbps).toBeLessThan(10000)
    }, 15000)
})

// ── history ───────────────────────────────────────────────────────────────
describe('electronBridge history', () => {
    beforeEach(async () => {
        await bridge.historyClear()
    })

    it('starts empty after clear', async () => {
        const h = await bridge.historyGet()
        expect(h).toEqual([])
    })

    it('adds and retrieves an entry', async () => {
        await bridge.historyAdd({ module: 'Test', type: 'Unit Test', detail: 'vitest', results: {} })
        const h = await bridge.historyGet()
        expect(h.length).toBeGreaterThanOrEqual(1)
        expect(h[0].module).toBe('Test')
        expect(h[0].type).toBe('Unit Test')
    })

    it('limits history to 200 entries', async () => {
        const entries = Array.from({ length: 210 }, (_, i) => ({ module: 'Test', type: 'Item', detail: String(i), results: {} }))
        for (const e of entries) await bridge.historyAdd(e)
        const h = await bridge.historyGet()
        expect(h.length).toBeLessThanOrEqual(200)
    })
})
