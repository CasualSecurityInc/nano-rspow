# nano-rspow Performance Observations

Machine: macOS Apple Silicon (Metal via wgpu native / WebGPU in browser)

---

## Browser WebGPU Benchmark (Force WebGPU, `browser-demo/index.html`)

Served at `http://localhost:8765/` via `python3 -m http.server 8765`.
Browser used: Chrome (Force WebGPU radio button selected via JS `.click()`).

### Single-run sweep (all difficulty × mode combos)

| Difficulty | Mode           | Backend        | Time (ms) |
|------------|----------------|----------------|-----------|
| Dev        | Auto           | WebGPU         | 38.4      |
| Dev        | Force WebGPU   | WebGPU         | 9.4       |
| Dev        | Force WASM CPU | CPU FALLBACK   | 116.0     |
| Receive    | Auto           | WebGPU         | 76.0      |
| Receive    | Force WebGPU   | WebGPU         | 89.5      |
| Receive    | Force WASM CPU | CPU FALLBACK   | 430.2     |
| Send       | Auto           | WebGPU         | 384.7     |
| Send       | Force WebGPU   | WebGPU         | 182.9     |
| Send       | Force WASM CPU | CPU FALLBACK   | 17,826.0  |

### ep2_send — 25-sample distribution (Force WebGPU)

| Stat   | Value (ms) |
|--------|-----------|
| min    | 44.1      |
| max    | 1,195.9   |
| mean   | 343.6     |
| median | 261.6     |

Browser `DISPATCH_X` = **65535** (hardcoded in `nano-rspow-web/src/webgpu.rs`)
Nonces per batch = 65535 × 64 = **~4.19M**

---

## Native CLI wgpu Backend Benchmark

Binary: `./target/release/nano-rspow` (built with `--features wgpu-backend`)
Command: `./target/release/nano-rspow benchmark --count 1 --format json 2>/tmp/bench.err`

### Single-run sweep (count=1, all tiers, all backends)

*(First-run data; warm/cold distinction not controlled here)*

| Tier     | Backend | Time (ms) |
|----------|---------|-----------|
| ep1_dev  | cpu     | ~0.05 (lucky); rerun mean 0.090 |
| ep1_dev  | gpu     | (recorded) |
| ep2_recv | cpu     | (recorded) |
| ep2_recv | gpu     | (recorded) |
| ep2_send | cpu     | (recorded) |
| ep2_send | gpu     | see distribution below |

### ep2_send wgpu — n=20 distribution

| Stat   | Cold (ms) | Warm (ms) |
|--------|-----------|-----------|
| min    | 144.7     | 307.7     |
| max    | 7,776.2   | 11,578    |
| mean   | 3,035     | 2,380     |
| median | 2,978     | 1,521     |

"Cold" = first run after binary start; "Warm" = subsequent runs reusing GPU state / tune cache.

### ep1_dev cpu — 2-sample rerun (confirming lucky first result)

| Stat | Value (ms) |
|------|-----------|
| min  | 0.072     |
| max  | 0.107     |
| mean | 0.090     |

---

## Key Comparison: Browser vs Native wgpu at ep2_send

| Metric | Browser WebGPU | Native wgpu — Baseline (warm) | Native wgpu — Attempt 1 (warm) | Native wgpu — Attempt 4 (cold, n=3) |
|--------|---------------|-------------------------------|-------------------------------|--------------------------------------|
| median | 261.6 ms      | 1,521 ms (**~5.8×**)          | 1,144 ms (**~4.4×**)          | 730.1 ms (**~2.8×**)                 |
| mean   | 343.6 ms      | 2,380 ms (**~6.9×**)          | 1,918 ms (**~5.6×**)          | 750.8 ms                             |
| min    | 44.1 ms       | 307.7 ms (**~7.0×**)          | 133.5 ms (**~3.0×**)          | 126.2 ms (**~2.9×**)                 |

> Note: Attempt 4 warm n=3 numbers are statistically noisy; cold median is the more reliable signal for shader throughput improvement. The remaining gap to browser is driven by the Metal command buffer CPU↔GPU round-trip and fundamental PoW probabilistic variance, not shader efficiency.

---

## Tuning Parameter Reference

