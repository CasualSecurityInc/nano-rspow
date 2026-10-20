#!/usr/bin/env python3
"""Sample actual frequency during exact benchmark buckets, not just after them."""
import csv
import glob
import os
from pathlib import Path
import re
import subprocess
import threading
import time

freqs = glob.glob('/sys/class/drm/card[0-9]*/gt_act_freq_mhz')
if not freqs:
    raise SystemExit('no actual-frequency sysfs node; cannot normalize clocks')
freq = Path(freqs[0])
requested = freq.with_name('gt_cur_freq_mhz')
temps = [Path(p) for p in glob.glob('/sys/class/thermal/thermal_zone*/temp')]
samples = []
stop = threading.Event()
def read(path):
    try:
        return int(path.read_text().strip())
    except (OSError, ValueError):
        return 0
def sample():
    samples.append((time.monotonic_ns(), read(freq), read(requested),
                    max((read(p) for p in temps), default=0)))
def monitor():
    while not stop.wait(0.2):
        sample()
sample()
thread = threading.Thread(target=monitor)
thread.start()
command = ['./snb-m3', '--submit', '--kernel', 'm3-12-l16-pred.bin', '--lanes', '16',
           '--root', '718cc2121c3e641059bc1c2cfc45666c99e8ae922f7a807b7d07b62c995d79e2',
           '--base', '0', '--threads', '4096', '--threshold', '0xfffffe0000000000',
           '--bench-ms', os.getenv('SUSTAIN_MS', '120000'),
           '--bucket-ms', os.getenv('BUCKET_MS', '5000')]
print(f'MONITOR frequency={freq} sample_interval_s=0.2 start_temp_mC={samples[0][3]}', flush=True)
buckets = []
try:
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as child:
        for line in child.stdout:
            print(line, end='', flush=True)
            m = re.search(r'^BUCKET .*rate=([0-9.]+).*full=(\d) start_ns=(\d+) end_ns=(\d+)', line)
            if m and m[2] == '1':
                buckets.append((float(m[1]), int(m[3]), int(m[4])))
        status = child.wait()
finally:
    stop.set(); thread.join(); sample()
output = Path(os.getenv('SUSTAIN_SAMPLES', 'sustain-telemetry.csv'))
output.parent.mkdir(parents=True, exist_ok=True)
with output.open('w') as f:
    writer = csv.writer(f)
    writer.writerow(['monotonic_ns', 'actual_MHz', 'requested_MHz', 'max_temp_mC'])
    writer.writerows(samples)
print(f'MONITOR samples={len(samples)} max_temp_mC={max(s[3] for s in samples)} csv={output}', flush=True)
if status:
    raise SystemExit(status)
def mean_clock(start, end):
    area = covered = 0
    for a, b in zip(samples, samples[1:]):
        lo, hi = max(start, a[0]), min(end, b[0])
        if hi <= lo or not a[1] or not b[1]:
            continue
        def at(t):
            return a[1] + (b[1]-a[1]) * (t-a[0]) / (b[0]-a[0])
        area += (at(lo)+at(hi))/2 * (hi-lo)
        covered += hi-lo
    return area/covered if covered == end-start else None
if len(buckets) >= 2:
    first, last = buckets[0], buckets[-1]
    a, b = mean_clock(*first[1:]), mean_clock(*last[1:])
    raw = last[0]/first[0]
    print(f'RAW_RETENTION={raw:.3f} gate={"PASS" if raw >= 0.75 else "FAIL"}', flush=True)
    if a and b:
        normalized = (last[0]/b)/(first[0]/a)
        print(f'CLOCK_NORMALIZED first_mean_MHz={a:.2f} last_mean_MHz={b:.2f} '
              f'retention={normalized:.3f}; sampled association, not causal attribution', flush=True)
    else:
        print('CLOCK_NORMALIZED unavailable: incomplete clock coverage', flush=True)
