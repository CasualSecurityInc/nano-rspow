# Nano-rspow performance benchmarking guide

This document defines how to collect and interpret measurements. The latest
known-good native CLI numbers are in
[`PERFORMANCE_BENCHMARK.md`](PERFORMANCE_BENCHMARK.md).

## Scope

Use this guide for native CLI measurements and browser measurements from the
`nano-rspow-web` package or the local comparison dashboard. Record the commit,
workspace version, Rust version, operating system, architecture, backend,
threshold, mode, sample count, and hardware before comparing results.

These measurements describe one host and one build. Nano proof-of-work is a
randomized search, so a single duration is not a throughput guarantee.

## The three benchmarking surfaces

These are three separate things that all look like "the benchmark". They measure
different subjects, are run in different ways, and do not produce interchangeable
numbers. Do not conflate them, and do not file one surface's results under
another.

| # | Surface | What it actually measures | Run it with | Durable record? |
| --- | --- | --- | --- | --- |
| 1 | **Core `nano-rspow` benchmark** | The Rust crate only, in a terminal. CPU, WGPU and OpenCL backends across dev/receive/legacy-epoch1/send tiers, cold and warm. | `./target/release/nano-rspow benchmark --count 5 --format markdown --backend all` | **Yes.** This is the only surface whose numbers belong in [`PERFORMANCE_BENCHMARK.md`](PERFORMANCE_BENCHMARK.md). |
| 2 | **Browser-only "Nano PoW Benchmarking" page** (`nano-rspow-web/browser-demo`) | The `nano-rspow-web` package alone, inside one browser tab: its WebGPU path against its single-threaded WASM CPU fallback. Client-side only, no server, no native addon. | `make web-demo` | **No.** Nothing is written anywhere. The results exist in the page's console and in whatever you screenshot. |
| 3 | **Head-to-head comparison suite** (`nano-rspow-web/benchmark-compare`) | Several providers side by side: `nano-rspow-web` against `nano-pow`, the `nano-rspow-node` native addon, and the Rust CLI work peer. Needs a local dev server and a running work peer. | `make web-compare-run` | **No.** Same as above. |

Consequences worth respecting:

- **Only surface 1 has a filing step, and it is manual.** The CLI prints markdown
  to stdout; nothing in the repository writes `PERFORMANCE_BENCHMARK.md` for you.
  Somebody has to transcribe the rows. If you run surface 1, file the result or
  say that you did not.
- **Never put surface 2 or 3 numbers in `PERFORMANCE_BENCHMARK.md`.** That file is
  the native CLI record. A browser wall-clock duration is not a native tier
  measurement, and the comparison rules at the end of this document explicitly
  forbid mixing them.
- **Surfaces 2 and 3 are per-session.** Their numbers are only meaningful
  alongside the browser, adapter, threshold, sample count, and whether
  first-call initialization was included. There is no baseline to diff them
  against later.
- **Surface 3 is a local experiment and is not guaranteed reproducible.** The
  competitor list is data in `app.js` (`COMPETITORS`) and can be edited for a
  specific investigation, so two runs of "the dashboard" may not have compared
  the same set. When reporting from it, name the providers that were actually
  selected.
- **None of the three run in CI.** `web-browser-tests.yml` builds the
  browser-only dashboard and runs the shared-generator concurrency test. It
  produces no benchmark numbers at all, so no figure in this repository
  refreshes itself.

All three are manually run, occasionally, and none of them is on a schedule.

## Native CLI benchmark

### Build and inspect the host

Run the release build from the repository root:

```bash
cargo check --all-targets
cargo build -p nano-rspow-cli --all-features --release
./target/release/nano-rspow --version
./target/release/nano-rspow diag --backend gpu --format json
./target/release/nano-rspow diag --backend opencl --format json
```

The diagnostic output identifies the selected GPU API, adapter, dispatch
configuration, tuning source, and whether OpenCL is available. Do not compare
accelerator results with a CPU-only run.

### Run the standard suite

The benchmark defaults to five samples for every selected tier and mode. Use
the explicit count when a report must be reproducible:

```bash
cargo run --all-features --release -- \
  benchmark --count 5 --format markdown --backend all
```

The command covers `dev`, `receive`, `legacy-epoch1`, and `send` tiers in cold
and warm modes. `legacy-epoch1` is a historical comparison tier, not a current
mainnet default. The CLI prints it as `legacy_epoch1` in result tables.

Run one backend or tier when a complete all-backend run would exceed the
foreground limit of an external runner:

```bash
./target/release/nano-rspow benchmark --count 5 --format markdown \
  --backend cpu --tier receive --mode both
./target/release/nano-rspow benchmark --count 5 --format markdown \
  --backend gpu --tier all --mode both
```

Use a persistent terminal for the `send` tier. If an external runner kills the
process, discard the partial report. The CLI itself does not reduce the sample
count when a tier takes longer than expected.

### Interpret native results

