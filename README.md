# nano-rspow

A hyper-optimized, cross-platform Nano (XNO) Proof-of-Work engine.

## Why this exists

Historically, generating Nano Proof-of-Work (PoW) in Node.js or web environments relied on sluggish JavaScript implementations or WebAssembly bindings that couldn't fully tap into modern hardware accelerators. They often blocked the main event loop and failed to utilize the full potential of multi-core CPUs (like Apple Silicon) or dedicated GPUs. 

The Nano ecosystem needed a drop-in, bare-metal replacement that seamlessly integrates into Node.js while squeezing every drop of performance out of the host machine.

## What it is

`nano-rspow` is a modular Rust library that implements the Blake2b PoW algorithm using a novel **"Silicon Race" hybrid architecture**. 

Instead of forcing you to choose between CPU and GPU compute, `nano-rspow` simultaneously dispatches the PoW search across your multi-core CPU (via `rayon`) AND your best available GPU (via native `OpenCL` or `wgpu`). Whichever processor finds the valid nonce first instantly aborts the other. 

The result? The absolute fastest generation times mathematically possible on your machine, completely automatically.

### Features
- **Zero-Config Distribution**: The Node.js bindings (`nano-rspow-node`) are distributed with pre-compiled native binaries for macOS (Intel & ARM), Windows, and Linux. No Rust toolchains or C++ compilers required for downstream users.
- **True Concurrency**: NAPI-RS executes the work generation on the asynchronous libuv thread pool, keeping your Node.js event loop completely unblocked.
- **Live Network Difficulties**: Includes semantic mappings for active network thresholds (`Send`, `Receive`, `Epoch1`).
- **Best-in-Class CLI**: Includes a robust standalone terminal application for debugging, benchmarking, and quick work generation.

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
    // Effortlessly utilizes all available CPU cores + GPU concurrently
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
