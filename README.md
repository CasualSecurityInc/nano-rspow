# nano-rspow

nano-rspow is a blisteringly fast, zero-configuration hybrid CPU/GPU proof-of-work generator and block signing library for [Nano](https://www.nano.org).

Developed for high-throughput node operations, client-side web integrations, and native app developers, this repository packages an optimized Blake2b hashing engine under a transparent, auto-detecting **hybrid race architecture**. It seamlessly runs multi-threaded CPU solvers (powered by `rayon` and Web Workers) or GPU pipelines (`wgpu`, `OpenCL`, and WebGPU) depending on target hardware availability. No boilerplate, no device selection headaches—just instant, maximum-performance PoW generation everywhere.

---

## 🎯 Who is this for?

* **Exchange & Wallet Integrators** wanting low-latency, high-volume block generation and local signing.
* **Server-side Developers** using Node.js or Python who need native bindings running at C-level execution speed.
* **Frontend Web Developers** building sleek wallets or dApps requiring non-blocking WASM and hardware-accelerated WebGPU directly in user browsers.
* **Power Users & Node Operators** looking for an ultra-fast benchmarking tool to tune threshold multipliers.

---

## 🗂️ Repository Layout

This monorepo is organized into specialized workspaces to deliver native performance across all environments:

```
.
├── .cargo/                 # Target-specific build configurations and cargo aliases
├── nano-rspow/             # Core Rust library containing cryptographic Blake2b logic & backends
├── nano-rspow-cli/         # Standalone CLI binary for hardware benchmarking & generation
├── nano-rspow-node/        # High-performance Node.js & TypeScript native bindings (N-API)
├── nano-rspow-python/      # Native PyO3 bindings for Python environments
└── nano-rspow-web/         # Web/WASM target crate & self-contained HTML benchmarking dashboard
```

---

## 📦 Documentation & Release Channels

Below is the directory mapping for each target, along with their primary release registries:

| Environment | Documentation Link | Latest Releases & Authoritative Registries |
| :--- | :--- | :--- |
| **Rust (Core)** | [nano-rspow/](nano-rspow/) | [GitHub Releases](https://github.com/CasualSecurityInc/nano-rspow/releases) |
| **Node.js & TS** | [nano-rspow-node/README.md](nano-rspow-node/README.md) | [npm registry](https://www.npmjs.com/package/nano-rspow-node) |
| **Python** | [nano-rspow-python/](nano-rspow-python/) | [PyPI (pip)](https://pypi.org/project/nano-rspow-python/) |
| **Web (WASM / WebGPU)** | [nano-rspow-web/](nano-rspow-web/) | [Interactive Dashboard](nano-rspow-web/browser-demo/index.html) *(Self-contained `index.html`)* |
| **CLI Tool** | [nano-rspow-cli/](nano-rspow-cli/) | [GitHub Releases](https://github.com/CasualSecurityInc/nano-rspow/releases) |

---

## ⚡ Quick Start

### 1. Standalone CLI
Compile and run the native generator directly on your machine:
```bash
# Build binary in release mode
cargo build -p nano-rspow-cli --release

# Generate a smoketest PoW on CPU
cargo run -p nano-rspow-cli -- generate 718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2 --backend cpu --threshold fe00000000000000

# Run a hardware benchmark
cargo run -p nano-rspow-cli -- benchmark --count 10
```

### 2. Node.js & CLI (Zero-Install)
Execute instantly using precompiled native binaries via npm or pnpm:
```bash
npx nano-rspow-node 718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2 --type send
```

### 3. Interactive Web Dashboard
Build and open the self-contained HTML5 benchmarking tool with real-time performance stats, non-blocking Web Worker fallback, WebGPU execution, and customizable cellular-signal difficulty thresholds:
```bash
cargo benchmark-web
```

---

## 🔒 License

MIT License. See [LICENSE](LICENSE) for more details. Attribution is required.
