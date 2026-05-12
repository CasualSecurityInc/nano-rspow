# nano-rspow

A cross-platform Nano (XNO) Proof-of-Work engine written in Rust.

## Why this exists

Generating Nano Proof-of-Work (PoW) in Node.js or web environments has traditionally relied on JavaScript implementations or WebAssembly bindings that don't have direct access to hardware accelerators, and can block the main event loop.

`nano-rspow` is a native Rust implementation that integrates into Node.js via NAPI-RS, giving it access to multi-core CPUs and dedicated GPUs without blocking the event loop.

## What it is

`nano-rspow` is a modular Rust library that implements the Blake2b PoW algorithm using a **"Silicon Race" hybrid architecture**.

Rather than committing to a single backend, `nano-rspow` dispatches the PoW search concurrently across your multi-core CPU (via `rayon`) and your best available GPU (via native `OpenCL` or `wgpu`). Whichever finishes first cancels the other. On systems without a GPU, the multi-core CPU path alone is fast; on systems with a capable GPU, it will typically dominate. Running both simultaneously means rayon occupies all CPU cores, which can marginally reduce GPU driver throughput — so if you know your GPU is available and fast, using it exclusively may be slightly more efficient.

### Features
- **Zero-Config Distribution**: The Node.js bindings (`nano-rspow-node`) are distributed with pre-compiled native binaries for macOS (Intel & ARM), Windows, and Linux. No Rust toolchains or C++ compilers required for downstream users.
- **Non-blocking**: NAPI-RS executes work generation on the libuv thread pool, keeping your Node.js event loop free.
- **Live Network Difficulties**: Includes semantic mappings for active network thresholds (`Send`, `Receive`, `Epoch1`).
- **CLI**: Includes a standalone terminal application for debugging, benchmarking, and quick work generation.

## Usage

### Command Line Interface (CLI)

You can generate work directly from your terminal using `npx`—no global installation required!

```bash
npx nano-rspow <hash> --type send
```

### Node.js Library

Install the pre-compiled native module:

```bash
npm install nano-rspow-node
```

Use it asynchronously in your application:

```typescript
const { generateWork, validateWork, WorkType } = require('nano-rspow-node');

async function processBlock(hash) {
    console.log("Generating PoW...");
    // Dispatches across CPU and GPU; GPU wins on capable hardware
    const work = await generateWork(hash, WorkType.Send);
    
    console.log(`Generated: ${work}`);
    console.log(`Valid: ${validateWork(hash, work, WorkType.Send)}`);
}
```

## Repository Structure

- `nano-rspow/`: The core Rust library containing the Blake2b threshold logic and the Hybrid Race execution engine.
- `nano-rspow-cli/`: The standalone Rust CLI for local development and benchmarking.
- `nano-rspow-node/`: The NAPI-RS bindings and NPM package configuration.

## License

This software is released under the MIT License. See `LICENSE` for details. 
*Note: Attribution is required per the license terms.*
