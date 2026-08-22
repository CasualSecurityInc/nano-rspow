# nano-rspow CLI

High-performance CLI for Nano (XNO) Proof of Work generation and validation. Supports CPU, GPU (wgpu), and OpenCL backends with automatic hardware detection.

Current Nano mainnet thresholds are `0xfffffff800000000` for send/change
blocks and `0xfffffe0000000000` for receive/open/epoch blocks. The
`0xffffffc000000000` threshold is legacy epoch-1 work only.

## Install

```bash
cargo install nano-rspow-cli
```

Or build from the monorepo:

```bash
cargo build -p nano-rspow-cli --release
```

The package installs the `nano-rspow` executable.

## Commands

### `generate`

Generate PoW for a block hash.

```bash
# Default: GPU backend, epoch2 send threshold
nano-rspow generate 718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2

# Force CPU backend
nano-rspow generate <hash> --backend cpu

# Custom threshold
nano-rspow generate <hash> --threshold 0xffffffc000000000 # legacy epoch-1 only

# Streaming mode (newline-delimited stdin/stdout)
echo '<hash>' | nano-rspow generate --stream
```

### `validate`

Check that a work value satisfies the difficulty threshold.

```bash
nano-rspow validate <hash> <work>
nano-rspow validate <hash> <work> --threshold 0xfffffff800000000
```

### `benchmark`

Benchmark all available backends.

```bash
# Default: 5 iterations, table output
nano-rspow benchmark

# 20 iterations, markdown output
nano-rspow benchmark --count 20 --format markdown

# JSON output
nano-rspow benchmark --format json

# Specific backend and tier
nano-rspow benchmark --backend gpu --tier ep2_send
```

### `info`

Print detected backends and GPU information.

```bash
nano-rspow info
```

### `diag`

Detailed backend diagnostics.

```bash
nano-rspow diag
nano-rspow diag --backend gpu --format json
```

### `serve`

Run a local Nano work peer that accepts the standard JSON-over-HTTP work RPC.
It binds to loopback on port 7076 by default:

```bash
nano-rspow serve
nano-rspow serve --backend cpu
nano-rspow serve --listen 0.0.0.0:7076 --queue-size 64
```

The default is loopback-only. Binding to a LAN or public address requires
passing `--listen` explicitly and should be protected by the network firewall.
The server keeps one selected generator and processes work requests in a
bounded FIFO queue, so GPU state is reused and validation/status requests stay
responsive while work is running.

The endpoint accepts the Nano work-server actions `work_generate`,
`work_cancel`, `work_validate`, `status`, and `benchmark` as POST requests to
`/`. Requests and responses use the same JSON field names as Nano RPC. A
successful `work_generate` response contains `work`, `difficulty`,
`multiplier`, and the echoed `hash`, for example:

```bash
curl -s http://127.0.0.1:7076 \
  -H 'content-type: application/json' \
  -d '{"action":"work_generate","hash":"718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2"}'
```

`work_generate` and `work_validate` accept an optional hexadecimal
`difficulty` or numeric `multiplier`; `multiplier` takes precedence. The
server defaults to the current epoch-2 send/change threshold. `work_cancel`
cancels the active request and removes queued requests for the same hash.
`status` reports the active generation flag and waiting queue size.

## Global Flags

| Flag | Description |
|------|-------------|
| `--help` | Show help for any command |
| `--version` | Print version |

## Source

Part of the [nano-rspow](https://github.com/CasualSecurityInc/nano-rspow) workspace.
