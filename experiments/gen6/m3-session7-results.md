# Route C, Session 7: M3 hash kernel results

The Gen6 SIMD8 kernel now computes Nano's Blake2b-8 work function bit-exactly
and has found a valid receive-tier nonce on `lemox.lan`. The 12-round kernel
assembled to 4,783 Gen6 instructions (76,528 bytes; highest register r48).
The binary assembled on lemox and executed through the Session 6 media-object
path.

## Correctness

`kgen.py --self-test` passed 800 lane records over 2- and 12-round kernels,
including carry, threshold and nonce-boundary cases; the 12-round CPU model
also matched Python `hashlib.blake2b`.

The GPU's complete SoA output matched the independent `hashlib` oracle for:

| Case | Result |
|---|---|
| 8 threads, base 0 | 64/64 nonce/hash/hit records exact |
| 4 threads ending at low-word boundary `0xffffffff` | exact |
| 4 threads with base `0x100000000` | exact high nonce word |
| 2 threads near `u64::MAX` | exact, no wrap |
| Threshold 0, 512 hashes | all 512 hit bits set |
| Threshold `0x8000000000000000`, 512 hashes | all hit bits exact (249 hits) |
| Receive threshold, 512 hashes | all hit bits exact (0 hits) |
| 4,096 threads, threshold 0 | all 32,768 hashes exact; 512 KiB surface and guard checked |

The output layout is **structure of arrays** per thread: eight nonce low words,
then eight hash low words, eight hash high words, and eight hit words. The
proposal's `golden.py` sample assumed lane-interleaved records; the saved
`golden.py` follows the actual message layout and verifies every output word
and the untouched guard area.

## First real work

On root
`718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2`, the
GPU solver found:

```text
nonce      0x0000000000068d1d
difficulty 0xfffffff069a0f9c5
threshold  0xfffffe0000000000
```

The hit was found after 14 batches / 458,752 tested nonces, an unusually early
result for this threshold. The checker recomputed all 32,768 records in the
final batch, including the hit bit, and the installed `nano-rspow validate`
command independently returned `Valid: YES`.

## Throughput

The 12-round fixed-work benchmark repeatedly submits the same deterministic
range and waits for each batch. Rates include command submission and sync, so
they describe this end-to-end harness path.

| Threads per batch | 12 rounds (MH/s) |
|---:|---:|
| 64 | 2.469 |
| 256 | 5.678 |
| 1,024 | 6.679 |
| 4,096 | 6.853 |
| 1 | 0.075 |

At 4,096 threads, the 2-round kernel measured 38.821 MH/s (versus 6.853
MH/s at 12 rounds). Its instruction count is 853 versus 4,783, a 5.61x
ratio; measured throughput differs by 5.67x. The slope indicates that the
large-batch rate is primarily limited by hash instruction work. Small batches
show substantial fixed submission overhead.

The receive-tier CPU CLI benchmark on the same root used ten warm samples:
minimum 505.1 ms, maximum 6,910.9 ms, mean 2,552.5 ms, median 2,545.9 ms.
PoW timing is geometric and highly variable. Dividing the expected receive
work (2^23 hashes) by the sample mean suggests about 3.29 MH/s for this CPU
backend; treat that as a rough estimate. The GPU fixed-work rate at 4,096
threads was about 2.1x higher. The earlier 3- and 5-sample CPU runs varied
widely, which is why the ten-sample estimate is used here.

The measured 6.85 MH/s is below the proposed 12 MH/s proceed gate, so the
kernel is correct and useful but needs tuning before treating performance as
settled. The data points to compute cost and small-batch overhead; constant
folding the uniform Blake2b network is the next promising kernel change. No
send-tier measurement or OpenCL ICD integration was done in this session.

All submissions passed the per-exec i915 reset-stat check. The dmesg
before/after snapshots for correctness gates, benchmarks and the real solve
are byte-identical; the Session 6 reset count therefore remains 7.

## Reproduction

From the experiment directory:

```sh
python3 kgen.py --self-test
./build-m3.sh 12
./m3-gates.sh
./m3-bench.sh
./m3-solve.sh
```

`build-m3.sh` generates assembly locally, assembles with lemox's
`intel-gen4asm -g 6`, converts the blob and compiles the C harness there. The
GPU harness defaults to dry-run; submission requires `--submit` or `--solve`.
The exact assembly, binary, output buffers, verdicts, benchmark logs and dmesg
snapshots are kept beside this report.
