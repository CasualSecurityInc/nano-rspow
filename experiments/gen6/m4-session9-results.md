# Route C Session 9 — standalone solver delivered; performance qualifications remain

`snb-pow` is built and runnable on lemox at `/tmp/nano-gen6-m3/snb-pow`.
It supports GPU-only, CPU-only, and hybrid search, verifies GPU candidates on
CPU before accepting them, and solved both receive- and send-tier work that
independent hashlib and the stock `nano-rspow validate` accepted.

GPU-only is the default, with the 4,353-instruction SIMD16 predicated-carry
engine. The SIMD8 fallback remains selectable. Optional hybrid mode defaults
to one CPU worker after the fixed-work comparison below; CPU-only mode defaults
to at most three. The solver is about 26 KiB, plus the GPU kernel files. No Rust,
OpenCL runtime, package installation, or debug Rust build was needed.

## Gate summary

| Gate | Result |
|---|---|
| G1 idle-width comparison | Idle gate not met after 120 s; five interleaved samples/width recorded with affinity. SIMD16 median 8.891 MH/s; SIMD8 median 6.060 MH/s. Rates remain directional. |
| G2 120-second sustain | **FAIL**: last full five-second bucket retained 55.0% of the first, below 75%. Whole-run mean 6.154 MH/s. Hot hardware and external CPU contention were both present. |
| G3 correctness | **PASS**: independent C/hashlib oracle, concurrent allocator/boundary tests, all three modes, exact bounded work including partial vectors, stock CLI validation, wrong-kernel rejection, and SIMD8 fallback. |
| G4 real solves | **PASS**: matched receive ranges in all modes; hybrid send solve independently verified. GPU-only had the fastest receive median in the recorded matrix. |

M4's functional deliverable is ready. This is not a claim that the idle or
sustained-performance gates passed.

## G1 — width comparison

The final run performed no builds or other investigator CPU workloads during
measurement. It waited at most 120 seconds for load <0.30, failed that gate at
0.47, pinned the submitter to cpu3 selected by sampled per-CPU idle time, and
interleaved/reversed five three-second samples per width. The load during the
samples rose to about 0.69. An earlier preliminary run overlapped build/test
activity and is preserved separately, excluded from these statistics.

| Width | n | Median | Min | Max |
|---|---:|---:|---:|---:|
| SIMD8 pred | 5 | 6.060 MH/s | 5.551 | 7.467 |
| SIMD16 pred | 5 | 8.891 MH/s | 7.740 | 11.215 |

Width gain: 1.467x. The illustrative `a + W*b` fit gives `a/b=14.297`
lane-times, not the earlier loaded fit's ~8. Neither pair of medians identifies
physical decode/issue costs: clock, thermal state, dependency throughput,
host submission and contention all contribute. At a fixed width/mix, removing
10% of instructions saves 10% of modeled execution cost; the proposed model
does not imply a separate 1.5x multiplier for instruction-count cuts.

Evidence: `session9/idle.log`, `idle-summary.log`; `fit.py` reproduces the summary.

## G2 — temperature, frequency and sustained rate

The 120.011-second SIMD16-pred run completed 738,525,184 hashes at **6.154 MH/s**.
The first complete five-second bucket was **9.163 MH/s**. The last complete
bucket (110.152–115.162 seconds) was **5.037 MH/s**, or **55.0%** of the first.
There were 23 full buckets; the remaining ~4.85 seconds are included in the
whole-run total, not emitted as another complete bucket.

The thermal zones reached **98°C**. During the run the actual GPU frequency
fell from sampled 800 MHz to as low as 450 MHz, while the requested frequency
varied between 650 and 1,300 MHz. The relevant sysfs paths are under `card1`,
not `card0`: `gt_act_freq_mhz` and `gt_cur_freq_mhz` are different readings.
The reported nominal RPS bounds were 650–1,300 MHz; sampled actual frequency
could fall below the nominal minimum during this run.

External host activity increased load average from 0.56 to **25.92**. A
post-run pressure snapshot reported CPU `some avg10=96.14%`; process snapshots
showed container/runtime activity. These data support thermal throttling and
strong external contention, but do not isolate the fraction of slowdown from
each. The session did not stop services or change clock/power/cooling controls.

Evidence: `session9/sustain.log`, `sustain-summary.json`, `sustain-host.log`.

## G3 — implementation and checks

- The scalar C Blake2b-8 oracle matched hashlib for **2,004** random/edge cases
  on both workstation and lemox, including root/nonce byte order. The supplied
  draft's `SG[r]` indexed beyond its ten-row schedule; the implementation uses
  `sigma[r % 10]`. Its `{1,0,0,0}` self-test root also did not represent the
  stated `00...01` byte string; explicit little-endian root decoding avoids that.
- A shared mutex-protected range allocator gives CPU and GPU disjoint
  reservations, splits at 32-bit boundaries, enforces an exact global work cap,
  and stops at u64 exhaustion. It replaces the draft's eventually overlapping
  independent high-word streams. Concurrent exact-coverage tests plus address
  and undefined-behavior sanitizer tests passed.
- CPU-only mode actually starts workers. Result fields are written before the
  atomic stop flag is published, and tested counts are atomic. The draft's
  reversed CPU-only condition, early-publication race, and mixed atomic/plain
  counter updates were not carried over.
