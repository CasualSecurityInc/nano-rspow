# nano-rspow-web

If you are looking for the same functionality on the server side, see the [nano-rspow-node README](../nano-rspow-node/README.md).

Nano (XNO) proof-of-work generation for browsers using WebAssembly and WebGPU.

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

The threshold argument is always caller supplied. For current Nano mainnet,
use `fffffff800000000` for send/change blocks or `fffffe0000000000` for
receive/open/epoch blocks. Pass the stricter value required by the publishing
node when it differs. See Nano's
[Work Generation guide](https://docs.nano.org/integration-guides/work-generation/)
for current network requirements.

## Benchmarking Dashboard

<table>
<tr>
<td>
<img src="../assets/benchmark-ui.png" width="480" alt="The nano-rspow-web browser-only benchmarking dashboard" />
<p><strong>Browser-only benchmark:</strong> fully in-browser, benchmarking the <code>nano-rspow-web</code> package's WebGPU and CPU WebAssembly backends.</p>
</td>
<td>
<img src="benchmark-compare/benchmark-charts.png" width="480" alt="Post-run charts comparing nano-rspow-web, nano-rspow-node, the nano-rspow CLI, and nano-pow" />
<p><strong>Local comparison results:</strong> requires building and running this repository locally; these post-run charts compare in-browser providers with the server-side <code>nano-rspow-node</code> addon and native Rust CLI side by side.</p>
</td>
</tr>
</table>

An interactive benchmarking dashboard is included in `browser-demo/index.html` to measure WebGPU and CPU WebAssembly performance.

Try it out for yourself: **[https://casualsecurityinc.github.io/nano-rspow/](https://casualsecurityinc.github.io/nano-rspow/)**





## API reference

### `init(moduleOrPath?)`

Initializes the asynchronous WASM loader. Await this default export before calling the work functions. It accepts an optional WebAssembly module, bytes, `Response`, URL, request, or promise for one of those inputs.

### `initSync(module)`

Initializes the module synchronously from bytes or a precompiled `WebAssembly.Module`. Use this only when the module bytes are already available.

### `generate_work(hash_hex: string, threshold_hex: string): Promise<GenerateResult>`
Asynchronously generates Proof of Work for a 32-byte block hash at any hexadecimal threshold. Tries WebGPU first, falling back to CPU WebAssembly.

### `generate_work_gpu(hash_hex: string, threshold_hex: string, cancel_token: WasmCancelToken): Promise<GenerateResult>`
Forces WebGPU PoW generation at any hexadecimal threshold. Rejects if WebGPU is unavailable or if the cancellation token is triggered.

### GPU resource lifetime and concurrency

One WebGPU generator is built per page and reused by every call. Building one
requests an instance, adapter, device and queue, compiles the WGSL shader,
creates the compute pipeline and allocates the double-buffered slots, so
rebuilding it per call charged that whole cost to the caller once per block.
`recommendLocalPow` builds the same generator, which also warms the cache for
the first `generate_work` call.

Two consequences for callers:

- **Generation is serialised.** The generator's ping-pong buffers are shared, so
  overlapping calls would write the same slot and read back each other's
  results, handing back work computed for a different block. Calls are
  therefore queued and run one at a time, in the order they arrive. Concurrent
  calls are safe but wait their turn; they are never rejected or interleaved.
- **A lost device is recovered automatically.** If the browser drops the
  device, the cached generator is discarded and the next call builds a new one.

### `generate_work_cpu(hash_hex: string, threshold_hex: string): GenerateResult`
Synchronously generates PoW at any hexadecimal threshold, forcing single-threaded CPU WebAssembly.

### `generate_work_cpu_batch(hash_hex: string, threshold_hex: string, max_nonces: number): string | null`

Tests at most `max_nonces` nonces synchronously on the CPU. Returns a lowercase 16-character nonce when found, otherwise `null`. The CPU random-number-generator state persists between calls. Pass an unsigned 32-bit integer.

### `recommendLocalPow(reprobe = false): Promise<boolean>`

Returns whether this browser should prefer local PoW. On a cache miss it tests
WebGPU capability, or the single-threaded WASM CPU fallback's throughput. The
result is cached internally. Pass `true` to force a fresh evaluation after a
hardware or browser capability change.

### `validate_work(hash_hex: string, nonce_hex: string, threshold_hex: string): boolean`
Synchronously validates whether a nonce meets an arbitrary hexadecimal threshold for the given block hash.

### `WasmCancelToken`
A class utilized to signal cancellation to the asynchronous GPU solver loop.
* `new WasmCancelToken()`: Instantiates a new token.
* `cancel()`: Aborts the ongoing GPU compute loop.

### `GenerateResult`

Returned by all generation functions.

* `nonce: string`: Lowercase 16-character hexadecimal nonce.
* `is_gpu: boolean`: `true` when WebGPU found the nonce.
* `free()` or `[Symbol.dispose]()` releases the WebAssembly wrapper when manual resource cleanup is needed.


---

## Browser compatibility

Use a browser with WebGPU support to use the GPU path. Browsers without WebGPU use the synchronous single-threaded WebAssembly CPU fallback.



- **[nano-rspow-node](https://www.npmjs.com/package/nano-rspow-node)**: High-performance pre-compiled Node.js bindings for backend servers.
- **[nano-rspow Workspace](https://github.com/CasualSecurityInc/nano-rspow)**: The monorepo source code containing both packages.
