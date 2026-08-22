#!/usr/bin/env bash
set -euo pipefail

: "${NANO_WORK_URL:?Set NANO_WORK_URL to the Nano work-server endpoint}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/random-roots.sh"

WORK_ITEM_COUNT="${WORK_ITEM_COUNT:-10}"

run_load() {
  local hash count=0
  local -a curl_args=(
    --fail
    --silent
    --show-error
    --no-buffer
    --parallel
    --parallel-immediate
  )

  # Add independent requests to one parallel curl invocation.
  while IFS= read -r hash; do
    if ((count > 0)); then
      curl_args+=(--next)
    fi
    curl_args+=(
      --json "{\"action\":\"work_generate\",\"hash\":\"$hash\"}"
      --write-out '\n'
      "$NANO_WORK_URL"
    )
    ((count += 1))
  done < <(generate_random_roots "$WORK_ITEM_COUNT")

  curl "${curl_args[@]}"
}

time run_load
