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

| Metric | Browser WebGPU | Native wgpu (warm) | Native slower by |
|--------|---------------|-------------------|-----------------|
| median | 261.6 ms      | 1,521 ms           | **~5.8×**       |
| mean   | 343.6 ms      | 2,380 ms           | **~6.9×**       |
| min    | 44.1 ms       | 307.7 ms           | **~7.0×**       |

**Root cause**: Browser hardcodes `DISPATCH_X = 65535` (~4.19M nonces/batch).
Native tuner uses a 250 ms budget (`DEFAULT_TUNE_BUDGET_MS`) and finds a much smaller
`dispatch_x`, resulting in far fewer nonces per GPU round-trip and high variance from
overhead-dominated dispatch loops.

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

