#!/usr/bin/env python3
import re
import statistics
import sys
from pathlib import Path
folder = Path(sys.argv[1])
medians = {}
for mode in ('cpu', 'gpu', 'hybrid'):
    samples = []
    for path in sorted(folder.glob(f'receive-{mode}-*.log')):
        if path.name.endswith('-validate.log'):
            continue
        s = path.read_text()
        m = re.search(r'STATS wall=([0-9.]+)s gpu=(\d+) cpu=(\d+) total=(\d+).*total_rate=([0-9.]+)', s)
        if not m or 'SOLVED' not in s:
            raise SystemExit(f'incomplete solve {path}')
        wall = float(m[1]); samples.append(wall)
        print(f'{path.name}: wall={wall:.6f}s hashes={m[4]} rate={m[5]} MH/s')
    if samples:
        medians[mode] = statistics.median(samples)
        print(f'{mode}: n={len(samples)} median={medians[mode]:.6f}s')
if len(medians) == 3:
    print('fastest receive median:', min(medians, key=medians.get))
    print('Small deterministic matched-range sample; use fixed work to assess throughput separately.')
