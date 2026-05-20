# nano-rspow-web

WebGPU-accelerated Nano (XNO) Proof-of-Work generation in the browser using WebAssembly. Pre-compiled for high-performance direct web browser integrations.

Tries WebGPU first, then automatically falls back to single-threaded CPU WebAssembly if WebGPU is unavailable.

## Install

```bash
npm install nano-rspow-web
```

## Usage

```javascript
import init, { generate_work, validate_work } from 'nano-rspow-web';

// Initialize the WebAssembly module
await init();

// Generate work
const hash = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2";
const threshold = "fffffff800000000";

const result = await generate_work(hash, threshold);
console.log("Nonce:", result.nonce);   // e.g., "8587f13863c049fd"
console.log("Is GPU:", result.is_gpu); // true/false

// Validate work
const isValid = validate_work(hash, result.nonce, threshold); // true
```

## API Reference

### `init(module_or_path)`
Initializes the WASM loader. Must be awaited before calling other functions.

### `generate_work(hash_hex: string, threshold_hex: string): Promise<GenerateResult>`
Asynchronously generates Proof of Work for a 32-byte block hash. Tries WebGPU first, falling back to CPU WebAssembly.

### `generate_work_gpu(hash_hex: string, threshold_hex: string): Promise<GenerateResult>`
Forces WebGPU PoW generation. Rejects if WebGPU is unavailable.

### `generate_work_cpu(hash_hex: string, threshold_hex: string): GenerateResult`
Synchronously generates PoW forcing single-threaded CPU WebAssembly.

### `validate_work(hash_hex: string, nonce_hex: string, threshold_hex: string): boolean`
Synchronously validates whether a nonce meets the difficulty threshold for the given block hash.

---

## Browser Compatibility

WebGPU works correctly in Chromium-based browsers (Chrome, Brave, Edge).

> [!WARNING]
> **Safari on macOS and iOS has a WebGPU compute shader defect** confirmed on Safari 26.5 (21624.2.5.11.4) on macOS 26.5 — the latest publicly available release as of mid-2026. The GPU pipeline initialises and dispatches without error, but `mapAsync` readback consistently returns zeros regardless of actual compute results, meaning valid work is never found. This is likely caused by [WebKit bug #240436](https://bugs.webkit.org/show_bug.cgi?id=240436) — "Synchronize resources for data downloads on discrete GPUs" — which has been open since May 2022 and remains unassigned.
>
> The library detects this at runtime using a known-answer smoke test and automatically falls back to the CPU WASM backend, which works correctly on all platforms including Safari and iOS. A 5-second watchdog provides a secondary safety net for any browser that passes the smoke test but hangs during real PoW generation.



- **[nano-rspow-node](https://www.npmjs.com/package/nano-rspow-node)**: High-performance pre-compiled Node.js bindings for backend servers.
- **[nano-rspow Workspace](https://github.com/CasualSecurityInc/nano-rspow)**: The monorepo source code containing both packages.
