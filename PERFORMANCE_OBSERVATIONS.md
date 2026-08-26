# nano-rspow Performance Observations

Last reviewed: 2026-08-21

This file records only observations supported by the current release build and
the accompanying [`PERFORMANCE_BENCHMARK.md`](PERFORMANCE_BENCHMARK.md).
Earlier browser, tuning, and cross-build comparisons were removed because they
were not rerun with this checkout and would otherwise read as current results.

## What this refresh establishes

- The workspace at `61ad37a` passes `cargo check --all-targets` with Rust
  1.95.0, and `nano-rspow-cli` builds in release mode as version `0.12.1`.
- The host is macOS 26.5.2 on arm64. It reports both native GPU and OpenCL
  backends as unavailable, so no accelerator result is asserted.
- Five CPU samples were collected for `dev`, `receive`, and
  `legacy_epoch1` in both cold and warm modes. See the benchmark report for
  the raw summary statistics.
- `send` was observed once in cold mode at 3633.9 ms. Its warm run was not
  recorded because it exceeded the runner's 30-second foreground limit.

## Interpretation limits

Nano PoW generation is a randomized search. A single duration, and especially
the one-sample `send` result, is not an estimate of expected throughput.
Compare repeated runs on the same machine and report the distribution, backend
availability, mode, threshold, and release build used. Do not compare these CPU
results with older browser or GPU figures collected from different builds.

## Next measurement needed

Run the full release command on an accelerator-capable host, with a duration
limit long enough to complete the five-sample `send` warm and cold suites:

```bash
cargo run --all-features --release -- benchmark --format markdown --backend all
```
