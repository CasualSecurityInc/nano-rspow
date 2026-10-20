# Session 10: M5 passed through the stock CLI

On lemox, the unchanged release nano-rspow CLI selected snbcl through the system
OpenCL loader, benchmarked both tiers, and generated work accepted independently
by Python hashlib and `nano-rspow validate`. All observed GPU reset counts stayed
7 → 7. No tracked Rust source or package version changed.

## Gate evidence

| Gate | Result | Evidence |
|---|---|---|
| M5-A loader smoke | PASS, exact source/args/events/buffers and receive solve | [smoke.log](session10/smoke.log) |
| M5-B real CLI selects shim | PASS, source MATCH and real enqueue/hit logs | [cli-benchmarks.log](session10/cli-benchmarks.log) |
| M5-C receive benchmark | PASS, CLI verification, reset-clean | [cli-benchmarks.log](session10/cli-benchmarks.log) |
| M5-D installed CLI generate/validate | PASS, Backend opencl | [installed-generate.log](session10/installed-generate.log), [validate](session10/generate-validate.log) |

Warm CLI benchmark samples, requested in receive-then-send order:

| Tier | Count | Min ms | Median ms | Max ms | Mean ms |
|---|---:|---:|---:|---:|---:|
| receive | 3 | 441.9 | 626.1 | 1470.9 | 846.3 |
| send | 1 | 17155.9 | 17155.9 | 17155.9 | 17155.9 |

Host load was 0.30 before receive, 0.27 afterward, and 0.21 after send. These are
stochastic solve samples, not fixed-work throughput or expected solve times.
Warm mode includes an untimed warmup: process hash counters include that work
and must not be divided by the timed table rows. No numbers were filed in the
repository's core benchmark report.

Installed CLI generation returned:

- Root: `718cc2121c3e641059bc1c2cfc45666c99e8ae922f7a807b7d07b62c995d79e2`
- Nonce: `723d20627034aadb`
- LE hash/difficulty: `ffffff98b5c790c0`
- Threshold: `fffffe0000000000`
- CLI time: 0.303 s; Backend: opencl; reset count 7 → 7.

The candidate was within the GPU portion of its batch. Independent hashlib
verification is in [work-hashlib.log](session10/work-hashlib.log).

## Implementation and checks

Recon pinned the eight arguments, uint flag, ulong result, 65,536-item enqueue,
and wrapping arbitrary nonce base to the checkout. The shader is 3,395 LF bytes,
SHA256 `1cc6245d56a927b24f99e5dec245256f4f66ef4c1efa3c47ef20444aaa741859`.
The actual ocl 0.19.7 builder prepends exactly two newlines; the narrow matcher
accepts that prefix and CRLF normalization, while refusing other programs.

The shim is 585 lines, shared engine 224, and refactored standalone solver 197.
It uses genuine ICD dispatch pointers, reference-counted objects, checked typed
arguments and buffers, and synchronous queue/event behavior. On this 64-bit host,
cl_mem and u64 have the same size: argument index determines type. It advertises
no int64 atomics. This is a restricted pow_kernel adapter, **not general OpenCL
conformance**, despite compatibility profile/version tokens.

The shared engine preserves proven GPU state/dispatch packers and checksum-pinned
kernels. Its fallible library helpers return errors rather than terminating the
CLI. Prefix/tail CPU handling covers arbitrary alignment and wrap; GPU candidates
are CPU-verified before publication.

Validation completed:

- Both engine widths, alignment and 32/64-bit boundaries, exact CPU tails,
  first-hit agreement, guards, reset gates and bad-kernel refusal.
- 2,004 independent CPU/hashlib cases and allocator regression checks.
- GPU/CPU/hybrid bounded work: exactly 1,000,003 hashes each, exit 3 on exhaustion.
- Actual loader smoke including 1,000 buffer retain/release cycles, source
  refusal, split source strings, events/callback/profiling, bounds overflow,
  offsets/wrap, and preservation of an earlier winning flag/result.
- Address/undefined/leak sanitizer run: passed with leak detection enabled.
- Missing-device simulation (`SNBCL_DEVICE=/dev/null`): clean initialization
  failure, CLI CPU fallback, no process abort or GPU hang.
- C builds passed `-Wall -Wextra -Werror`; optimized release Rust build passed.

Logs: [engine/sanitizers](session10/engine-and-sanitizers.log),
[M4 regression](session10/m4-regression.log), [fail-clean](session10/fail-clean.log),
[final build](session10/build-final.log), [release build](session10/snbcl-cli-build.log),
[recon](session10/m5-recon.log).

## Installation

Installed CLI: `/root/.cargo/bin/nano-rspow`, SHA256
`95f9289a9c3bd58fa63d76fee1de0b13f5ccb61d2786c6587126e5b1ea92a822`.
Previous CLI: `/tmp/nano-gen6-m3/session10/nano-rspow-before-m5`.

Library: `/usr/local/lib/snbcl/libsnbcl.so`, SHA256
`345cbe0e1a5c2abc1a8e18f05ab8fd7a2818179985169019a0eaf35a460f8eb0`,
with sibling SIMD8/16 kernels and `/usr/local/lib/libsnbcl.so` compatibility link.
`/etc/OpenCL/vendors/snbcl.icd` registers it with the existing neutral loader.
Debian's loader ignores OCL_ICD_FILENAMES: private tests used OCL_ICD_VENDORS;
normal installed commands need neither variable. The executable links the system
libOpenCL.so.1. See [SNBCL.md](SNBCL.md) for build/use/rollback.

## Performance qualification remains pending

The Session 10 proposed causal model is not established by Session 9 telemetry.
Those clock readings were post-bucket snapshots, not interval means. The last
full 5.037 MH/s bucket had a 500 MHz post-sample; 450 MHz belonged to an earlier
5.331 MH/s bucket. CPU pressure also rose sharply. Consequently neither “98% of
droop is clock” nor a retroactive sustained software PASS follows. The previous
raw retention failure remains recorded.

The new monitor samples actual frequency every 0.2 seconds, associates samples
with monotonic bucket boundaries, and reports raw and clock-normalized retention
separately. A 1.2-second functional test passed; it is not sustained qualification.
See [clock-monitor-test.log](session10/clock-monitor-test.log) and its CSV.

The bounded watcher completed one eligible-start attempt at 2026-10-19 14:57
lemox time. The pre-run gate passed (load <0.20, CPU pressure <5%, maximum
thermal-zone temperature <85°C). The five-round idle comparison measured SIMD16
at 10.920–13.502 MH/s and SIMD8 at 7.659–9.434 MH/s. By the start of the
120-second sustain run the package was already 96°C; it peaked at 99°C. The
sustain result was 8.027 MH/s overall, with raw first-to-last full-bucket
retention 0.746. The new sampled clock monitor measured 979.20 MHz average in
the first full bucket and 729.72 MHz in the last; clock-normalized retention was
1.001. This is strong evidence that the rate decline tracks clock decline in
this run, but it does not establish clock as the sole cause. The thermal gate
was an initial-start filter, not a cap during the benchmark. Reset count stayed
7 and the i915 render engine is now asleep with an idle ring and no process
holding the render node.

Saved output:
[idle comparison](session10/requalify-idle-20261019-145712.log),
[sustain buckets](session10/requalify-sustain-20261019-145712.log),
[0.2-second clock/temperature samples](session10/requalify-clocks-20261019-145712.csv),
[watcher log](session10/requalify.log).
The watcher exited after the attempt; there is no active watcher PID.
