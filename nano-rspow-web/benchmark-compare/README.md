# Browser PoW comparison

This local page compares Epoch 2 send-work searches from four providers for
the same randomly generated work roots: the checked-in nano-rspow-web WebAssembly
snapshot, the pinned nano-pow dependency, a local Nano node's JSON-RPC
`work_generate`, and the local `nano-rspow-node` addon.

Provider packages and sources:

| UI provider | Package or executable | How it is supplied |
| --- | --- | --- |
| nano-rspow-web | `nano-rspow-web` | Checked-in WebAssembly snapshot in this directory |
| nano-pow | `nano-pow` | Pinned local NPM dependency |
| Nano node RPC | `work_generate` at `http://127.0.0.1:7076` | Proxied by the local bridge; override with `NANO_NODE_RPC_URL` or `NANO_NODE_RPC_PORT` |
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
to change the defaults. `NANO_NODE_RPC_URL` can point the proxy at an already
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

The **Start battle** control runs 42 individual searches, cycling
through the selected providers with a 200 ms cool-down between searches. Each
work value is eight bytes whereas the next input root must be 32 bytes, so the
page uses the exact returned nonce repeated four times as the next root. The
scatter plot and summaries update after every search. **Stop!** prevents the
next search after the in-flight solver finishes. The benchmark deliberately does
not cancel an in-flight provider call, keeping the lifecycle comparable across
providers.

The bridge returns `providerMs` measured around the upstream JSON-RPC
`work_generate` request or the native addon `generateWork` call. Browser
HTTP/fetch time is excluded from the plotted duration. Every returned nonce is
still independently validated in the browser against the shared Epoch 2 send
threshold before it is recorded or used as the next battle root.
