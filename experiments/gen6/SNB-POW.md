# snb-pow (Route C M4)

Standalone Nano work generation on lemox's Sandy Bridge GPU, the CPU, or both.
The default is GPU-only, using the CPU-verified 12-round SIMD16 predicated-carry
kernel. CPU and hybrid modes use a scalar C Blake2b implementation, not the
optimized CPU backend in the Rust CLI.

## Build and run

From the workstation repository:

```sh
bash experiments/gen6/build-m4.sh
```

This generates and assembles both GPU widths and builds on lemox with
`-O3 -march=sandybridge -Wall -Wextra -Werror`. It runs the CPU/hashlib oracle
and concurrent allocator tests. It does not compile Rust or change packages.
Files are staged at `/tmp/nano-gen6-m3` on lemox.

```sh
ssh root@lemox.lan
/tmp/nano-gen6-m3/snb-pow \
  --root 718cc2121c3e641059bc1c2cfc45666c99e8ae922f7a807b7d07b62c995d79e2 \
  --threshold 0xfffffe0000000000
```

Use `--mode cpu` or `--mode hybrid` to select another mode, and
`--cpu-workers N` to change CPU concurrency (default one in hybrid mode;
at most three in CPU-only mode).
Use `--lanes 8` for the SIMD8 fallback. Default kernel paths resolve next to the
executable, so the current working directory need not contain the kernels.
An explicit `--kernel FILE` overrides the path, but must still match the built
12-round engine and requested width.

Distribute the Linux executable and `m3-12-l16-pred.bin` together; add
`m3-12-l8-pred.bin` to support the fallback. CPU-only mode needs no kernel or
DRM device. Both GPU modes require the same render-node access used for M3.

## Limits and verification

`--max-hashes N` sets an exact global work limit across both engines; zero is
unbounded. A shared allocator reserves non-overlapping ranges and splits at
low-word and u64 boundaries. GPU batches use at most 4,096 media threads by
default. A bounded tail shorter than one SIMD vector is computed on the CPU
and counted as CPU work even in GPU mode.

The CPU preimage is `nonce_le64 || root32`, with Blake2b digest size 8. The
digest is interpreted as a little-endian u64 and compared with the threshold.
Every GPU hit is rehashed on the CPU and compared with both its reported digest
and the requested threshold before publication. GPU output nonce words, hit
flags, guard bytes, and reset counts are checked. Results are published before
other workers are told to stop; GPU errors make the whole invocation fail.

The checksum generated in `snb-engine.h` detects accidental kernel/width
mismatches, including short-round diagnostic kernels. It is a build consistency
check, not a cryptographic authentication mechanism.

Exit status 0 means verified work was found; 3 means the bounded range or nonce
space was exhausted without a hit; 5 means an i915 reset invalidated the run.
Other errors return 1 or 2. `STATS` counts actual completed work, including full
GPU batches that finished while a CPU worker found the winner. Search time is
stochastic and is distinct from fixed-work hash throughput.

## Reproduce the Session 9 gates

After building, on lemox in `/tmp/nano-gen6-m3`:

```sh
bash idle-bench.sh | tee session9/idle.log
python3 fit.py session9/idle.log
bash sustain.sh | tee session9/sustain.log
bash m4.sh
python3 summarize-m4.py session9
bash fixed-work.sh | tee session9/fixed-work.log
```

Create `session9` first if using a clean directory. `idle-bench.sh` waits at most
120 seconds for the load gate, flags a failed gate, selects affinity from
sampled per-CPU idle time, and interleaves five samples of each width.
`sustain.sh` records five-second buckets, temperatures, requested/actual GPU
frequency, and load for 120 seconds. `m4.sh` solves matched receive ranges in
all modes, solves send-tier work in hybrid mode, and validates every solve
through independent Python hashlib and the installed `nano-rspow validate`.

The recorded `m4.sh` comparison explicitly uses three CPU workers in both
CPU-containing modes; `CPU_WORKERS=1 bash m4.sh` changes that experiment. The
solver itself defaults hybrid mode to one worker based on the fixed-work check.

Session 9's sustained-performance gate failed on a hot, contended host. See
`m4-session9-results.md` before treating any short-run rate as sustained capacity.
