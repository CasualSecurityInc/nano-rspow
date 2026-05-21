# WASM Build Notes

## reference-types and multivalue (Rust ≥ 1.82)

Since Rust 1.82, the `reference-types` and `multivalue` WebAssembly proposals are enabled by default in the compiler. wasm-bindgen automatically detects these features in the compiled binary and activates its corresponding code-generation transformations, producing JS glue that uses `externref` table operations (`table.grow`, `table.get`, `table.set`) to manage JS object handles.

The wasm-bindgen documentation explicitly lists `reference-types` support as confirmed only for Firefox 79+ and Chrome. Safari is unlisted. In practice this means the emitted `__wbindgen_externrefs` table machinery may silently fail or panic on Safari 15 and below, and potentially on other non-conformant WebKit builds. This has been observed in production by other projects (e.g. Ruffle, see [wasm-bindgen#4227](https://github.com/wasm-bindgen/wasm-bindgen/issues/4227)).

**Current status:** As of the time of writing, our WASM module works correctly on current Safari — the CPU PoW path, cancel token, and result types all function. The `externref` machinery is active in our binary (confirmed via `wasm-objdump` and `grep` on the built artifact) but has not triggered failures on shipping Safari versions we test against. This is a latent risk, not an active bug.

**To verify whether your build is affected:**

```bash
# Check for reference-types/multivalue/externref in the compiled WASM binary
python3 -c "
data = open('target/wasm32-unknown-unknown/release/nano_rspow_web.wasm','rb').read()
for term in [b'reference-types', b'multivalue', b'target_features', b'externref']:
    idx = data.find(term)
    print(f'{term}: {\"found at \" + str(idx) if idx >= 0 else \"not found\"}')
"
```

**To eliminate the risk** (at the cost of requiring nightly Rust or pinning to ≤ 1.81):

```bash
# Nightly only — disable reference-types and multivalue at the rustc level
RUSTFLAGS="-C target-feature=-reference-types,-multivalue" cargo build \
  -Z build-std=std,panic_abort \
  --target wasm32-unknown-unknown \
  --release
```

Or pin `rust-toolchain.toml` to `1.81` to stay on stable without these defaults.

The `wasm32v1-none` target (stable since Rust 1.84) is the long-term clean solution, but requires all dependencies including `wgpu` to be `no_std`-compatible, which is not currently the case.

## Safari WebGPU Compute Readback (resolved)

A Safari bug previously caused WebGPU compute shaders to return zeros on readback. This was
fixed by fully unrolling the 12 Blake2b rounds in the WGSL shader (eliminating dynamic
indexing into `SIGMA[]` which Safari's Metal compiler rejected) and switching to
fixed-constant rotation helpers (`rotr32/24/16/63`). Safari is now fully supported.
