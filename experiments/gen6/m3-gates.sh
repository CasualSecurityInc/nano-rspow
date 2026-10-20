#!/usr/bin/env bash
# Exact-output M3 checks. This submits GPU work only after explicit invocation.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=0000000000000000000000000000000000000000000000000000000000000001
run_check() {
  local name=$1 base=$2 threads=$3 threshold=${4:-}
  local args=(--submit --kernel m3.bin --root "$ROOT" --base "$base" --threads "$threads" --dump "m3-results/$name.bin")
  if [ -n "$threshold" ]; then args+=(--threshold "$threshold"); fi
  echo "== $name: base=$base threads=$threads threshold=${threshold:-none}"
  ./snb-m3 "${args[@]}" > "m3-results/$name.log" 2>&1
  cat "m3-results/$name.log"
  local check=(python3 golden.py check "m3-results/$name.bin" "$ROOT" "$base" "$threads")
  if [ -n "$threshold" ]; then check+=("$threshold"); fi
  "${check[@]}" | tee "m3-results/$name.verdict"
}
mkdir -p m3-results
dmesg > m3-results/dmesg-before.log
run_check vector-8 0 8
run_check edge-low32 0xffffffc0 4
run_check high-word 0x100000000 4
run_check edge-u64 0xffffffffffffff80 2
run_check threshold-zero 0 8 0
run_check threshold-half 0 64 0x8000000000000000
run_check threshold-receive 0 64 0xfffffe0000000000
dmesg > m3-results/dmesg-after.log
if ! cmp -s m3-results/dmesg-before.log m3-results/dmesg-after.log; then
  echo "dmesg changed during M3 gate run; inspect m3-results/dmesg-*.log" >&2
  exit 5
fi
echo "M3 exact-output and threshold gates passed; dmesg snapshots match"
