const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const outputDirectory = path.resolve(projectRoot, 'dist-electron')

function isStrictChild(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

function isSamePath(left, right) {
  const normalizeForComparison = value => {
    const normalized = path.normalize(value)
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }
  return normalizeForComparison(left) === normalizeForComparison(right)
}

if (path.basename(outputDirectory) !== 'dist-electron' || !isStrictChild(projectRoot, outputDirectory)) {
  throw new Error(`Refusing to clean unexpected path: ${outputDirectory}`)
}

if (fs.existsSync(outputDirectory)) {
  const realProjectRoot = fs.realpathSync.native(projectRoot)
  const realOutputDirectory = fs.realpathSync.native(outputDirectory)
  const expectedRealOutputDirectory = path.resolve(realProjectRoot, 'dist-electron')

  if (!isStrictChild(realProjectRoot, realOutputDirectory) || !isSamePath(realOutputDirectory, expectedRealOutputDirectory)) {
    throw new Error(`Refusing to clean redirected or unexpected path: ${realOutputDirectory}`)
  }

  fs.rmSync(outputDirectory, { recursive: true, force: true })
}

fs.mkdirSync(outputDirectory, { recursive: true })
console.log(`Clean Electron output: ${outputDirectory}`)
