#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/random-roots.sh"
cd "$script_dir"

WORK_ITEM_COUNT="${WORK_ITEM_COUNT:-10}"

# Stream independent 32-byte roots without waiting for each result.
generate_random_roots "$WORK_ITEM_COUNT" | time ../target/release/nano-rspow generate --stream
