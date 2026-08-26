# nano-rspow CLI performance

This file records the latest known-good release-mode CLI measurements. Use
[`PERFORMANCE_OBSERVATIONS.md`](PERFORMANCE_OBSERVATIONS.md) for benchmark
procedures, browser measurements, and interpretation rules.

## Latest known-good run

Collected 2026-08-26 from commit `1b785f6` (`nano-rspow 0.17.0`) on macOS
26.5.2 (25F84), arm64, Rust 1.98.0-aarch64-apple-darwin. The benchmark root
was `718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2`.
Every listed row contains five samples.

The CPU rows used:

```bash
./target/release/nano-rspow benchmark --count 5 --format markdown \
  --backend cpu --mode both
```

The WGPU rows used:

```bash
./target/release/nano-rspow benchmark --count 5 --format markdown \
  --backend gpu --tier all --mode both
```

### CPU

| Mode | Tier | Threshold | Min (ms) | Max (ms) | Mean (ms) | Median (ms) |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| cold | dev | `0xfe00000000000000` | 0.1 | 0.6 | 0.2 | 0.1 |
| warm | dev | `0xfe00000000000000` | 0.0 | 0.0 | 0.0 | 0.0 |
| cold | receive | `0xfffffe0000000000` | 8.1 | 1355.2 | 338.9 | 132.2 |
| warm | receive | `0xfffffe0000000000` | 71.9 | 465.6 | 258.6 | 231.4 |
| cold | legacy_epoch1 | `0xffffffc000000000` | 87.9 | 5975.3 | 3024.8 | 3193.8 |
| warm | legacy_epoch1 | `0xffffffc000000000` | 424.1 | 4768.4 | 2076.5 | 2135.1 |
| cold | send | `0xfffffff800000000` | 1709.9 | 49061.3 | 17276.9 | 5826.2 |
| warm | send | `0xfffffff800000000` | 6662.4 | 76768.5 | 25486.5 | 7374.5 |

### WGPU

The host reported WGPU through Metal on an Apple M1, with tuning source
`Cache`. OpenCL was unavailable.

| Mode | Tier | Threshold | Min (ms) | Max (ms) | Mean (ms) | Median (ms) |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| cold | dev | `0xfe00000000000000` | 12.7 | 14.2 | 13.2 | 13.2 |
| cold | receive | `0xfffffe0000000000` | 17.5 | 207.3 | 71.2 | 46.6 |
| cold | legacy_epoch1 | `0xffffffc000000000` | 104.9 | 1119.5 | 479.4 | 402.2 |
| cold | send | `0xfffffff800000000` | 942.7 | 2445.3 | 1972.2 | 2130.6 |
| warm | dev | `0xfe00000000000000` | 1.4 | 1.4 | 1.4 | 1.4 |
| warm | receive | `0xfffffe0000000000` | 22.4 | 111.1 | 48.9 | 36.5 |
| warm | legacy_epoch1 | `0xffffffc000000000` | 23.3 | 817.2 | 265.5 | 175.9 |
| warm | send | `0xfffffff800000000` | 618.0 | 3480.1 | 2269.0 | 2705.7 |

## Material baseline shifts

One line per release-level refresh. Keep this log limited to material changes;
do not copy every sample into the history.

```text
2026-08-26 | 0.17.0 | 1b785f6 | CPU receive and legacy means lower than 0.12.1; legacy cold median higher; five-sample send now complete; WGPU available, OpenCL unavailable.
2026-08-21 | 0.12.1 | 61ad37a | CPU-only baseline; send had one cold sample and no warm result because the external runner stopped the suite.
```

These are host-specific randomized-search measurements. A change in mean or
median is not a performance regression without equivalent host, backend,
threshold, mode, build, and sample-count conditions.
