#!/usr/bin/env bash
# Run on lemox after build-m4.sh; no services are stopped to manufacture idle.
set -euo pipefail
cd "$(dirname "$0")"
limit=${IDLE_WAIT_SECONDS:-120}
idle=0
for ((waited=0; waited<=limit; waited+=10)); do
  load=$(cut -d' ' -f1 /proc/loadavg)
  if awk -v l="$load" 'BEGIN { exit !(l < 0.30) }'; then idle=1; break; fi
  if ((waited < limit)); then sleep 10; fi
done
if ((idle)); then echo "HOST idle-gate=PASS load=$load"; else echo "HOST idle-gate=FAIL load=$load; rates directional"; fi
cpu=$(python3 - <<'PY'
import os, time
def snapshot():
    result = {}
    for line in open('/proc/stat'):
        p = line.split()
        if p[0].startswith('cpu') and p[0][3:].isdigit():
            x = list(map(int, p[1:9]))
            result[int(p[0][3:])] = (sum(x), x[3] + x[4])
    return result
a = snapshot(); time.sleep(1); b = snapshot()
def busy(c):
    total = b[c][0] - a[c][0]
    return 1 - (b[c][1] - a[c][1]) / total if total else 1
print(min(os.sched_getaffinity(0), key=busy))
PY
)
echo "HOST affinity=cpu$cpu loadavg=$(cat /proc/loadavg)"
for round in 1 2 3 4 5; do
  widths='16 8'; if ((round % 2 == 0)); then widths='8 16'; fi
  for lanes in $widths; do
    echo "SAMPLE round=$round lanes=$lanes loadavg=$(cat /proc/loadavg)"
    taskset -c "$cpu" ./snb-m3 --submit --kernel "m3-12-l${lanes}-pred.bin" --lanes "$lanes" \
      --root 718cc2121c3e641059bc1c2cfc45666c99e8ae922f7a807b7d07b62c995d79e2 \
      --base 0 --threads 4096 --threshold 0xfffffe0000000000 --bench-ms 3000
    sleep 1
  done
done
