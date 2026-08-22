# nano-rspow-go

Typed Go bindings for the native `nano-rspow` engine. The package uses a
versioned, narrow C ABI (`nano-rspow-ffi`) and keeps Rust in charge of all
proof-of-work, GPU state, worker threads, and allocation. It does not bind
`wgpu-native` and it does not reimplement Nano PoW in Go.

## Source checkout

The current source-checkout workflow builds the native library and then runs
the Go tests:

```sh
cargo build -p nano-rspow-ffi
CGO_ENABLED=1 go test ./...
```

The default cgo directives look for the header in
`../nano-rspow-ffi/include` and the debug native library in `../target/debug`.
To use a release build or an externally installed native artifact, add the
corresponding include and library paths with `CGO_CFLAGS` and `CGO_LDFLAGS`.
For example:

```sh
cargo build --release -p nano-rspow-ffi
CGO_ENABLED=1 \
  CGO_CFLAGS="-I$PWD/../nano-rspow-ffi/include" \
  CGO_LDFLAGS="-L$PWD/../target/release" \
  go test ./...
```

## Runtime and target requirements

The accelerated native implementation requires `CGO_ENABLED=1`, a C compiler,
and a native `nano-rspow-ffi` library built for the exact Go target. CPU work
is always available from the `BackendAuto` generator when a supported GPU or
driver is absent. The wgpu path selects Metal on macOS, Vulkan on Linux, or
Direct3D 12 on Windows at runtime; these are driver prerequisites, not separate
Go APIs. OpenCL remains an optional Rust feature and is not part of the first
Go artifact matrix.

The initial release matrix should follow the existing native bindings:

| Target | Native Rust artifact | Runtime acceleration |
| --- | --- | --- |
| macOS arm64/x86_64 | `staticlib` plus `cdylib` | Metal when available, CPU fallback |
| Linux arm64/x86_64 | `staticlib` plus `cdylib` | Vulkan when available, CPU fallback |
| Windows x86_64 | `staticlib` plus `cdylib` | DX12 when available, CPU fallback |

Published Go releases must ship the header and one native artifact set per
target, selected by the normal Go build tags or cgo target variables. The
artifact publisher must also publish SHA-256 checksums and record the Rust
crate version and ABI version (`nano_rspow_abi_version()`). This repository
currently provides the ABI and source-checkout path; prebuilt Go module
publishing is a separate release task.

## API shape

`NewGenerator(BackendAuto)` selects the best available backend and retains a
CPU fallback. `Generate` accepts a `[32]byte` hash and context, returning a
typed `WorkResult`; cancellation signals an opaque Rust request handle.
`Validate`, `BackendName`, and `Diagnostics` are synchronous. No Go pointer is
retained by Rust and no Rust callback enters Go.

The cgo call itself is intentionally not used as a throughput claim. Benchmark
the native `Generate` path separately from a no-op cgo call when comparing
bindings; proof-of-work throughput is dominated by the selected Rust backend.

## Streaming CLI

The module also contains a small streaming CLI at `cmd/nano-rspow-go`. It is
not a separate Go module or package: build it from this module after building
the native library:

```sh
cargo build -p nano-rspow-ffi
go build -o ./bin/nano-rspow-go ./cmd/nano-rspow-go
```

With no arguments it uses the same newline-delimited protocol as
`nano-rspow generate --stream`:

```text
<hash_hex>[:0x<threshold_hex>]
<hash_hex>:0x<threshold_hex>:<work_hex>
```

Blank lines are ignored and malformed requests are reported to stderr while
the stream continues. `--help` is the only supported argument.
