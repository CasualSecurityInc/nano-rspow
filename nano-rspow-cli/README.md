# nano-rspow-cli

High-performance CLI for Nano (XNO) Proof of Work generation and validation. Supports CPU, GPU (wgpu), and OpenCL backends with automatic hardware detection.

## Install

```bash
cargo install nano-rspow-cli
```

Or build from the monorepo:

```bash
cargo build -p nano-rspow-cli --release
```

## Commands

### `generate`

Generate PoW for a block hash.

```bash
# Default: GPU backend, epoch2 send threshold
nano-rspow-cli generate 718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2

# Force CPU backend
nano-rspow-cli generate <hash> --backend cpu

# Custom threshold
nano-rspow-cli generate <hash> --threshold 0xffffffc000000000

# Streaming mode (newline-delimited stdin/stdout)
echo '<hash>' | nano-rspow-cli generate --stream
```

### `validate`

Check that a work value satisfies the difficulty threshold.

```bash
nano-rspow-cli validate <hash> <work>
nano-rspow-cli validate <hash> <work> --threshold 0xfffffff800000000
```

### `benchmark`

Benchmark all available backends.

```bash
# Default: 5 iterations, table output
nano-rspow-cli benchmark

# 20 iterations, markdown output
nano-rspow-cli benchmark --count 20 --format markdown

# JSON output
nano-rspow-cli benchmark --format json

# Specific backend and tier
nano-rspow-cli benchmark --backend gpu --tier ep2_send
```

### `info`

Print detected backends and GPU information.

```bash
nano-rspow-cli info
```

### `diag`

Detailed backend diagnostics.

```bash
nano-rspow-cli diag
nano-rspow-cli diag --backend gpu --format json
```

## Global Flags

| Flag | Description |
|------|-------------|
| `--help` | Show help for any command |
| `--version` | Print version |

## Source

Part of the [nano-rspow](https://github.com/CasualSecurityInc/nano-rspow) workspace.