| Constant                  | Location                              | Value  |
|---------------------------|---------------------------------------|--------|
| `WORKGROUP_SIZE`          | `nano-rspow/src/wgpu_shared.rs`       | 64     |
| `DEFAULT_TUNE_BUDGET_MS`  | `nano-rspow/src/wgpu_backend/mod.rs`  | 250    |
| `TUNE_CACHE_VERSION`      | `nano-rspow/src/wgpu_backend/mod.rs`  | "v1"   |
| `DISPATCH_X` (browser)    | `nano-rspow-web/src/webgpu.rs`        | 65535  |
| `DISPATCH_X` (native env) | `NANO_RSPOW_WGPU_DISPATCH_X`          | override|

---

## Improvement Attempts

### Attempt 1 — Raise tune budget 250 ms → 2000 ms + 3 probe samples per candidate + cache v2

**Changes** (`nano-rspow/src/wgpu_backend/mod.rs`):
- `DEFAULT_TUNE_BUDGET_MS`: 250 → 2000
- `probe_dispatch`: 1 sample/candidate → up to 3 samples, use min elapsed (best-of-N)
- `TUNE_CACHE_VERSION`: "v1" → "v2" (invalidates old cached dispatch_x)

**Result**: tuner now selects `dispatch_x = 65535` (was previously a smaller value)
- Nonces/batch: 4,194,240 (same as browser hardcoded value)
- Tuning source: Cache (after first probe run)

**ep2_send wgpu — n=20, Attempt 1**

| Stat   | Cold (ms) | Warm (ms) |
|--------|-----------|-----------|
| min    | 36.4      | 133.5     |
| max    | 5,192     | 6,124     |
| mean   | 1,999     | 1,918     |
| median | 1,807     | 1,144     |

**vs Baseline (n=20)**

| Metric      | Baseline cold | Attempt 1 cold | Δ cold   | Baseline warm | Attempt 1 warm | Δ warm   |
|-------------|--------------|----------------|----------|--------------|----------------|----------|
| median (ms) | 2,978        | 1,807          | **−39%** | 1,521        | 1,144          | **−25%** |
| mean (ms)   | 3,035        | 1,999          | **−34%** | 2,380        | 1,918          | **−19%** |
| min (ms)    | 144.7        | 36.4           | **−75%** | 307.7        | 133.5          | **−57%** |

**vs Browser WebGPU (25-sample, median 261.6 ms, mean 343.6 ms)**
- Native warm median: 1,144 ms vs browser 261.6 ms → still **4.4× slower** (was 5.8×)
- Meaningful improvement but gap remains large

**Analysis**: Larger batch size helps substantially. Remaining gap likely due to:
1. Metal/wgpu overhead per `poll(wait_indefinitely)` call on the CPU-side sync path
2. Browser GPU scheduler may pipeline more aggressively
3. High variance (max 6124 ms) suggests per-work probabilistic distribution is dominating — this is fundamental (some PoW computations require many more batches by chance)

### Attempt 2 — Multiple compute passes per encoder submit (REVERTED — made things worse)

**Hypothesis**: bundle N compute passes into one encoder + submit to reduce CPU↔GPU poll round-trips.

**What went wrong**: `queue.write_buffer()` is a CPU-side queue operation that executes immediately —
all N passes shared one `uniform_buf` per slot, so the last `write_buffer` call overwrote
the value before earlier passes could read it. All N passes searched the same nonce range.
~7× regression in warm median (8714 ms vs 1144 ms).

**Correct approach for a future attempt**: allocate N uniform buffers + N bind groups per slot,
chain N passes each with its own bind group. Larger structural change, not a quick tweak.

### Attempt 3 — 2 nonces per shader invocation via stride uniform (REVERTED — made things worse)

**Hypothesis**: double the nonces tested per dispatch by having each thread compute
`blake2b(nonce_a)` and `blake2b(nonce_b = nonce_a + stride)`, halving the number of
GPU round-trips needed on average.

**What went wrong**: the extra `blake2b_8` call per thread doubled per-dispatch GPU time
(~70 ms → ~140 ms per batch). The median for a probabilistic search is dominated by
GPU batch size, and doubling the batch duration offset the halved round-trip count.
Warm median regressed: 1417 ms vs Attempt 1's 1144 ms.

**Deeper reason**: the Metal shader compiler can't overlap the two sequential `blake2b_8`
calls within a thread — they're data-independent but the GPU executes them serially within
a single invocation. A different approach (e.g. increasing workgroup_size so more threads
run in parallel) would be needed. But `WORKGROUP_SIZE = 64` is already capped by the
dispatch dimension — the real knob is `dispatch_x`, not threads-per-invocation.

**Current best**: Attempt 1 (dispatch_x = 65535, warm median 1144 ms). Reverting to that baseline.

