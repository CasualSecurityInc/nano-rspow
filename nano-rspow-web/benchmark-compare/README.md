# Browser PoW comparison

This local page compares current send-work searches from four providers for
the same randomly generated work roots: the nano-rspow-web WebAssembly module
compiled from this repository, the pinned nano-pow dependency, the local nano-rspow work peer's
Nano-compatible JSON-RPC `work_generate`, and the local `nano-rspow-node` addon.

Provider packages and sources:

| UI provider | Package or executable | How it is supplied |
| --- | --- | --- |
| nano-rspow-web | `nano-rspow-web` | Compiled from source by this directory's build |
| nano-pow | `nano-pow` | Pinned local NPM dependency |
| nano-rspow (RPC) | `work_generate` at `http://127.0.0.1:7076` | Proxied by the local bridge; override with `NANO_WORK_URL` or `NANO_WORK_PORT` |
| nano-rspow-node | local `nano-rspow-node/index.js` | Native addon loaded by the bridge once |

`nanocurrency` remains a pinned local dependency only for browser-side work
validation. Neither its compute worker nor `nano-webgl-pow` is used at runtime
by this temporary experiment.

## Building

From the repository root:

```bash
make web-prereqs      # once, after cloning; builds the native addon
make web-compare-run  # builds and serves on http://localhost:8080/
```

Or from inside this directory, `make` does both. `make build` compiles and
bundles into `dist/` without serving, `make prereqs` runs the shared toolchain
setup, and `make clean` removes the generated output. Press Ctrl-C once to stop
the work peer and the proxy.

The WebAssembly module is compiled from source by `build.mjs`, so the page
always benchmarks the current crate and there is no artifact to copy around.
An earlier version of this directory checked in a prebuilt
`nano_rspow_web_bg.wasm` and asked developers to refresh it by hand after
changing the crate, which meant the page could silently benchmark a stale
build. It did, for months. Do not reintroduce a checked-in module.

`make build` on its own only rebuilds when a source file is newer than the last
build; `make` builds and starts. The work peer listens on
`http://127.0.0.1:7076` and the proxy serves the page on `http://localhost:8080/`.
Set `WORK_PEER_PORT`, `WORK_PEER_BACKEND`, or `PORT` to change the defaults.
`NANO_WORK_URL` can point the proxy at an already running external work peer
instead.

`dist/` contains the page, all browser JavaScript dependencies, and the
nano-rspow WebAssembly binary. The bridge also exposes `/api/health`,
`/api/pow/rpc`, and `/api/pow/node`; it loads the local native binding and
serves the static files. After `npm run build`, browser assets do not request
esm.sh, npm, or any other external resource.

Each solver runs once per paired round. The page serializes work and preserves each raw duration; it does not calculate an average.

The **Start battle** control runs 42 searches per selected provider, cycling
through them with a 200 ms cool-down between searches. With four providers that
is 168 total searches. Each work value is eight bytes whereas the next input
root must be 32 bytes, so the page uses the exact returned nonce repeated four
times as the next root. The scatter plot and summaries update after every
search. **Stop!** prevents the next search after the in-flight solver finishes.
The benchmark deliberately does not cancel an in-flight provider call, keeping
the lifecycle comparable across providers.

The bridge preserves the upstream Nano `work_generate` response and adds
proxy-only metadata under `_benchmark`: `providerMs` measures the upstream
JSON-RPC request or native addon `generateWork` call, and `backend` identifies
the selected provider. Browser HTTP/fetch time is excluded from the plotted
duration. Every returned nonce is still independently validated in the browser
against the shared current send threshold before it is recorded or used as the
next battle root.