- `cold` constructs the backend inside each timed sample.
- `warm` reuses the backend across samples.
- `--count N` sets the number of samples per selected tier and mode.
- `mean` is sensitive to unusually long randomized searches.
- `median`, `min`, `max`, and the sample count must remain in the report.
- Compare rows only when the hash, threshold, mode, backend, build profile, and
  host are equivalent.
- Record GPU tuning-cache state. A retuned run is not equivalent to a cached
  run; use the CLI's `--retune` option when intentionally collecting a fresh
  tuning result.
- Treat unavailable GPU or OpenCL backends as availability observations, not
  zero-duration measurements.

The default benchmark root is:

```text
718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2
```

### Native comparison checklist

Record these fields with every refresh:

| Field | Required value |
| --- | --- |
| Workspace version and commit | `cargo` package version and `git rev-parse --short HEAD` |
| Toolchain | `rustc --version` |
| Host | OS version, architecture, and CPU/GPU model |
| Backend state | CLI diagnostics for GPU and OpenCL |
| Work input | Benchmark root and threshold values |
| Sampling | Count, tier, mode, and min/max/mean/median |
| Build profile | Release (`--release`) |

## Browser and WebAssembly benchmark

### Package-level benchmark

Build the WebAssembly package before timing it:

```bash
cd nano-rspow-web
npm run build
```

Initialize the module before the first timed call. Exclude initialization from
steady-state samples. This complete example measures the automatic backend:

```javascript
import init, { generate_work } from 'nano-rspow-web';

const hash = '718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2';
const threshold = 'fffffff800000000';

await init();
const started = performance.now();
const result = await generate_work(hash, threshold);
const elapsedMs = performance.now() - started;
console.log({ elapsedMs, isGpu: result.is_gpu });
```

Use `generate_work_gpu` to measure the forced WebGPU path and
`generate_work_cpu` to measure the single-threaded WebAssembly fallback. Use
`generate_work` only when measuring automatic backend selection. Record the
returned `is_gpu` value for every sample.

### Browser-only dashboard

`nano-rspow-web/browser-demo` is surface 2 from the table above: the
`nano-rspow-web` package measured on its own, in one browser tab, with no server
and no native addon. It is the same subject as the package-level snippet above,
as a page you can drive by hand:

```bash
make web-demo          # build and open it
make web-demo-check    # confirm the built page is present and current
```

The page benchmarks its WebGPU path against its Web Worker CPU fallback across
the dev, receive and send difficulty levels, and reports elapsed time with local
nonce validation. `index.html` is generated and gitignored, so the copy on disk
is always the one built from the current sources.

Two things to know when reading numbers off this page:

- The generator is built once per page load and reused, so **the first
  generation on a page includes WebGPU bring-up** (device, pipeline, buffers)
  and later ones do not. The page logs that cost as
  `Initialization complete in <n> ms`. Discard the first sample, or report it
  separately, unless you specifically want bring-up.
- Nothing is written to disk. If a number from this page matters later, it has
  to be transcribed by hand along with the environment it came from.

### Local comparison dashboard

The dashboard in `nano-rspow-web/benchmark-compare` is surface 3 from the table
above. It compares the `nano-rspow-web` module, the local Rust work peer, the
Node addon, and the pinned `nano-pow` provider:

```bash
make web-prereqs      # once, per checkout
make web-compare-run  # build and serve on http://localhost:8080/
```

The WebAssembly module is compiled from source by the build, so the page always
measures the current crate. It builds the Rust CLI in release mode, starts the
work peer on `127.0.0.1:7076`, and serves the dashboard on
`http://localhost:8080/`. Set `WORK_PEER_BACKEND=cpu` to avoid host-dependent GPU
selection. Set `NANO_WORK_URL` when the proxy must use an existing work peer.
Press `Ctrl-C` once to stop the supervisor and both child processes.

The dashboard runs 42 paired searches per selected provider. It records each
raw duration and does not calculate an average. It excludes browser HTTP/fetch
time from the provider duration and validates each returned nonce against the
current send threshold.

### Browser comparison checklist

Record the browser and version, page visibility state, WebGPU availability and
adapter, WebAssembly build commit, provider, threshold, root-generation rule,
sample count, and whether the first-call initialization was excluded.

Do not compare dashboard provider durations with browser wall-clock time or
with native CLI timings unless the measured interval and workload are the same.
Background tabs can be throttled. WebGPU adapter selection and shader startup
can affect early samples. The CPU WebAssembly fallback is single-threaded.

## Reporting rule

Put full current CLI rows in `PERFORMANCE_BENCHMARK.md`. That is surface 1 only —
never surface 2 or surface 3, whose numbers are not the same measurement. Add
only material baseline shifts to its one-line release log. Keep methods,
caveats, and browser instructions here so the results file stays compact.

Filing is a manual step. The CLI emits markdown to stdout and nothing in this
repository writes the results file for you. If you refresh a native number,
either update `PERFORMANCE_BENCHMARK.md` in the same change or say explicitly
that you did not.