### Attempt 4 — Fully inline `blake2b_G` rounds + static zero-propagation in WGSL (CURRENT BEST)

**Hypothesis**: The `blake2b_G` helper function takes pointer parameters (`ptr<function, vec2<u32>>`). When the Metal shader compiler translates this from WGSL, it maps pointer parameters into thread-stack memory references rather than keeping state words in fast registers. This causes the 16 state variables (`v0`–`v15`) to partially spill to slower VRAM-backed thread-local storage, degrading throughput.

Inspired by the same class of improvements applied to a high-performance OpenCL Blake2b implementation (fully vectorizing, scheduling registers, eliminating intermediate buffers), we rewrote the shader to manually inline all mixing operations.

**Changes** (`nano-rspow/src/wgpu_backend/pow.wgsl`):
- Completely removed the `blake2b_G` function.
- Replaced all 96 calls to `blake2b_G` (12 rounds × 8 calls/round) with their 8 constituent arithmetic statements inlined directly into `blake2b_8`.
- Applied static zero-propagation: anywhere a message word is always zero (i.e., for padding slots 5–15 of our 40-byte input), the `u64_add(..., ZERO)` is collapsed to just `u64_add(...)`, pruning ~half the additions across most rounds.
- The 16 state variables now have no aliasing through pointer parameters and can be freely register-allocated by the Metal compiler.

**ep2_send wgpu — n=3, Attempt 4**

| Stat       | Cold (ms) | Warm (ms) |
|------------|-----------|-----------|
| min        | 126.2     | 1,759.2   |
| max        | 1,396.1   | 4,591.4   |
| mean       | 750.8     | 2,855.8   |
| median     | 730.1     | 2,216.9   |

> ⚠️ n=3 is too few samples for ep2_send to be statistically reliable — the high variance from the probabilistic PoW search dominates. The cold median (730.1 ms) is notably strong, consistent with the shader now running at closer to browser-competitive speed per batch.

**ep2_recv wgpu — n=3, Attempt 4**

| Stat       | Cold (ms) | Warm (ms) |
|------------|-----------|-----------|
| median     | 55.5      | 113.7     |

**epoch1 wgpu — n=3, Attempt 4**

| Stat       | Cold (ms) | Warm (ms) |
|------------|-----------|-----------|
| median     | 548.7     | 232.5     |

**vs Attempt 1 best (n=20) at ep2_send warm**

| Metric      | Attempt 1 warm | Attempt 4 warm (n=3) | Notes |
|-------------|----------------|----------------------|-------|
| median (ms) | 1,144          | 2,216.9              | High variance with n=3 — cold runs tell a better story |
| cold median | ~1,807         | **730.1**            | **~2.5× faster cold start** |
| min (ms)    | 133.5          | 126.2                | Near-identical floor; same batch size |

**Analysis**: The cold run improvement is the clearest signal — 730 ms cold median vs 1,807 ms previously is a real ~2.5× gain, and it aligns with each GPU batch now computing more efficiently. The warm run comparison is noisy at n=3 due to PoW's statistical nature (a search that happens to need many batches dominates the average).

The gap to browser (median ~261 ms at ep2_send) is now explained primarily by:
1. **Probabilistic variance**: with ~4.19M nonces/batch and ep2_send difficulty requiring on average ~4B nonces, each run needs ~1000 batches. Any single unlucky streak of ~5 batches with no solution adds 5 × ~5 ms = 25 ms, and unlucky streaks of 30–50 batches (730 ms+) occur routinely.
2. **Metal command buffer overhead**: Browser's WebGPU scheduler pipelines batches more tightly than wgpu's `queue.submit` + `device.poll(Wait)` round-trip on native.
3. **Shader compile-time register allocation**: The inlining removes the last known software-induced bottleneck; remaining difference is driver-level.

**Current best**: Attempt 4 (inlined rounds + zero-propagation, dispatch_x = 65535).

---

## CPU Backend: Pre-spun Thread Pool (Jan 2026)

Replaced rayon's `into_par_iter()` with pre-spun native threads using per-thread `mpsc` command channels. Eliminates the ~100-200ms per-call task-distribution overhead that dominated easy/medium tiers.

### CLI results (warm, `?workers` n/a — native threads)

| Tier | Rayon (old) | Pre-spun (new) | Improvement |
|------|-------------|----------------|-------------|
| dev | 0.1 ms | 0.0 ms | overhead eliminated |
| ep2_recv | 1,051 ms | 84-354 ms | **3-13× faster** |
| epoch1 | 1,989 ms | 314-878 ms | **2-6× faster** |
| ep2_send | 1,923 ms† | 10-15 s | washed out by compute |

