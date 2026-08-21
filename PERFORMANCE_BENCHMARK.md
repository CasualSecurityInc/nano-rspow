# nano-rspow Benchmark Results

Last refreshed: 2026-08-21

These measurements were produced from the current `main` checkout at commit
`61ad37a`, using the release CLI built from workspace version `0.12.1`.
They are host-specific, probabilistic PoW timings, not product-wide performance
guarantees.

## Environment

| Property | Value |
| --- | --- |
| OS | macOS 26.5.2 (25F84) |
| Architecture | arm64 |
| Rust | 1.95.0-aarch64-apple-darwin |
| CLI | `nano-rspow 0.12.1` |
| Commit | `61ad37a` |

The native GPU and OpenCL diagnostic commands both reported `backend
unavailable` on this host. Therefore this refresh contains CPU results only;
it does not repeat historical GPU numbers from a different build or setup.

## CPU results

The CLI uses the default benchmark root
`718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2`.
Each listed five-sample suite was run separately with the specified tier and
mode; this avoids treating the current runner's 30-second command limit as a
measurement result.

| Backend | Mode | Tier | Threshold | Samples | Min (ms) | Max (ms) | Mean (ms) | Median (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `cpu` | `cold` | `dev` | `0xfe00000000000000` | 5 | 0.1 | 1.5 | 0.4 | 0.1 |
| `cpu` | `warm` | `dev` | `0xfe00000000000000` | 5 | 0.0 | 0.1 | 0.0 | 0.0 |
| `cpu` | `cold` | `ep2_recv` | `0xfffffe0000000000` | 5 | 16.4 | 927.1 | 394.6 | 310.5 |
| `cpu` | `warm` | `ep2_recv` | `0xfffffe0000000000` | 5 | 43.5 | 907.1 | 372.6 | 226.3 |
| `cpu` | `cold` | `legacy_epoch1` | `0xffffffc000000000` | 5 | 87.7 | 12704.5 | 4952.2 | 2482.8 |
| `cpu` | `warm` | `legacy_epoch1` | `0xffffffc000000000` | 5 | 1443.1 | 3212.6 | 2497.8 | 2493.2 |
| `cpu` | `cold` | `ep2_send` | `0xfffffff800000000` | 1 | 3633.9 | 3633.9 | 3633.9 | 3633.9 |
| `cpu` | `warm` | `ep2_send` | — | — | — | — | — | — |

The warm `ep2_send` run did not finish before the runner's 30-second foreground
limit. It is omitted rather than represented by an incomplete value. The cold
`ep2_send` row has one sample only and is not suitable for comparisons.

## Reproduce

Run the following from the repository root on a host with Rust available:

```bash
cargo check --all-targets
cargo build -p nano-rspow-cli --all-features --release
./target/release/nano-rspow diag --backend gpu --format json
./target/release/nano-rspow diag --backend opencl --format json
./target/release/nano-rspow benchmark --count 5 --format markdown --backend cpu
```

For a full report across all configured CLI backends, use the project command:

```bash
cargo run --all-features --release -- benchmark --format markdown --backend all
```
