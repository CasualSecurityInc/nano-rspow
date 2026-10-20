#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ROOT=718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2
mkdir -p m3-results
dmesg > m3-results/bench-dmesg-before.log
for n in 64 256 1024 4096; do
  echo "== benchmark threads=$n duration=2000ms"
  ./snb-m3 --submit --kernel m3.bin --root "$ROOT" --base 0 --threads "$n" --bench-ms 2000 \
    2>&1 | tee "m3-results/bench-$n.log"
done
echo "== one-thread launch overhead duration=1000ms"
./snb-m3 --submit --kernel m3.bin --root "$ROOT" --base 0 --threads 1 --bench-ms 1000 \
  2>&1 | tee m3-results/bench-1.log
dmesg > m3-results/bench-dmesg-after.log
if ! cmp -s m3-results/bench-dmesg-before.log m3-results/bench-dmesg-after.log; then
  echo "dmesg changed during benchmark; inspect before/after logs" >&2
  exit 5
fi
