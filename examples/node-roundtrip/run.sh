#!/usr/bin/env bash
set -euo pipefail

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "Reading active workspace version..."
VERSION=$(node -e "
  const fs = require('fs');
  const content = fs.readFileSync('../../Cargo.toml', 'utf8');
  const match = content.match(/\[workspace\.package\][^]*?version\s*=\s*\"([^\"]+)\"/);
  if (!match) {
    console.error('Could not find version in root Cargo.toml');
    process.exit(1);
  }
  console.log(match[1]);
")

echo "Active version: $VERSION"

echo "Installing nano-rspow-node@$VERSION..."
npm install "nano-rspow-node@$VERSION"

echo "Running Node roundtrip..."
node index.js
