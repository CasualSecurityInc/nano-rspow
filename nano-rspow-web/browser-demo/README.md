# Browser-only benchmarking dashboard

A single self-contained page that benchmarks this package's two backends —
WebGPU and single-threaded WASM CPU — entirely in the browser, with no server.

**`index.html` is generated and is not committed.** Build it from the
repository root:

```bash
make web-demo          # build it and open it
make web-demo-build    # build it without launching a browser
```

If the file is missing, truncated, or older than the crate source, that is
expected and the check will say so:

```bash
make web-demo-check
```

It exists because a committed 550 KB WebAssembly-bearing page eventually gets
opened after the crate has moved on, and then quietly benchmarks an old module.
Generating it means that cannot happen; the check is what replaces the safety a
committed copy appeared to offer.

The published copy needs no build at all:
<https://casualsecurityinc.github.io/nano-rspow/>

## Files

| File | Role |
| --- | --- |
| `index.template.html` | Page shell, styling, and the placeholders the build fills in |
| `demo.js` | Dashboard behaviour: difficulty selection, generation, validation, console |
| `build-demo.py` | Compiles the crate to `wasm32`, runs `wasm-bindgen`, inlines everything into `index.html` |
| `build-self-contained.mjs` | Older alternative builder; `build-demo.py` is the one to use |
| `index.html` | Build output. Generated, gitignored |
| `pkg/` | Intermediate `wasm-bindgen` output, removed by the build |

`build-demo.py` needs `cargo`, the `wasm32-unknown-unknown` target and the
`wasm-bindgen` CLI. `make web-prereqs` from the repository root installs and
verifies all of it, along with everything the head-to-head dashboard needs.
