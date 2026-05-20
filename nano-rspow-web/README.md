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

WebGPU works correctly in Chromium-based browsers (Chrome, Brave, Edge). **Safari on macOS and iOS has a known WebGPU compute shader defect** — the GPU pipeline initialises and dispatches successfully, but result readback via `mapAsync` consistently returns zeros regardless of the nonce search, meaning valid work is never found. The root cause is Safari's cross-process GPU architecture: unlike Chromium's in-process model, each `submit()` → `mapAsync()` round-trip is an IPC call to a separate GPU process, and the result buffer clear issued via `writeBuffer()` before the dispatch can be reordered by the driver to arrive *after* the compute pass, causing every readback to appear empty. Moving the clear inside the command encoder (`encoder.clear_buffer`) makes the ordering atomic within a single submission and is the correct workaround, but as of mid-2026 Safari's WebGPU implementation still does not produce correct compute results with this codebase. There is also an open WebKit bug ([#272804](https://bugs.webkit.org/show_bug.cgi?id=272804)) where `mapAsync` waits on unrelated prior command buffers before resolving, compounding per-batch latency. For these reasons the demo page applies a 5-second watchdog: if WebGPU fails to return a result within that window it automatically falls back to the CPU WASM backend, which works correctly on all platforms including Safari and iOS.



- **[nano-rspow-node](https://www.npmjs.com/package/nano-rspow-node)**: High-performance pre-compiled Node.js bindings for backend servers.
- **[nano-rspow Workspace](https://github.com/CasualSecurityInc/nano-rspow)**: The monorepo source code containing both packages.
