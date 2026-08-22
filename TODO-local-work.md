# Local Nano work production

Status: ordered parallel tracks. Track 1 ships first. Track 2 starts from the
stable FFI and release conventions established by Track 1, but does not wait
for the work-peer runtime to become a dependency.

## Shared decisions

- Keep Rust as the work-generation source of truth.
- Do not reimplement Nano PoW in Go.
- Do not bind Go directly to `wgpu-native`.
- Keep CPU fallback available on every supported target.
- Treat GPU support as opportunistic runtime acceleration.
- Test generated work against the existing Nano known vectors.

## Track 1: Nano-compatible local work peer

Deliver a `nano-rspow serve` subcommand in the existing `nano-rspow` binary.
Keep the server implementation separate from Clap command parsing so a future
dedicated daemon alias remains inexpensive.

### Contract

- Match the documented Nano work-server RPC actions:
  `work_generate`, `work_cancel`, `work_validate`, `status`, and `benchmark`.
- Match Nano work-peer request and response field names and hexadecimal encoding.
- Support threshold and multiplier inputs with the Nano difficulty rules.
- Return the response fields expected by configured Nano nodes.
- Reject malformed hashes, work values, thresholds, multipliers, and actions.
- Default to `127.0.0.1:7076`.
- Require an explicit `--listen` value for non-loopback binding.
- Do not promise internet exposure or authentication in v1.

### Runtime

- Initialize one selected `WorkGenerator` and keep it alive for the process.
- Route generation through one bounded FIFO queue.
- Track active requests by hash for `work_cancel`.
- Return cancellation, queue-full, timeout, and backend errors explicitly.
- Keep validation and status responsive while generation is active.
- Expose active backend, queue size, and generation state in `status`.
- Keep the existing CPU, wgpu, and optional OpenCL backend selection model.

### Delivery and verification

- Add CLI parsing, unit tests, and HTTP contract tests for every action.
- Test cancellation, duplicate hashes, queue saturation, invalid input, and shutdown.
- Add a Nano known-vector client fixture that exercises the full request flow.
- Add tagged-release artifacts for macOS x64/ARM64, Linux x64/ARM64, and Windows x64.
- Publish SHA-256 checksums with the five binary archives.
- Document local and remote-node configuration, firewall boundaries, and CPU fallback.

## Track 2: Native Go module

Deliver a Go module that calls the Rust engine through a narrow C ABI.
Require CGO for the accelerated native implementation. Do not require Go code
to know Rust or wgpu types.

### Native boundary

- Add an FFI crate or equivalent Rust library target with `staticlib` and `cdylib` outputs.
- Expose opaque generator and request handles only.
- Pass fixed-size hash bytes, thresholds, and nonces through C-compatible types.
- Return explicit status codes and plain result structs.
- Provide generator creation, generation, cancellation, validation, backend name, and diagnostics.
- Keep GPU state, worker threads, allocation, and error conversion inside Rust.
- Never retain Go pointers or invoke Go callbacks from the Rust engine.
- Convert Rust panics and invalid inputs into FFI errors.

### Go package and distribution

- Provide typed Go wrappers with Go ownership and error semantics.
- Publish prebuilt native artifacts for the supported target matrix.
- Keep the first matrix aligned with the existing native release targets.
- Document `CGO_ENABLED=1`, compiler prerequisites, driver prerequisites, and CPU fallback.
- Verify that `go get` plus a known-vector generation/validation test works on each target.
- Measure cgo overhead separately from PoW throughput.

## Order and handoff

1. Track 1 defines the operator-facing work contract and release artifact baseline.
2. Track 2 may reuse release-matrix and known-vector test conventions, but keeps its FFI ABI versioned independently.
3. Do not make the work-peer server depend on the Go module.
4. Do not make either track require CUDA before the existing wgpu and CPU paths are stable.
