#!/usr/bin/env bash
# Explicit, bounded watcher: one qualification attempt within the next 24 hours.
# --once only checks the current window; never changes services/clocks/cooling.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p session10
exec 9>session10/requalify.lock
flock -n 9 || { echo 'A requalification watcher is already active'; exit 0; }
sleep_pid=
trap 'if [[ -n $sleep_pid ]]; then kill "$sleep_pid" 2>/dev/null || :; fi; exit 143' TERM
trap 'if [[ -n $sleep_pid ]]; then kill "$sleep_pid" 2>/dev/null || :; fi; exit 130' INT
check() {
  python3 - <<'PY'
from pathlib import Path
import glob
load = float(Path('/proc/loadavg').read_text().split()[0])
temps = [int(Path(p).read_text()) for p in glob.glob('/sys/class/thermal/thermal_zone*/temp')]
pressure = Path('/proc/pressure/cpu')
p = float(pressure.read_text().split('avg10=')[1].split()[0]) if pressure.exists() else 0
peak = max(temps, default=100000)
print(f'load={load:.2f} CPU_pressure_avg10={p:.2f}% max_temp_mC={peak}', flush=True)
# Require a cool, quiet start; do not create "idle" by stopping host workloads.
raise SystemExit(0 if load < 0.20 and p < 5 and peak < 85000 else 75)
PY
}
for ((attempt=1; attempt<=288; ++attempt)); do
  echo "WINDOW attempt=$attempt time=$(date -Is)"
  if check; then
    stamp=$(date +%Y%m%d-%H%M%S)
    bash idle-bench.sh | tee "session10/requalify-idle-$stamp.log"
    python3 fit.py "session10/requalify-idle-$stamp.log"
    SUSTAIN_SAMPLES="session10/requalify-clocks-$stamp.csv" bash sustain.sh |
      tee "session10/requalify-sustain-$stamp.log"
    echo "DONE time=$(date -Is)"; exit 0
  fi
  if [[ ${1:-} == --once ]]; then exit 75; fi
  if ((attempt < 288)); then sleep 300 & sleep_pid=$!; wait "$sleep_pid"; sleep_pid=; fi
done
echo 'No cool quiet window in 24 hours' >&2; exit 1
