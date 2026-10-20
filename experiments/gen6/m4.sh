#!/usr/bin/env bash
# Run on lemox after build-m4.sh. Logs each solve and independently validates it.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p session9
root_t=0000000000000000000000000000000000000000000000000000000000000001
root_b=718cc2121c3e641059bc1c2cfc45666c99e8ae922f7a807b7d07b62c995d79e2
workers=${CPU_WORKERS:-3}
solve() {
  local logfile=$1; shift
  ./snb-pow "$@" 2>&1 | tee "$logfile"
  python3 verify-snb-pow.py "$logfile" | tee "${logfile%.log}-validate.log"
}
python3 test-blake8.py
./test-snb-pow
for mode in cpu gpu hybrid; do
  solve "session9/smoke-$mode.log" --mode "$mode" --root "$root_t" --threshold 1 --cpu-workers "$workers"
done
if ./snb-pow --mode gpu --root "$root_t" --threshold 0xffffffffffffffff --max-hashes 1000003 |
  tee session9/bounded.log; then
  echo 'unexpected hit in deterministic bounded fixture' >&2; exit 1
else
  rc=${PIPESTATUS[0]}; [[ $rc == 3 ]] || exit "$rc"
fi
# Same predeclared starting ranges for every mode, avoiding three repeats of
# the unusually lucky first receive solution. These are solve times, not a
# replacement for the fixed-work throughput comparison.
for base in 0 0x10000000 0x20000000; do
  for mode in cpu gpu hybrid; do
    solve "session9/receive-$mode-$base.log" --mode "$mode" --root "$root_b" \
      --base "$base" --threshold 0xfffffe0000000000 --cpu-workers "$workers"
  done
done
solve session9/send-hybrid.log --mode hybrid --root "$root_b" \
  --threshold 0xfffffff800000000 --cpu-workers "$workers"
