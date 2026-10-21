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
| Web browser test | `npm run test:browser` (in `nano-rspow-web/`; needs Chrome, set `CHROME_PATH` if it is not found) |

## Web Dashboards
Both dashboards compile `nano-rspow-web` to WebAssembly, so both need the
`wasm32-unknown-unknown` target and the `wasm-bindgen` CLI. All entry points are
`make` targets at the repository root; run `make help` for the list.

| Task | Command |
|------|---------|
| One-time prerequisites | `make web-prereqs` |
| Verify toolchain, change nothing | `./scripts/setup-web-toolchain.sh --check` |
| Browser-only dashboard | `make web-demo` (or `make web-demo-build` to skip the browser) |
| Check the built dashboard | `make web-demo-check` |
| Head-to-head dashboard | `make web-compare-run` (serves `:8080`, override with `PORT=`) |
| Build both dashboards | `make web-all` |
| Discard generated output | `make web-clean` |

* **`browser-demo/index.html` is generated and gitignored.** Never commit it, and
  never rely on a copy being present. `make web-demo-check` is what stands in for
  the safety a committed artifact appeared to give.
* The head-to-head dashboard additionally needs the `nano-rspow-node` native
  addon, which `make web-prereqs` builds. CI does **not** build that dashboard,
  only the browser-only one, because the addon is a platform-specific native
  compile.
* `cargo benchmark-web` still works and is a thin wrapper over the same
  `build-demo.py`; prefer the `make` targets.

## External References
| Need | File |
|------|------|
| Project overview | `README.md` |
| Benchmark results | `PERFORMANCE_BENCHMARK.md` |
| How to measure, and the three benchmarking surfaces | `PERFORMANCE_OBSERVATIONS.md` |

## Version Bumping Rules

* **NEVER edit version numbers in `.json` or `.toml` files manually.**
* All workspace version bumps must be performed exclusively using the version bumper script:
  ```bash
  node scripts/bump-version.js <patch|minor|major|new-version>
  ```
  This keeps `Cargo.toml`, `nano-rspow-cli/Cargo.toml`, and the `package.json` **and `package-lock.json`** of both `nano-rspow-node` and `nano-rspow-web` synchronized. The npm lockfiles are version-bearing and `npm ci` does not reconcile them, so they must be bumped explicitly. `nano-rspow-python` needs nothing: its `pyproject.toml` declares a dynamic version that maturin derives from `Cargo.toml`.
* After bumping, run `cargo check --all-targets` to refresh `Cargo.lock` and verify consistency before committing.
* **Version policy:** `Cargo.toml` is the single source of truth. `major.minor` must be identical across Cargo, Node and Web; **patch versions may diverge independently**, and each publish workflow gates on its own package's version already being absent from its registry. `version-check.yml` enforces the policy plus lockfile agreement on every push and pull request.
* Release by tagging from the repo root and pushing: `git tag v<new-version> && git push origin v<new-version>`.

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

## Benchmarking
There are **three separate benchmarking surfaces** and they are not
interchangeable. See `PERFORMANCE_OBSERVATIONS.md` for the full taxonomy and
comparison rules.

1. **Core CLI** — the Rust crate only, in a terminal. The only surface whose
   numbers belong in `PERFORMANCE_BENCHMARK.md`, and filing them there is a
   manual step.
2. **Browser-only page** — `nano-rspow-web` in one tab. Records nothing.
3. **Head-to-head suite** — `nano-rspow-web` against `nano-pow`, the node addon
   and the Rust work peer, behind a local dev server. Records nothing, and its
   competitor list is data in `app.js` that a developer may edit per
   investigation, so it is not guaranteed reproducible.

Never file a surface 2 or 3 number in `PERFORMANCE_BENCHMARK.md`. No benchmark
runs in CI.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
