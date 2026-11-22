const { existsSync } = require('fs')
const { join } = require('path')

const { platform, arch } = process

function isMusl() {
  if (platform !== 'linux') return false
  if (typeof process.report?.getReport === 'function') {
    try {
      process.report.excludeNetwork = true
      const report = process.report.getReport()
      if (report?.header?.glibcVersionRuntime) return false
      if (Array.isArray(report?.sharedObjects)) {
        if (report.sharedObjects.some((f) => f.includes('libc.musl-') || f.includes('ld-musl-'))) return true
      }
    } catch {}
  }
  try {
    return require('child_process').execSync('ldd --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).includes('musl')
  } catch {
    return true
  }
}

// Supported platform-to-package mappings for the built targets
const PLATFORMS = {
  'darwin-x64': { file: 'nano-rspow-node.darwin-x64.node', pkg: 'nano-rspow-node-darwin-x64' },
  'darwin-arm64': { file: 'nano-rspow-node.darwin-arm64.node', pkg: 'nano-rspow-node-darwin-arm64' },
  'win32-x64': { file: 'nano-rspow-node.win32-x64-msvc.node', pkg: 'nano-rspow-node-win32-x64-msvc' },
  'linux-x64-gnu': { file: 'nano-rspow-node.linux-x64-gnu.node', pkg: 'nano-rspow-node-linux-x64-gnu' },
  'linux-x64-musl': { file: 'nano-rspow-node.linux-x64-musl.node', pkg: 'nano-rspow-node-linux-x64-musl' },
  'linux-arm64-gnu': { file: 'nano-rspow-node.linux-arm64-gnu.node', pkg: 'nano-rspow-node-linux-arm64-gnu' },
  'linux-arm64-musl': { file: 'nano-rspow-node.linux-arm64-musl.node', pkg: 'nano-rspow-node-linux-arm64-musl' }
}

const libc = platform === 'linux' ? (isMusl() ? 'musl' : 'gnu') : ''
const key = libc ? `${platform}-${arch}-${libc}` : `${platform}-${arch}`
const target = PLATFORMS[key]

if (!target) {
  throw new Error(`Unsupported OS/Architecture combination: ${key}`)
}

const localPath = join(__dirname, target.file)
let nativeBinding = null
let loadError = null

if (existsSync(localPath)) {
  try {
    nativeBinding = require(localPath)
  } catch (e) {
    loadError = e
  }
}

if (!nativeBinding) {
  try {
    nativeBinding = require(target.pkg)
  } catch (e) {
    loadError = e
  }
}

// Fallback across libc variants on Linux if detection diverged from installed optional dependency
if (!nativeBinding && platform === 'linux') {
  const altKey = `${platform}-${arch}-${libc === 'musl' ? 'gnu' : 'musl'}`
  const altTarget = PLATFORMS[altKey]
  if (altTarget) {
    const altLocal = join(__dirname, altTarget.file)
    if (existsSync(altLocal)) {
      try {
        nativeBinding = require(altLocal)
        loadError = null
      } catch {}
    }
    if (!nativeBinding) {
      try {
        nativeBinding = require(altTarget.pkg)
        loadError = null
      } catch {}
    }
  }
}

if (!nativeBinding) {
  throw loadError || new Error(`Failed to load native binding for ${key}`)
}

const {
  WorkType,
  LegacyWorkType,
  TestingWorkType,
  generateWork,
  generateWorkWithThreshold,
  validateWork,
  validateWorkWithThreshold,
  getBackendName,
  recommendLocalPow,
  clearPowTuningCache,
  workTypeToHex,
  legacyWorkTypeToHex,
  testingWorkTypeToHex
} = nativeBinding

module.exports.WorkType = WorkType
module.exports.LegacyWorkType = LegacyWorkType
module.exports.TestingWorkType = TestingWorkType
module.exports.generateWork = generateWork
module.exports.generateWorkWithThreshold = generateWorkWithThreshold
module.exports.validateWork = validateWork
module.exports.validateWorkWithThreshold = validateWorkWithThreshold
module.exports.getBackendName = getBackendName
module.exports.recommendLocalPow = recommendLocalPow
module.exports.clearPowTuningCache = clearPowTuningCache
module.exports.workTypeToHex = workTypeToHex
module.exports.legacyWorkTypeToHex = legacyWorkTypeToHex
module.exports.testingWorkTypeToHex = testingWorkTypeToHex

module.exports.createPowEngine = function createPowEngine () {
  return {
    name: 'nano-rspow-node',
    generate: (root, threshold) => generateWorkWithThreshold(root, threshold),
    validate: (root, work, threshold) => validateWorkWithThreshold(root, work, threshold)
  }
}
