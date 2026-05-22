#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];

if (!newVersion) {
  console.error('Error: Please provide the new version as an argument.');
  console.error('Example: node scripts/bump-version.js 0.5.8');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(newVersion)) {
  console.error(`Error: Invalid semver version format: "${newVersion}"`);
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');

// 1. Update Cargo.toml workspace version
const cargoPath = path.join(rootDir, 'Cargo.toml');
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

// 2. Update nano-rspow-node package.json
bumpPackageJson('nano-rspow-node', 'nano-rspow-node (Node Wrapper)');

// 3. Update nano-rspow-web package.json
bumpPackageJson('nano-rspow-web', 'nano-rspow-web (Web WASM)');

console.log('\n🎉 Version sync complete! All source manifests aligned.');
console.log('To update lockfiles and verify consistency, you can run:');
console.log('  cargo check --all-targets');