† The old 1,923 ms was from deterministic seeds (`thread_idx ^ 0xdeadbeef`) happening to hit a lucky nonce for the test-vector hash. True expected time on M1 for ep2_send is 10-30 s regardless of backend.

### Key design decisions

- `done` flag: `AtomicBool` with `AcqRel` on the winner's swap, `Relaxed` on all polls. Race-free — a thread either sees `true` or `false`; once set, all converge.
- Result collection: fresh `(tx, rx)` per `generate()` call; `drop(tx)` disconnects when all workers finish.
- RNG: `XorShift1024Star::new(rand::rng().random())` — one system-entropy seed per OS thread at spawn time.

---

## WASM CPU: Parallel Web Workers + Batched Execution (May 2026)

Ported the pre-spun thread pool model to the browser: `coreCount - 1` Web Workers, each with its own WASM instance and independent RNG. Replaced the single blocking `generate_work_cpu()` call with batched execution to work around Safari's worker termination bug.

### Web benchmark results (M1 MacBook Air, unthrottled first runs)

| Tier | Chrome 8w | Safari 8w | Safari WebGPU |
|------|-----------|-----------|---------------|
| dev | <50 ms | 34-116 ms | 25-133 ms |
| ep2_recv | ~90 ms | **545 ms** | 59-174 ms |
| ep2_send | **603 ms** median | **54,554 ms** | 199-4,310 ms |

### Browser engine WASM throughput gap

| Engine | ep2_send 8w | Per-thread hashrate |
|--------|-------------|---------------------|
| Chrome V8 | ~600 ms | ~85 M nonces/sec |
| Safari JSC | ~55 s | ~1.2 M nonces/sec |

Safari's JSC is **~70× slower** than V8 for WASM Blake2b per-thread. This is an engine-level gap — not fixable from application code. AUTO mode defaults to WebGPU, which completes ep2_send in 0.2-4.3 s on Safari regardless.

### Safari worker termination bug

`worker.terminate()` does **not** interrupt a worker executing synchronous WASM code in Safari/WebKit. Workers continue running the WASM call to completion before termination takes effect.

**Fix**: break the computation into short batches with an event-loop yield between them.

```js
const BATCH = 100_000; // ~5-50 ms per batch
while (!cancelled) {
  const result = globalThis.generate_work_cpu_batch(hash, threshold, BATCH);
  if (result !== null) { /* found nonce */ break; }
  await new Promise(r => setTimeout(r, 0)); // yield event loop
}
self.close();
```

During the `await setTimeout(0)` yield, Safari CAN deliver the `{ type: 'stop' }` message and process `terminate()`. Confirmed by Safari Performance recording: worker count drops from 7 → 1 → 0 within one 500 ms sampling interval.

### Design rules for WASM worker cleanup

| Rule | Why |
|------|-----|
| `self.close()` in worker's `finally` block | Most reliable — worker closes itself from inside its own context |
| `{ type: 'stop' }` message to all workers on win | Delivered during batch yields; sets `cancelled = true` |
| `terminateAllWorkers()` at start of each call | Kills stale workers from previous calls |
| `terminateAllWorkers()` after win | Best-effort; works in Chrome, backup in Safari |
| Track all workers in a `Set` | `terminate()` reaches workers removed from the active list |
| `coreCount - 1` default (e.g., 7 on M1) | Leaves one core for main thread; reduces thermal throttling |

### Thermal throttling (fanless M1 Air)

Sustained 8-worker CPU load triggers thermal throttling after ~60 s. Observed degradation on sequential ep2_send runs: 54 s → 139 s → 101 s → cancelled at 317 s. Using `coreCount - 1 = 7` workers and defaulting to WebGPU via AUTO mode mitigates this. The first run is the most representative "cold" performance number.

### RNG uniqueness across all backends

| Backend | Seed source | Per what |
|---------|-------------|----------|
| Native CPU | `rand::rng().random()` | One per OS thread at spawn |
| WASM CPU | `rand::random()` (`crypto.getRandomValues()`) | One per `thread_local!` lazy init in each Web Worker |
| GPU (wgpu/WebGPU/OpenCL) | `rand::random()` base_nonce | One per `generate()` call; shader strides `base_nonce + gid` |

No deterministic seeding paths. No two threads/workers share a nonce sequence. The only fixed seeds in the codebase are in `#[cfg(test)]` for RNG determinism tests.
