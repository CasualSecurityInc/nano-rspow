#!/usr/bin/env bash
set -euo pipefail

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# Color support
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0;0m' # No Color

echo -e "${CYAN}===================================================${NC}"
echo -e "${CYAN}      NANO-RSPOW PUBLISHING ROUNDTRIP SUITE       ${NC}"
echo -e "${CYAN}===================================================${NC}"

# Detect version
VERSION=$(node -e "
  const fs = require('fs');
  const content = fs.readFileSync('../Cargo.toml', 'utf8');
  const match = content.match(/\[workspace\.package\][^]*?version\s*=\s*\"([^\"]+)\"/);
  if (!match) {
    console.error('Could not find version in root Cargo.toml');
    process.exit(1);
  }
  console.log(match[1]);
")

echo -e "${YELLOW}Detected Workspace Active Version:${NC} ${GREEN}$VERSION${NC}"
echo ""

# Make all child run scripts executable
chmod +x rust-roundtrip/run.sh
chmod +x node-roundtrip/run.sh
chmod +x web-roundtrip/run.sh
chmod +x python-roundtrip/run.sh

# Determine which roundtrips to run
TARGETS=()
if [ $# -eq 0 ]; then
  TARGETS=("rust" "node" "web" "python")
else
  for arg in "$@"; do
    if [[ "$arg" =~ ^(rust|node|web|python)$ ]]; then
      TARGETS+=("$arg")
    else
      echo -e "${RED}Unknown target: $arg${NC} (Valid: rust, node, web, python)"
      exit 1
    fi
  done
fi

# Track results
declare -A RESULTS
exit_code=0

for target in "${TARGETS[@]}"; do
  echo -e "${CYAN}---------------------------------------------------${NC}"
  echo -e "${BLUE}▶ Running ${target} roundtrip test...${NC}"
  echo -e "${CYAN}---------------------------------------------------${NC}"
  
  set +e
  if [ "$target" == "rust" ]; then
    ./rust-roundtrip/run.sh
  elif [ "$target" == "node" ]; then
    ./node-roundtrip/run.sh
  elif [ "$target" == "web" ]; then
    ./web-roundtrip/run.sh
  elif [ "$target" == "python" ]; then
    ./python-roundtrip/run.sh
  fi
  status=$?
  set -e
  
  if [ $status -eq 0 ]; then
    RESULTS["$target"]="PASSED"
    echo -e "\n${GREEN}✓ ${target} roundtrip PASSED!${NC}\n"
  else
    RESULTS["$target"]="FAILED"
    echo -e "\n${RED}✗ ${target} roundtrip FAILED!${NC}\n"
    exit_code=1
  fi
done

# Print summary
echo -e "${CYAN}===================================================${NC}"
echo -e "${CYAN}                  SUMMARY RESULTS                  ${NC}"
echo -e "${CYAN}===================================================${NC}"

for target in "${TARGETS[@]}"; do
  status="${RESULTS[$target]}"
  if [ "$status" == "PASSED" ]; then
    echo -e "${target}: ${GREEN}${status}${NC}"
  else
    echo -e "${target}: ${RED}${status}${NC}"
  fi
done
echo -e "${CYAN}===================================================${NC}"

exit $exit_code
