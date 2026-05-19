# nano-rspow

Standalone Rust library for Nano (XNO) block signing and Proof-of-Work with cross-language bindings.

Implements the Blake2b threshold search using a zero-configuration **hybrid race architecture**. The library automatically detects and utilizes the most optimal available hardware, running a highly optimized multi-core CPU (`rayon`) implementation whenever GPU (`wgpu` / `OpenCL`) acceleration is unavailable. Developers never need to manage device preferences or fallbacks—the engine opaquely guarantees maximum throughput across any execution environment.

## Packages & Native Bindings

This repository is organized into multiple components, exposing the native Rust core to different ecosystems:

| Package | Description |
|---|---|
| `nano-rspow` | **Rust Crate** — Core library containing the cryptographic logic, hybrid race engine, and GPU backends. |
| `nano-rspow-node` | **NPM Package** — Native, zero-overhead bindings for Node.js and TypeScript. See [`nano-rspow-node`](nano-rspow-node/README.md). |
| `nano-rspow-python` | **Python Package** — Native module bindings for Python environments. See [`nano-rspow-python`](nano-rspow-python/README.md). |
| `nano-rspow-cli` | **CLI Tool** — Standalone terminal binary for hardware benchmarking and local work generation. |

## Building

```bash
cargo build --release
```

OpenCL support is opt-in:

```bash
cargo build --release --features opencl
```

## CLI

```bash
# Using npx (Zero-install)
npx nano-rspow-node <hash> --type send

# Using pnpm (Zero-install)
pnpx nano-rspow-node <hash> --type send
```

If you have a fresh clone of the repository and the Rust toolchain installed, you can use the native Rust CLI for more granular control (like specifying the backend or running benchmarks):

```bash
cargo run -p nano-rspow-cli -- generate <hash> --backend gpu
```

## Node.js

Pre-compiled binaries are published to npm. See [`nano-rspow-node/README.md`](nano-rspow-node/README.md) or the [`nano-rspow-node` npm package](https://www.npmjs.com/package/nano-rspow-node).

## License

MIT — see `LICENSE`. Attribution required per license terms.
