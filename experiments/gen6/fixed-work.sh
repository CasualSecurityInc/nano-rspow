#!/usr/bin/env bash
# Two reversed-order passes over identical bounded work, with real solver scans.
set -euo pipefail
cd "$(dirname "$0")"
for round in 1 2; do
  configs='gpu:0 cpu:3 hybrid:3 hybrid:1'
  if ((round == 2)); then configs='hybrid:1 hybrid:3 cpu:3 gpu:0'; fi
  for cfg in $configs; do
    mode=${cfg%:*}; workers=${cfg#*:}
    echo "FIXED round=$round mode=$mode workers=$workers loadavg=$(cat /proc/loadavg)"
    if ((workers == 0)); then workers=1; fi
    if ./snb-pow --mode "$mode" --cpu-workers "$workers" \
      --root 718cc2121c3e641059bc1c2cfc45666c99e8ae922f7a807b7d07b62c995d79e2 \
      --base 0x30000000 --threshold 0xffffffffffffffff --max-hashes 8388608; then
      echo 'unexpected hit in deterministic fixture' >&2; exit 1
    else
      rc=$?; [[ $rc == 3 ]] || exit "$rc"
    fi
  done
done
