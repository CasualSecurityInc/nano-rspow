# Browser PoW comparison

This local page compares current send-work searches from four providers for
the same randomly generated work roots: the checked-in nano-rspow-web WebAssembly
snapshot, the pinned nano-pow dependency, the local nano-rspow work peer's
Nano-compatible JSON-RPC `work_generate`, and the local `nano-rspow-node` addon.

Provider packages and sources:

| UI provider | Package or executable | How it is supplied |
| --- | --- | --- |
| nano-rspow-web | `nano-rspow-web` | Checked-in WebAssembly snapshot in this directory |
| nano-pow | `nano-pow` | Pinned local NPM dependency |
| nano-rspow (RPC) | `work_generate` at `http://127.0.0.1:7076` | Proxied by the local bridge; override with `NANO_WORK_URL` or `NANO_WORK_PORT` |
| nano-rspow-node | local `nano-rspow-node/index.js` | Native addon loaded by the bridge once |

`nanocurrency` remains a pinned local dependency only for browser-side work
validation. Neither its compute worker nor `nano-webgl-pow` is used at runtime
by this temporary experiment.

Build the fully local static site once while dependencies are available:

```bash
cd nano-rspow-web
cd benchmark-compare
make
```

`make` rebuilds the browser bundle when needed, builds the Rust CLI in release
mode, and starts both the local work peer and the proxy. The work peer listens
on `http://127.0.0.1:7076`; the proxy serves the page at
`http://localhost:8080/`. Set `WORK_PEER_PORT`, `WORK_PEER_BACKEND`, or `PORT`
to change the defaults. `NANO_WORK_URL` can point the proxy at an already
running external work peer instead. Press Ctrl-C once; the process supervisor
stops both child processes.

`dist/` contains the page, all browser JavaScript dependencies, and the
nano-rspow WebAssembly binary. The bridge also exposes `/api/health`,
`/api/pow/rpc`, and `/api/pow/node`; it loads the local native binding and
serves the static files. After `npm run build`, browser assets do not request
esm.sh, npm, or any other external resource.
The npm project, lockfile, `node_modules/`, and `dist/` are all scoped to this
directory; the standard `nano-rspow-web` package and its generated distribution
files are not part of this build.

Each solver runs once per paired round. The page serializes work and preserves each raw duration; it does not calculate an average.

## Shared-generator self-check

`nano-rspow-web` builds one WebGPU generator per page and reuses it, and
serializes generation because the generator's ping-pong buffers are shared:
overlapping calls would write the same slot and read back each other's results,
handing back work computed for a different root. The **Run shared-generator
self-check** button guards that. It starts four `nano-rspow-web` searches with
distinct roots and thresholds before awaiting any of them, then validates every
returned nonce against its own inputs using `validate_work`, and reports how many
device bring-ups were observed. One bring-up across the four calls means the
generator was reused; more than one means it is being rebuilt per call.

The check is separate from the benchmark on purpose, because the benchmark
serializes providers and would never exercise the concurrent path. It is
disabled while a benchmark is running so it cannot perturb a measurement. Its
thresholds sit in the easy dev band to keep it quick; the aliasing it guards
against depends on which slot a call writes, not on how hard the work is.

The same check is available on the browser demo as **Run shared-generator
self-check** under Execution Diagnostics.

## Refreshing the checked-in WebAssembly

`nano_rspow_web.js` and `nano_rspow_web_bg.wasm` in this directory are a
snapshot, not build output of `make`. After changing the `nano-rspow-web` crate,
regenerate them or the page will keep benchmarking the old module:

```bash
cd nano-rspow-web && npm run build
cp nano_rspow_web.js nano_rspow_web_bg.wasm benchmark-compare/
cd benchmark-compare && npm run build
```

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
