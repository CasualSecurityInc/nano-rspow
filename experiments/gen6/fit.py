#!/usr/bin/env python3
"""Summarize measured widths; a/b is an illustrative fit, not hardware attribution."""
import re
import statistics
import sys
rates = {8: [], 16: []}
for line in open(sys.argv[1]):
    m = re.search(r'^BENCH: .*lanes=(8|16).* rate=([0-9.]+) MH/s', line)
    if m:
        rates[int(m[1])].append(float(m[2]))
for width, xs in rates.items():
    if not xs:
        raise SystemExit(f'no measurements for SIMD{width}')
    print(f'SIMD{width}-pred n={len(xs)} median={statistics.median(xs):.3f} '
          f'min={min(xs):.3f} max={max(xs):.3f} MH/s')
gain = statistics.median(rates[16]) / statistics.median(rates[8])
k = gain * (4353/16) / (4339/8)
print(f'width gain={gain:.3f}x; illustrative cost ratio k={k:.3f}')
if 0.5 < k < 1:
    print(f'illustrative a/b={(16*k-8)/(1-k):.3f} lane-times; '
          'two throughput medians do not identify physical issue/decode costs')
