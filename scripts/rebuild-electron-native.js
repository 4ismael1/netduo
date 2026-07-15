const path = require('path')
const { spawnSync } = require('child_process')

const projectRoot = path.resolve(__dirname, '..')
const electronVersion = require(path.join(projectRoot, 'node_modules', 'electron', 'package.json')).version
const rebuildEntry = require.resolve('@electron/rebuild')
const rebuildCli = path.join(path.dirname(rebuildEntry), 'cli.js')

const result = spawnSync(process.execPath, [
    rebuildCli,
    '--version', electronVersion,
    '--arch', process.arch,
    '--force',
    '--which-module', 'better-sqlite3',
], {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: true,
})

if (result.error) throw result.error
if (result.status !== 0) {
    process.exitCode = Number.isInteger(result.status) ? result.status : 1
} else {
    console.log(`Rebuilt better-sqlite3 for Electron ${electronVersion} (${process.arch}).`)
}
