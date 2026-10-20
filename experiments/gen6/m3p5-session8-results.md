# Route C Session 8 results

Session 8 implemented flag-predicated carry and SIMD16 code generation, generalized the result checker and submitter to 8 or 16 nonces per media thread, and validated all four kernel variants on lemox.

## Correctness and build

| Variant | Instructions/thread | Highest GRF | Software oracle | Hardware hash/threshold check |
|---|---:|---:|---|---|
| SIMD8, mask carry | 4,783 | r48 | PASS, 800 lane records | PASS, 512 records |
| SIMD8, predicated carry | 4,339 | r48 | PASS, 800 lane records | PASS, 512 records |
| SIMD16, mask carry | 4,797 | r87 | PASS, 1,600 lane records | PASS, 1,024 records |
| SIMD16, predicated carry | 4,353 | r87 | PASS, 1,600 lane records | PASS, 1,024 records |

All 12-round hardware checks matched nonce low words, both Blake2b digest words, threshold results, and the sentinel guard. The SIMD16 streams assembled with `intel-gen4asm -g 6`; the 1-round SIMD16 predicated build also passed through `build-m3.sh` and completed reset-clean on hardware. Per-submission reset gates passed.

The 444-instruction reduction from predicated carry is exactly the predicted count: each of 444 two-term carry corrections replaces mask-and-add with one predicated add. SIMD16 requires two 128-byte SoA8 output blocks per thread, not one SoA16 block; `golden.py` and solver hit scanning now follow that physical layout.

## Lemox throughput samples

The matrix ran at 1,024 and 4,096 media threads, for 1.5 seconds per sample, on root `718c…79e2`. Host load average rose from 2.04 to 1.80 during the run, and host CPU use was near saturation when inspected. Treat the rates as directional; they are not an idle-host benchmark.

| Threads | SIMD8 mask | SIMD8 pred | SIMD16 mask | SIMD16 pred |
|---:|---:|---:|---:|---:|
| 1,024 | 6.298 MH/s | 6.320 MH/s | 7.918 MH/s | 8.496 MH/s |
| 4,096 | 5.679 MH/s | 6.122 MH/s | 7.598 MH/s | 8.123 MH/s |

At 4,096 threads, converting these rates back to issued vector instructions gives about 3.39, 3.32, 2.28, and 2.21 billion instructions/second respectively. The SIMD16 rate is roughly half the SIMD8 issue rate for this mix, so doubling vector width yields about 1.3–1.4x hashes/second rather than 2x. The width-invariant 4.1-billion-instruction/s assumption does not hold across SIMD8 and SIMD16. Predicated carry is a smaller, consistent win in the loaded-host matrix. A separate isolated 3-second SIMD8-predicated sample reached 8.093 MH/s at load average 0.27; a later sample fell to 6.147 MH/s as load rose, demonstrating why the contested-host matrix should not be treated as final performance.

## Remaining work

The proposed ADD/XOR/rotate dependency microbenchmarks were not run. They are still needed to separate EU issue rate, dependency latency, memory traffic, and host submission effects. The debugfs clock files queried on lemox were unavailable, and the host was too busy for useful microbenchmark attribution. The practical result is already clear enough to pick SIMD16 + predicated carry for further testing, but an idle repeat is required before claiming a stable rate or attributing the issue ceiling to clock and IPC.
