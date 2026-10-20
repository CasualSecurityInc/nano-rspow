#!/usr/bin/env python3
"""Summarize rate and sampled-clock telemetry from an SNB sustained run."""
import argparse
import csv
import re
import statistics as stats
import sys

BUCKET_RE = re.compile(
    r"BUCKET k=(\d+) elapsed=([\d.]+)s rate=([\d.]+) MH/s "
    r"full=(\d+) start_ns=(\d+) end_ns=(\d+)"
)
START_TEMP_RE = re.compile(r"start_temp_mC=(\d+)")
RECEIVE, SEND, P95_MULTIPLIER = 1 << 23, 1 << 29, 3.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("log")
    parser.add_argument("csv")
    parser.add_argument("--cpu-mhs", type=float, default=3.29)
    args = parser.parse_args()

    buckets = []
    start_temp = None
    with open(args.log, encoding="utf-8") as stream:
        for line in stream:
            match = BUCKET_RE.search(line)
            if match:
                k, _elapsed, rate, full, start, end = match.groups()
                buckets.append({
                    "k": int(k), "rate": float(rate), "full": int(full),
                    "start": int(start), "end": int(end),
                })
            match = START_TEMP_RE.search(line)
            if match:
                start_temp = int(match.group(1)) // 1000

    samples = []
    with open(args.csv, newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            samples.append((int(row["monotonic_ns"]), int(row["actual_MHz"]),
                            int(row["requested_MHz"]), int(row["max_temp_mC"])))

    full = [bucket for bucket in buckets if bucket["full"]]
    if not full:
        print("no full buckets found", file=sys.stderr)
        return 1
    if not samples:
        print("no telemetry samples found", file=sys.stderr)
        return 1

    def mean_clock(start: int, end: int):
        """Integrate the sampled clock over a bucket using linear interpolation."""
        area = 0.0
        covered = 0
        for a, b in zip(samples, samples[1:]):
            lo, hi = max(start, a[0]), min(end, b[0])
            if hi <= lo or not a[1] or not b[1]:
                continue

            def at(t: int) -> float:
                return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0])

            area += (at(lo) + at(hi)) * 0.5 * (hi - lo)
            covered += hi - lo
        if covered != end - start:
            return None
        return area / covered

    elapsed = 0.0
    cumulative_hashes = 0.0
    for bucket in full:
        in_bucket = [s for s in samples if bucket["start"] <= s[0] < bucket["end"]]
        bucket["dt"] = (bucket["end"] - bucket["start"]) / 1e9
        bucket["mhz"] = mean_clock(bucket["start"], bucket["end"])
        bucket["temp"] = max((s[3] for s in in_bucket), default=0) // 1000
        bucket["hashes"] = bucket["rate"] * 1e6 * bucket["dt"]
        elapsed += bucket["dt"]
        cumulative_hashes += bucket["hashes"]
        bucket["t_end"] = elapsed
        bucket["cum"] = cumulative_hashes

    print("| k | end s | rate MH/s | mean MHz | max °C | MH/s/GHz | cumulative M |")
    print("|--:|--:|--:|--:|--:|--:|--:|")
    for bucket in full:
        per_ghz = (bucket["rate"] / bucket["mhz"] * 1000
                   if bucket["mhz"] else 0)
        print(f"| {bucket['k']} | {bucket['t_end']:.1f} | {bucket['rate']:.3f} | "
              f"{bucket['mhz'] or 'n/a'} | {bucket['temp']} | {per_ghz:.2f} | "
              f"{bucket['cum']/1e6:.1f} |")

    first, last = full[0], full[-1]
    equilibrium = stats.mean(bucket["rate"] for bucket in full[-3:])
    normalized = ((last["rate"] / last["mhz"]) /
                  (first["rate"] / first["mhz"])) if first["mhz"] and last["mhz"] else float("nan")
    per_clock = [bucket["rate"] / bucket["mhz"] * 1000
                 for bucket in full if bucket["mhz"]]
    print(f"\nStart {start_temp if start_temp is not None else 'unknown'}°C; "
          f"burst {first['rate']:.3f} MH/s @ {first['mhz']} MHz; "
          f"equilibrium {equilibrium:.3f} MH/s; "
          f"raw retention {last['rate']/first['rate']:.3f}; "
          f"clock-normalized {normalized:.3f}")
    print(f"Per-clock mean {stats.mean(per_clock):.2f} MH/s/GHz "
          f"(min {min(per_clock):.2f}, max {max(per_clock):.2f}); "
          f"sampled peak {max(sample[3] for sample in samples)/1000:.1f}°C")

    def estimated_time(target_hashes: float) -> float:
        previous_hashes = previous_seconds = 0.0
        for bucket in full:
            if bucket["cum"] >= target_hashes:
                return previous_seconds + (
                    (target_hashes - previous_hashes) / bucket["hashes"] * bucket["dt"]
                )
            previous_hashes, previous_seconds = bucket["cum"], bucket["t_end"]
        return previous_seconds + (target_hashes - previous_hashes) / (equilibrium * 1e6)

    print(f"\n| work | hashes | GPU warm s | CPU s @ {args.cpu_mhs:g} MH/s | speedup |")
    print("|---|--:|--:|--:|--:|")
    for name, mean_hashes in (("receive", RECEIVE), ("send", SEND)):
        for label, multiplier in (("mean", 1.0), ("p95", P95_MULTIPLIER)):
            hashes = mean_hashes * multiplier
            gpu_seconds = estimated_time(hashes)
            cpu_seconds = hashes / (args.cpu_mhs * 1e6)
            print(f"| {name} {label} | {hashes/1e6:.1f}M | {gpu_seconds:.2f} | "
                  f"{cpu_seconds:.2f} | {cpu_seconds/gpu_seconds:.2f}x |")
    print("\nWorkload times beyond the measured buckets extrapolate at the final-three-bucket mean.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
