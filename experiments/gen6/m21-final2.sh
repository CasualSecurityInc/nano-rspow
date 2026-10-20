#!/usr/bin/env bash
# Run on lemox in a directory containing snb-m21, probe .bin files and check.py.
# Optional arguments select named cases; an empty list runs the entire sequence.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p session6
selected=" $* "
log_pid=""
cleanup() {
  if [ -n "$log_pid" ]; then kill "$log_pid" 2>/dev/null || true; fi
  dmesg > session6/dmesg-after.log
}
trap cleanup EXIT
dmesg > session6/dmesg-before.log
dmesg -w > session6/dmesg-stream.log &
log_pid=$!
run() {
  local name=$1 kernel=$2 mode=$3
  shift 3
  if [ "$selected" != "  " ] && [[ "$selected" != *" $name "* ]]; then return; fi
  echo "== $name: kernel=$kernel validation=$mode"
  if ! ./snb-m21 --submit --kernel "$kernel" --dump "session6/payload-$name.bin" "$@" > "session6/$name.log" 2>&1; then
    cat "session6/$name.log"
    return 1
  fi
  head -1 "session6/$name.log"
  python3 check.py "session6/payload-$name.bin" "$mode" | tee "session6/$name.verdict"
}
run nodispatch pattern128 ctl --no-dispatch
run eot eot ctl
run pattern16 pattern16 pattern16
run pattern128 pattern128 pattern128
run pattern256 pattern256 pattern256
run a0 dump a0
run a0magic dump a0magic --inline 0xfeed0000,0xfeed0001,0xfeed0002,0xfeed0003,0xfeed0004,0xfeed0005,0xfeed0006,0xfeed0007
run a1 dump2 a1
run slots4 slots slots4 --count 4
run slots60 slots slots60 --count 60
run lane lane lane
run arith arith arith
