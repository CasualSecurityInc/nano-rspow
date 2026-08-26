const { existsSync } = require('fs')
const { join } = require('path')

const { platform, arch } = process

// Supported platform-to-package mappings for the built targets
const PLATFORMS = {
  'darwin-x64': { file: 'nano-rspow-node.darwin-x64.node', pkg: 'nano-rspow-node-darwin-x64' },
  'darwin-arm64': { file: 'nano-rspow-node.darwin-arm64.node', pkg: 'nano-rspow-node-darwin-arm64' },
  'win32-x64': { file: 'nano-rspow-node.win32-x64-msvc.node', pkg: 'nano-rspow-node-win32-x64-msvc' },
  'linux-x64': { file: 'nano-rspow-node.linux-x64-gnu.node', pkg: 'nano-rspow-node-linux-x64-gnu' },
  'linux-arm64': { file: 'nano-rspow-node.linux-arm64-gnu.node', pkg: 'nano-rspow-node-linux-arm64-gnu' }
}

const key = `${platform}-${arch}`
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
} else {
  try {
    nativeBinding = require(target.pkg)
  } catch (e) {
    loadError = e
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
