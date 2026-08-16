# Browser PoW comparison

This page compares Epoch 2 send-work searches from four browser providers for
the same randomly generated work roots: nano-rspow-web v0.10.0, the vendored
NanoPow v5.1.13 bundle, nanocurrency v2.5.0's WASM-backed `computeWork`, and
the published nano-pow v5.2.2 package.

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

The **Start ping-pong battle** control runs 42 individual searches, cycling
through all four providers with a 200 ms cool-down between searches. Each
work value is eight bytes whereas the next input root must be 32 bytes, so the
page uses the exact returned nonce repeated four times as the next root. The
scatter plot and summaries update after every search. **Stop!** prevents the
next search after the in-flight solver finishes; neither browser implementation
currently exposes cancellation for a running search.

The `nanocurrency` provider starts a module-worker pool at page load. Each
worker receives a distinct `workerIndex` partition sized from the browser's
`navigator.hardwareConcurrency`, so its CPU-bound WASM search cannot block
browser painting or input.
Every returned nonce is independently validated against the shared Epoch 2
send threshold before it is recorded or used as the next battle root.
