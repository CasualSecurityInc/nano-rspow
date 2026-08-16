# Browser PoW comparison

This page compares Epoch 2 send-work searches from four browser providers for
the same randomly generated work roots: nano-rspow-web v0.10.0,
nanocurrency v2.5.0's WASM-backed `computeWork`, nano-pow v5.2.2, and
nano-webgl-pow v1.1.1.

Provider package names and pinned versions:

| UI provider | Exact NPM package | Version | How it is supplied |
| --- | --- | --- | --- |
| nano-rspow-web | `nano-rspow-web` | `0.10.0` | Local package files in this repository |
| nanocurrency | `nanocurrency` | `2.5.0` | Pinned local NPM dependency |
| nano-pow | `nano-pow` | `5.2.2` | Pinned local NPM dependency |
| nano-webgl-pow | `nano-webgl-pow` | `1.1.1` | Pinned local NPM dependency |

`nano-webgl-pow` is a legacy WebGL2 browser implementation. It is included as
a distinct GPU baseline for now and can be replaced without changing the
benchmark's provider interface if a better-maintained competitor is selected.

Build the fully local static site once while dependencies are available:

```bash
cd nano-rspow-web
cd benchmark-compare
make
```

`make` rebuilds only when its local source files or pinned dependencies changed,
then serves `dist/` at `http://localhost:8080/`. Press Ctrl-C to stop it.

`dist/` contains the page, all JavaScript dependencies, the nanocurrency
worker, and the nano-rspow WebAssembly binary. After `npm run build`, serving
that directory does not request esm.sh, npm, or any other external resource.
The npm project, lockfile, `node_modules/`, and `dist/` are all scoped to this
directory; the standard `nano-rspow-web` package and its generated distribution
files are not part of this build.

Each solver can run once per paired round. The page serializes all work and preserves each raw duration; it does not report a misleading average.

The **Start battle** control runs 42 individual searches, cycling
through the selected providers with a 200 ms cool-down between searches. Each
work value is eight bytes whereas the next input root must be 32 bytes, so the
page uses the exact returned nonce repeated four times as the next root. The
scatter plot and summaries update after every search. **Stop!** prevents the
next search after the in-flight solver finishes. The benchmark deliberately does
not cancel an in-flight provider call, keeping the lifecycle comparable across
providers.

The `nanocurrency` provider starts a persistent module-worker pool at page load.
Each worker receives a distinct `workerIndex` partition sized from the browser's
`navigator.hardwareConcurrency`, and all partitions finish before the call is
released, so its CPU-bound WASM search cannot block browser painting or input.
Every returned nonce is independently validated against the shared Epoch 2
send threshold before it is recorded or used as the next battle root.
