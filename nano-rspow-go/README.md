# nano-rspow-go

Typed Go bindings for the native `nano-rspow` engine. The package uses a
versioned, narrow C ABI (`nano-rspow-ffi`) and keeps Rust in charge of all
proof-of-work, GPU state, worker threads, and allocation. It does not bind
`wgpu-native` and it does not reimplement Nano PoW in Go.

## Install a published module

Tagged native releases publish a matching `nano-rspow-go/v<version>` tag:

```sh
go get github.com/CasualSecurityInc/nano-rspow/nano-rspow-go@v<version>
```

The generated module includes the C header and static libraries for all five
supported targets. Go selects the library through `GOOS` and `GOARCH`; no Rust
installation, manual library download, or `CGO_LDFLAGS` override is needed.
You still need `CGO_ENABLED=1` and a C compiler. Windows releases use the GNU
Rust target and require MinGW-w64 GCC for cgo. Cross-compilation also requires
a C cross-compiler for the destination platform.

The root `v<version>` tag identifies the source release. The separate
`nano-rspow-go/v<version>` tag points to a generated commit containing the
native libraries; these binaries are not committed to `main`. Use an explicit
published version until the first generated Go release exists.

## Source checkout

On macOS and Linux, the source-checkout workflow builds the native library and
then runs the Go tests:

```sh
cargo build -p nano-rspow-ffi
CGO_ENABLED=1 go test ./...
```

For Windows source builds, use the GNU target and the staged-module commands
in [the release guide](../scripts/release/README.md), substituting
`x86_64-pc-windows-gnu` for the target.

On macOS and Linux, the default cgo directives look for the header in
`../nano-rspow-ffi/include` and link the static native library at
`../target/debug/libnano_rspow_ffi.a`. Published modules link a static library
on all five supported targets, so the resulting binary carries the engine with it and needs no
shared library at runtime. Linking the shared library instead would be a
silent trap: `nano-rspow-ffi` produces a `staticlib` and a `cdylib` with the
same base name in the same directory, and a plain `-l` picks the shared one,
which then has to be found again at run time.

To use a release build or an externally installed native artifact, use the
`nano_rspow_external` build tag. It removes the default debug-library path;
`CGO_CFLAGS` and `CGO_LDFLAGS` then select the header and static archive:

```sh
cargo build --release -p nano-rspow-ffi
CGO_ENABLED=1 \
  CGO_CFLAGS="-I$PWD/../nano-rspow-ffi/include" \
  CGO_LDFLAGS="$PWD/../target/release/libnano_rspow_ffi.a" \
  go test -tags nano_rspow_external ./...
```

## Runtime and target requirements

The accelerated native implementation requires `CGO_ENABLED=1`, a C compiler,
and a native `nano-rspow-ffi` library built for the exact Go target. CPU work
is always available from the `BackendAuto` generator when a supported GPU or
driver is absent. The wgpu path selects Metal on macOS, Vulkan on Linux, or
Direct3D 12 on Windows at runtime; these are driver prerequisites, not separate
Go APIs. OpenCL remains an optional Rust feature and is not part of the first
Go artifact matrix.

The release workflow builds and tests this matrix:

| Target | Native Rust artifact | Runtime acceleration |
| --- | --- | --- |
| macOS arm64/x86_64 | `staticlib` plus `cdylib` | Metal when available, CPU fallback |
| Linux arm64/x86_64 | `staticlib` plus `cdylib` | Vulkan when available, CPU fallback |
| Windows x86_64 | `staticlib` plus `cdylib` | DX12 when available, CPU fallback |

The Rust crate still produces both a `staticlib` and a `cdylib`. The Go
binding links the static library, which is what makes a released Go binary
self-contained. A published shared library remains available for consumers
that want one, but nothing in this module depends on it.

Published Go releases must ship the header and one native artifact set per
target, selected by the normal Go build tags or cgo target variables. The
artifact publisher must also publish SHA-256 checksums and record the Rust
crate version and ABI version (`nano_rspow_abi_version()`). The native release
workflow verifies `go get`, known-vector validation,
generation, and the streaming CLI on each target before publishing the Go tag.
See [the release workflow guide](../scripts/release/README.md).

## API shape

`NewGenerator(BackendAuto)` selects the best available backend and retains a
CPU fallback. `Generate` accepts a `[32]byte` hash and context, returning a
typed `WorkResult`; cancellation signals an opaque Rust request handle.
`Validate`, `BackendName`, and `Diagnostics` are synchronous. No Go pointer is
retained by Rust and no Rust callback enters Go.

## Threshold presets

Import current presets from `thresholds/current`: `current.Send` for send and
change blocks, or `current.Receive` for receive, open, and epoch blocks.
Historical Epoch 1 values are isolated in `thresholds/legacy`; test-only values
are in `thresholds/testing`. `Generate` and `Validate` always accept an
arbitrary `uint64` threshold, including a stricter requirement supplied by a
node. See Nano's [Work Generation guide](https://docs.nano.org/integration-guides/work-generation/)
for current network requirements.

The benchmarks separate the trivial native ABI query (`BenchmarkCGOABI`)
from CPU work generation (`BenchmarkGenerateCPU`). Always link a release build
when measuring them:

```sh
cargo build --release -p nano-rspow-ffi
CGO_ENABLED=1 \
  CGO_LDFLAGS="$PWD/../target/release/libnano_rspow_ffi.a" \
  go test -tags nano_rspow_external -run '^$' -bench 'Benchmark(CGOABI|GenerateCPU)$'
```

The ABI query measures cgo overhead; it is not a PoW throughput result. These
benchmarks run locally and are never part of CI.

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
