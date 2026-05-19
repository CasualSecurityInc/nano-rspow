# nano-rspow

A Nano (XNO) Proof-of-Work engine written in Rust.

Implements the Blake2b threshold search using a **hybrid race architecture**: CPU (`rayon`) and GPU (`wgpu` / `OpenCL`) run concurrently and the first to find a valid nonce cancels the other. On GPU-capable hardware the GPU typically wins; on CPU-only systems the multi-core path runs uncontested. Running both simultaneously means rayon occupies all CPU cores, which can marginally reduce GPU driver throughput — if you know your GPU is dominant, driving it exclusively may be slightly more efficient.

## Crates

| Crate | Description |
|---|---|
| `nano-rspow` | Core library — Blake2b PoW, hybrid race engine, GPU backends |
| `nano-rspow-cli` | Standalone CLI for benchmarking and local work generation |
| `nano-rspow-node` | NAPI-RS bindings — see [`nano-rspow-node`](nano-rspow-node/README.md) |

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
