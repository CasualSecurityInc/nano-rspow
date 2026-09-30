#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const cargoPath = path.join(rootDir, 'Cargo.toml');

// Read the current version from Cargo.toml
let currentVersion = null;
if (fs.existsSync(cargoPath)) {
  const content = fs.readFileSync(cargoPath, 'utf8');
  const match = content.match(/\[workspace\.package\][^]*?version\s*=\s*"([^"]+)"/);
  if (match) {
    currentVersion = match[1];
  }
}

if (!currentVersion) {
  console.error('Error: Could not read the current workspace version from Cargo.toml');
  process.exit(1);
}

const semverRegex = /^(\d+)\.(\d+)\.(\d+)(-[a-zA-Z0-9.]+)?$/;
const parsed = currentVersion.match(semverRegex);
if (!parsed) {
  console.error(`Error: Current version "${currentVersion}" in Cargo.toml is not valid semver.`);
  process.exit(1);
}

let major = parseInt(parsed[1], 10);
let minor = parseInt(parsed[2], 10);
let patch = parseInt(parsed[3], 10);

const inputArg = process.argv[2];

if (!inputArg) {
  console.error('Error: Please provide a bump type or a new version.');
  console.error('Usage:');
  console.error('  node scripts/bump-version.js patch          (Increment patch: e.g. 0.5.7 -> 0.5.8)');
  console.error('  node scripts/bump-version.js minor          (Increment minor: e.g. 0.5.7 -> 0.6.0)');
  console.error('  node scripts/bump-version.js major          (Increment major: e.g. 0.5.7 -> 1.0.0)');
  console.error('  node scripts/bump-version.js <new-version>  (Set to explicit version string)');
  process.exit(1);
}

let newVersion;
if (['major', 'minor', 'patch'].includes(inputArg)) {
  if (inputArg === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (inputArg === 'minor') {
    minor += 1;
    patch = 0;
  } else if (inputArg === 'patch') {
    patch += 1;
  }
  newVersion = `${major}.${minor}.${patch}`;
  console.log(`Bumping ${inputArg} version from ${currentVersion} ➡️ ${newVersion}`);
} else {
  if (!semverRegex.test(inputArg)) {
    console.error(`Error: Invalid version or bump type: "${inputArg}"`);
    console.error('Must be "major", "minor", "patch", or an explicit semver string (e.g. "0.5.8")');
    process.exit(1);
  }
  newVersion = inputArg;
  console.log(`Setting explicit version: ${currentVersion} ➡️ ${newVersion}`);
}

// 1. Update Cargo.toml workspace version
if (fs.existsSync(cargoPath)) {
  let content = fs.readFileSync(cargoPath, 'utf8');
  // Match version line inside [workspace.package] section
  const workspacePackageRegex = /(\[workspace\.package\][^]*?version\s*=\s*")[^"]+(")/;
  if (workspacePackageRegex.test(content)) {
    content = content.replace(workspacePackageRegex, `$1${newVersion}$2`);
    fs.writeFileSync(cargoPath, content, 'utf8');
    console.log(`✅ Root Cargo.toml workspace package version bumped to ${newVersion}`);
  } else {
    console.warn('⚠️ Could not find [workspace.package] version line in Cargo.toml');
  }
}

// Helper to update package.json version
function bumpPackageJson(relativeDir, packageName) {
  const jsonPath = path.join(rootDir, relativeDir, 'package.json');
  if (fs.existsSync(jsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const oldVersion = pkg.version;
    pkg.version = newVersion;
    fs.writeFileSync(jsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`✅ ${packageName} package.json version bumped: ${oldVersion} ➡️ ${newVersion}`);
  } else {
    console.warn(`⚠️ Could not find package.json in ${relativeDir}`);
  }
}

// Helper to update the version recorded in package-lock.json.
//
// The lockfile is version-bearing: npm stores its own copy of the package's
// version at the top level and again under packages[""], and `npm ci` does not
// reconcile those against package.json the way `npm install` does. Left alone
// they drift, and the repository ends up carrying a version that disagrees
// with the manifest it belongs to. Both published npm packages are covered.
function bumpPackageLock(relativeDir, packageName) {
  const lockPath = path.join(rootDir, relativeDir, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    console.warn(`⚠️ Could not find package-lock.json in ${relativeDir}`);
    return;
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const oldVersion = lock.version;
  lock.version = newVersion;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = newVersion;
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  // Surface a pre-existing mismatch so drift that is already in the tree is
  // visible in the bump output rather than silently corrected.
  const note = oldVersion === newVersion ? '' : ` (was ${oldVersion})`;
  console.log(`✅ ${packageName} package-lock.json version set to ${newVersion}${note}`);
}

// Update a package's manifest and its lockfile together, so adding a published
// package cannot repeat the mistake of bumping one and forgetting the other.
function bumpPackage(relativeDir, packageName) {
  bumpPackageJson(relativeDir, packageName);
  bumpPackageLock(relativeDir, packageName);
}

// 2. Update nano-rspow-node package manifest and lockfile
bumpPackage('nano-rspow-node', 'nano-rspow-node (Node Wrapper)');

// 3. Update nano-rspow-web package manifest and lockfile
// benchmark-compare is deliberately excluded: it is a private, unpublished
// local experiment pinned at its own version and is not part of the release.
bumpPackage('nano-rspow-web', 'nano-rspow-web (Web WASM)');

// 4. Update inter-crate dependency versions (nano-rspow-cli depends on nano-rspow)
const cliCargoPath = path.join(rootDir, 'nano-rspow-cli', 'Cargo.toml');
if (fs.existsSync(cliCargoPath)) {
  let content = fs.readFileSync(cliCargoPath, 'utf8');
  const depRegex = /(nano-rspow\s*=\s*\{[^}]*version\s*=\s*")[^"]+(")/;
  if (depRegex.test(content)) {
    content = content.replace(depRegex, `$1${newVersion}$2`);
    fs.writeFileSync(cliCargoPath, content, 'utf8');
    console.log(`✅ nano-rspow-cli dependency on nano-rspow bumped to ${newVersion}`);
  }
}

console.log('\n🎉 Version sync complete! All source manifests aligned.');
console.log('npm lockfiles are updated as part of the bump. To refresh Cargo.lock');
console.log('and confirm the workspace still builds, run:');
console.log('  cargo check --all-targets');