- All three modes solved threshold 1 and their nonces passed the stock CLI.
  All three modes also searched exactly **1,000,003** nonces on the bounded
  no-hit fixture, returning exit 3. GPU-only counted the three-lane tail as CPU
  work, as documented. A range crossing `0xffffffff` searched exactly 100
  nonces; starting 16 nonces below u64 exhaustion tested only those 16 and did
  not wrap. The SIMD8 fallback also solved the smoke fixture reset-clean.
- The production kernels are pinned by generated size/checksum metadata.
  Supplying the wrong-width blob returns error 2 before GPU submission. The
  checksum detects accidental build/configuration mismatch; it is not a
  cryptographic authentication mechanism.
- Persistent results are scanned after GEM_WAIT and CPU-domain acquisition.
  The kernel always overwrites each record, so hit-word clearing and per-batch
  full-buffer memset are unnecessary. Nonce words, hit flags, GPU-reported
  candidate hashes, guard words and reset statistics are checked. A final
  partial vector is searched on CPU and accounted separately.
- The original M3 GPU helpers and command builders are shared through
  `snb-gpu.h`. Production builds use `-O3 -march=sandybridge -Wall -Wextra
  -Werror -pthread`; no build warnings occurred. Recorded solver sessions
  reported **i915 reset count 7 -> 7**.

Evidence: `test-blake8.py`, `test-snb-pow.c`, `session9/g3*.log`, `smoke-*.log`,
`bounded.log`, `build.log`, and the independent `*-validate.log` files.

## G4 — receive comparison and default selection

Root: `718cc2121c3e641059bc1c2cfc45666c99e8ae922f7a807b7d07b62c995d79e2`.
Threshold: `0xfffffe0000000000`. The three predeclared starting nonces were
0, `0x10000000`, and `0x20000000`, identical for every mode. CPU-containing
modes in this original matrix used three workers. This avoids measuring the
same lucky base-zero solution three times, but remains a small deterministic
matched-range comparison on a contended host.

| Mode | Base 0 | Base 0x10000000 | Base 0x20000000 | Median |
|---|---:|---:|---:|---:|
| CPU, 3 workers | 0.214587 s | 0.198318 s | 1.952955 s | **0.214587 s** |
| GPU | 0.064234 s | 0.066895 s | 0.420170 s | **0.066895 s** |
| Hybrid, 3 workers | 0.089088 s | 0.069178 s | 0.515171 s | **0.089088 s** |

GPU-only wins that median and is the default. These are solve times, not
expected receive-tier latency over independent random roots. The CPU mode is
the new scalar C solver, not the stock CLI's optimized Rust CPU backend.

A separate fixed-work check searched exactly **8,388,608** nonces per sample,
with the same root/base and all-ones threshold. The second pass reversed the
configuration order. Rates are still directional because host load was ~5–6.

| Configuration | Pass 1 | Pass 2 |
|---|---:|---:|
| GPU | 9.685 MH/s | 8.564 MH/s |
| CPU, 3 workers | 2.009 MH/s | 1.740 MH/s |
| Hybrid, 3 workers | 8.141 MH/s | 7.438 MH/s |
| Hybrid, 1 worker | 9.934 MH/s | 9.038 MH/s |

One CPU worker helped modestly; three reduced combined throughput. Optional
hybrid mode therefore defaults to one worker, while CPU-only retains up to
three. These samples do not uniquely prove package-power coupling; scheduling,
cache/driver overhead and changing external load remain possible contributors.
A final rebuilt one-worker hybrid solve was independently validated; it is
recorded separately and not retroactively mixed into the receive matrix.

### Send-tier demonstration

Hybrid mode with three CPU workers found:

```text
root      718cc2121c3e641059bc1c2cfc45666c99e8ae922f7a807b7d07b62c995d79e2
threshold fffffff800000000
nonce     000000000677f4a0
h0        fffffffe2a0ec659
winner    CPU worker
wall      17.485076 seconds
GPU       90,308,608 hashes, 5.165 MH/s over wall time
CPU       18,214,514 hashes, 1.042 MH/s over wall time
total     108,523,122 hashes, 6.207 MH/s
resets    7 -> 7
```

Both independent hashlib and the installed `nano-rspow validate` reported valid
send-tier work. This search was lucky: 108.5 million tested hashes versus the
tier's expected ~537 million. The 17.49-second wall time is a demonstration,
not a general send-time prediction. The winning nonce came from CPU while the
GPU concurrently searched disjoint ranges; earlier GPU-only receive solves
already establish GPU-found, CPU-verified work.

Evidence: `session9/receive-*.log`, `receive-summary.log`, `fixed-work.log`,
`send-hybrid.log`, `send-hybrid-validate.log`, `hybrid-one-worker.log`.

## Run it

Build: `bash experiments/gen6/build-m4.sh` on the workstation.
Then on lemox (default kernel paths resolve beside the executable):

```sh
/tmp/nano-gen6-m3/snb-pow \
  --root 718cc2121c3e641059bc1c2cfc45666c99e8ae922f7a807b7d07b62c995d79e2 \
  --threshold 0xfffffe0000000000
```

Add `--mode hybrid` to race one CPU worker with GPU, `--mode cpu` for CPU-only,
or `--lanes 8` for the fallback. `--max-hashes N` bounds exact aggregate work.
See `SNB-POW.md` and `m4.sh` for reproduction. The `m4.sh` recorded matrix uses
three CPU workers explicitly; `CPU_WORKERS=1 bash m4.sh` changes that experiment.

The stock CLI's OpenCL backend is not integrated by this session. M5 remains
separate work over this now-functional standalone solver. Clean idle and
sustained-performance qualification still requires appropriate host conditions.
