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

if ! command -v cargo >/dev/null 2>&1; then
  echo "Error: cargo is not on PATH. Install Rust with rustup or add its cargo bin directory to PATH."
  exit 127
fi

# Update Cargo.toml dependency version
node -e "
  const fs = require('fs');
  let content = fs.readFileSync('Cargo.toml', 'utf8');
  content = content.replace(/(nano-rspow\s*=\s*\")[^\"]+(\")/, '\$1' + '$VERSION' + '\$2');
  fs.writeFileSync('Cargo.toml', content, 'utf8');
"

echo "Running cargo run..."
cargo run
