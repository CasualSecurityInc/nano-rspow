#!/usr/bin/env node

const { execFileSync } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');
const { platform, arch } = process;

function findLdd() {
  const pathEnv = process.env.PATH || '';
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const paths = pathEnv.split(delimiter);
  for (const dir of paths) {
    if (!dir) continue;
    const fullPath = join(dir, 'ldd');
    try {
      if (existsSync(fullPath)) {
        return fullPath;
      }
    } catch (e) {
      // Ignore access errors
    }
  }
  return null;
}

function isMusl() {
  if (!process.report || typeof process.report.getReport !== 'function') {
    try {
      const lddPath = findLdd();
      if (!lddPath) return true;
      return readFileSync(lddPath, 'utf8').includes('musl');
    } catch (e) {
      return true;
    }
  } else {
    const { glibcVersionRuntime } = process.report.getReport().header;
    return !glibcVersionRuntime;
  }
}

// Map platform-arch to the napi-rs platform package suffix and binary name
let pkgSuffix = '';
let binName = 'nano-rspow';

switch (platform) {
  case 'android':
    switch (arch) {
      case 'arm64': pkgSuffix = 'android-arm64'; break;
      case 'arm': pkgSuffix = 'android-arm-eabi'; break;
    }
    break;
  case 'win32':
    binName = 'nano-rspow.exe';
    switch (arch) {
      case 'x64': pkgSuffix = 'win32-x64-msvc'; break;
      case 'ia32': pkgSuffix = 'win32-ia32-msvc'; break;
      case 'arm64': pkgSuffix = 'win32-arm64-msvc'; break;
    }
    break;
  case 'darwin':
    switch (arch) {
      case 'x64': pkgSuffix = 'darwin-x64'; break;
      case 'arm64': pkgSuffix = 'darwin-arm64'; break;
    }
    break;
  case 'freebsd':
    if (arch === 'x64') pkgSuffix = 'freebsd-x64';
    break;
  case 'linux':
    switch (arch) {
      case 'x64':
        pkgSuffix = isMusl() ? 'linux-x64-musl' : 'linux-x64-gnu';
        break;
      case 'arm64':
        pkgSuffix = isMusl() ? 'linux-arm64-musl' : 'linux-arm64-gnu';
        break;
      case 'arm':
        pkgSuffix = isMusl() ? 'linux-arm-musleabihf' : 'linux-arm-gnueabihf';
        break;
      case 'riscv64':
        pkgSuffix = isMusl() ? 'linux-riscv64-musl' : 'linux-riscv64-gnu';
        break;
      case 's390x':
        pkgSuffix = 'linux-s390x-gnu';
        break;
    }
    break;
}

if (!pkgSuffix) {
  console.error(`❌ Unsupported platform or architecture: ${platform}-${arch}`);
  process.exit(1);
}

// Find binary location
let binPath = null;

// Path search order:
// 1. Local cargo builds (development / monorepo)
const targetDir = join(__dirname, '..', '..', 'target');
const localRelease = join(targetDir, 'release', binName);
const localDebug = join(targetDir, 'debug', binName);

if (existsSync(localRelease)) {
  binPath = localRelease;
} else if (existsSync(localDebug)) {
  binPath = localDebug;
}

// 2. Inside local npm/ platform subdirectories (monorepo packaging build)
if (!binPath) {
  const localNpmDir = join(__dirname, '..', 'npm', pkgSuffix, binName);
  if (existsSync(localNpmDir)) {
    binPath = localNpmDir;
  }
}

// 3. Resolve from node_modules platform package
if (!binPath) {
  const possiblePkgNames = [
    `nano-rspow-node-${pkgSuffix}`,  // standard package name
    `nano-rspow-${pkgSuffix}`        // fallback
  ];

  for (const pkgName of possiblePkgNames) {
    try {
      const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
      const pkgDir = join(pkgJsonPath, '..');
      const candidate = join(pkgDir, binName);
      if (existsSync(candidate)) {
        binPath = candidate;
        break;
      }
    } catch (e) {
      // Ignore resolution errors for nonexistent packages
    }
  }
}

if (!binPath || !existsSync(binPath)) {
  console.error(
    `❌ nano-rspow: CLI binary not found for ${platform}-${arch}.\n` +
    `The platform-specific package may not be installed.\n` +
    `Please install using 'npm install nano-rspow-node'.`
  );
  process.exit(1);
}

// Execute the native binary with all args, inheriting stdio
try {
  execFileSync(binPath, process.argv.slice(2), { stdio: 'inherit' });
} catch (e) {
  if (e.status !== undefined && e.status !== null) {
    process.exit(e.status);
  }
  process.exit(1);
}
