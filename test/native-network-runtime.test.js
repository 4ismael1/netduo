import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const main = fs.readFileSync(path.join(process.cwd(), 'electron', 'main.js'), 'utf8')
const provider = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'useNetworkStatus.jsx'), 'utf8')

describe('native Windows network runtime', () => {
    it('does not route native commands through cmd.exe', () => {
        expect(main).not.toContain("const { exec, execFile, spawn } = require('child_process')")
        expect(main).not.toContain('function run(cmd')
        expect(main).toContain("runProgram('netsh', ['wlan', 'show', 'interfaces']")
        expect(main).toContain("runProgram('ipconfig', ['/all']")
        expect(main).toContain("runProgram('arp', ['-a']")
    })

    it('shares one cached PowerShell snapshot across adapters, routes, and VPN', () => {
        expect(main).toContain('const WINDOWS_NATIVE_SNAPSHOT_TTL_MS = 60000')
        expect(main).toContain('function buildWindowsNativeSnapshotScript()')
        expect(main).toContain('async function getWindowsNativeSnapshot()')
        expect(main).toContain("'[PSCustomObject]@{ adapters=$adapters; ipInterfaces=$ipInterfaces; ipAddresses=$ipAddresses; routes=$routes; contexts=$contexts } | ConvertTo-Json -Compress -Depth 6'")
        expect(main).toContain('parsed = await getWindowsNativeSnapshot()')
        expect(main).toContain('const snapshot = await getWindowsNativeSnapshot()')
        expect(main).toContain('invalidateNativeNetworkCaches()')
    })

    it('keeps structural polling separate from user latency polling', () => {
        expect(provider).toContain('const STRUCTURAL_POLL_MS = 30000')
        expect(provider).toContain('if (fetchInFlightRef.current) return')
        expect(provider).toContain("bridge.configGetPublic(['onlineNetworkInfo'])")
        expect(provider).not.toContain("bridge.configGetPublic(['pollInterval', 'onlineNetworkInfo'])")
        expect(main).toContain('}, 10000)')
    })
})
