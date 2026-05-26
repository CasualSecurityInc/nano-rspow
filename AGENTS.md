# Agent Instructions — nano-rspow

This file contains critical, unavoidable rules that all AI coding agents working on this repository **MUST** follow at all times.

## Package Manager
- Use **npm** for JS packages (`nano-rspow-node/`, `nano-rspow-web/`)

## Commands
| Task | Command |
|------|---------|
| Rust check | `cargo check --all-targets` |
| Rust test | `cargo test` |
| Rust bench | `cargo bench --bench pow_benchmark` |
| CLI benchmark | `cargo run --all-features --release -- benchmark --format markdown --backend all` |
| WASM web bench | `cargo run --release --package nano-rspow-web --example benchmark_web` |
| Node native build | `npm run build` (in `nano-rspow-node/`) |
| WASM web build | `npm run build` (in `nano-rspow-web/`) |

## External References
| Need | File |
|------|------|
| Project overview | `README.md` |
| Benchmark results | `PERFORMANCE_BENCHMARK.md` |

## Version Bumping Rules

* **NEVER edit version numbers in `.json` or `.toml` files manually.**
* All workspace version bumps must be performed exclusively using the version bumper script:
  ```bash
  node scripts/bump-version.js <patch|minor|major|new-version>
  ```
  This ensures versions across `Cargo.toml`, `nano-rspow-node/package.json`, and `nano-rspow-web/package.json` remain synchronized.
* After bumping, run `cargo check --all-targets` to update lockfiles and verify consistency before committing.

## Package Publishing Rules (Node.js)

* **NEVER run `npm publish` locally.** Publishing is handled exclusively by the GitHub Actions release workflow (`.github/workflows/node-publish.yml`) via OIDC Trusted Publishing.
* **NEVER suggest adding an `NPM_TOKEN` secret** to GitHub or anywhere else. Authentication to npm is via OIDC; no token is needed.
* To trigger a release: bump version, create a tag from the **repo root**, and push it:
  ```bash
  git tag v<new-version>
  git push origin v<new-version>
  ```

## Key Conventions
- Performance-sensitive library — all benchmarks and profiling MUST use `--release` regardless of command.
- Rust workspace root is `Cargo.toml`; sub-crates live in their own directories.
- Generated npm packages (`nano-rspow-web/nano_rspow_web.js`, `*.wasm`): build via `npm run build` in that directory; do not edit by hand.

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: <agent name and attribution>
```
