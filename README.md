# nano-rspow

nano-rspow generates and validates [Nano](https://www.nano.org) proof of work on CPU and supported GPU backends. The workspace contains Rust, CLI, Node.js, Python, and browser WebAssembly packages.

The native core selects an available GPU backend when possible and otherwise uses its multi-threaded CPU backend. The browser package tries WebGPU, then falls back to single-threaded WebAssembly CPU execution.

## Current Nano thresholds

For current Nano mainnet blocks, use the send/change floor
`fffffff800000000` or the receive/open/epoch floor `fffffe0000000000`.
These are convenience presets, not an upper limit: every binding also accepts
an arbitrary threshold when the node that will publish the block requires a
stricter value. Historical Epoch 1 thresholds are isolated in explicitly named
legacy APIs. See Nano's [Work Generation guide](https://docs.nano.org/integration-guides/work-generation/)
for the network requirements.

---

## 🎯 Who is this for?

* **Exchange and wallet integrators** that need in-process work generation.
* **Server-side developers** using native Node.js or Python bindings.
* **Web developers** that need browser WebAssembly with an optional WebGPU path.
* **Node operators** that need a CLI to generate, validate, or benchmark work.

---

## ⚡ Quick Start

### 1. Standalone CLI
Install from crates.io (requires a Rust toolchain):
```bash
cargo install nano-rspow-cli
nano-rspow benchmark --count 10

# Run a loopback Nano work peer on 127.0.0.1:7076
nano-rspow serve
```
Alternatively, build from this repository:
```bash
cargo build -p nano-rspow-cli --release
./target/release/nano-rspow benchmark --count 10
```
Or use `cargo run -p nano-rspow-cli -- <args>` to build and execute in one step.

### 2. Node.js (Programmatic API)
Use the native bindings for in-process PoW generation:
```bash
npm install nano-rspow-node
```
See the [nano-rspow-node README](https://github.com/CasualSecurityInc/nano-rspow/blob/HEAD/nano-rspow-node/README.md) for API usage.

### 3. Interactive Web Dashboard
Build and open the self-contained browser dashboard. It tests WebGPU and a Web Worker CPU fallback:

```bash
make web-prereqs    # once, after cloning: wasm32 target, wasm-bindgen, npm deps
make web-demo       # build the dashboard and open it
```

`make web-prereqs` adds the `wasm32-unknown-unknown` Rust target, checks for the
`wasm-bindgen` CLI and explains how to install it if absent, and installs the npm
dependencies. It is safe to re-run. After that:

```bash
make web-demo-check   # is the built page present, complete and up to date?
make web-clean        # discard the generated dashboard
```

The dashboard is written to `nano-rspow-web/browser-demo/index.html` as a single
self-contained file — the WebAssembly, the wasm-bindgen glue and the WGSL shader
are all inlined, so it runs straight from disk. It is **generated, not
committed**, so a stale copy can never be opened by mistake; `make web-demo-check`
tells you if the copy on disk is missing or older than the crate.

There is also a head-to-head dashboard that compares this package against
`nano-pow`, the `nano-rspow-node` addon and the Rust CLI work peer. It needs the
native addon, so it is a separate target: `make web-compare-run` serves it on
<http://localhost:8080/>. See the
[nano-rspow-web README](https://github.com/CasualSecurityInc/nano-rspow/blob/HEAD/nano-rspow-web/README.md)
for the full set of options.

---

## 📦 Documentation & Release Channels

Below is the directory mapping for each target, along with their primary release registries:

| Environment | Documentation Link | Latest Releases & Authoritative Registries |
| :--- | :--- | :--- |
| **Rust (Core)** | [crate API documentation](nano-rspow/src/lib.rs) | [GitHub Releases](https://github.com/CasualSecurityInc/nano-rspow/releases) |
| **Node.js & TS** | [nano-rspow-node README](https://github.com/CasualSecurityInc/nano-rspow/blob/HEAD/nano-rspow-node/README.md) | [Public NPM package](https://www.npmjs.com/package/nano-rspow-node) |
| **Python** | [nano-rspow-python README](nano-rspow-python/README.md) | [PyPI (pip)](https://pypi.org/project/nano-rspow-python/) |
| **Go** | [nano-rspow-go README](nano-rspow-go/README.md) | Go module source checkout |
| **Web (WASM / WebGPU)** | [nano-rspow-web/README.md](nano-rspow-web/README.md) | [Public NPM package](https://www.npmjs.com/package/nano-rspow-web) + [🎛️ Demo](https://csi.ninzin.net/nano-rspow/) |
| **CLI Tool** | [nano-rspow-cli README](nano-rspow-cli/README.md) | The only full-featured `nano-rspow` executable: [crates.io](https://crates.io/crates/nano-rspow-cli) · [GitHub Releases](https://github.com/CasualSecurityInc/nano-rspow/releases) |

---

## 🗂️ Repository Layout

This monorepo is organized into specialized workspaces to deliver native performance across all environments:

```
.
├── .cargo/                 # Target-specific build configurations and cargo aliases
├── nano-rspow/             # Core Rust library containing cryptographic Blake2b logic & backends
├── nano-rspow-ffi/          # C ABI used by the Go bindings
├── nano-rspow-cli/         # Standalone CLI binary for hardware benchmarking & generation
├── nano-rspow-go/           # Go module and nano-rspow-go streaming CLI
├── nano-rspow-node/        # High-performance Node.js & TypeScript native bindings (N-API)
├── nano-rspow-python/      # Native PyO3 bindings for Python environments
└── nano-rspow-web/         # Web/WASM target crate & the two HTML benchmarking dashboards
```

---

## 🔒 License

MIT License. See [LICENSE](LICENSE). Distributions must include the copyright and permission notices.
