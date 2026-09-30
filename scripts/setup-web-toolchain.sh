#!/usr/bin/env bash
#
# One-time local prerequisites for the two web dashboards, plus the toolchain
# checks they need on every run.
#
# Both dashboards compile `nano-rspow-web` to WebAssembly, so both need the
# `wasm32-unknown-unknown` Rust target and the `wasm-bindgen` CLI. The
# head-to-head dashboard additionally needs the `nano-rspow-node` native addon,
# because its bridge loads that addon at startup and the page otherwise sits on
# its loading state with no explanation.
#
# Safe to re-run: every step is skipped when it is already satisfied.
#
#   ./scripts/setup-web-toolchain.sh            # set up and verify everything
#   ./scripts/setup-web-toolchain.sh --check    # verify only, change nothing
#   ./scripts/setup-web-toolchain.sh --skip-addon
#
# --skip-addon omits the native node addon, which is only needed by the
# head-to-head dashboard. The browser-only dashboard does not use it, and
# building it is the slowest step, so CI passes this to check the toolchain
# without paying for a native compile.
#
# CI runs this too, so local and CI agree on what the prerequisites are.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
ok()    { printf '    \033[32mok\033[0m      %s\n' "$1"; }
todo()  { printf '    \033[33mneeded\033[0m  %s\n' "$1"; }
die()   { printf '\n\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: scripts/setup-web-toolchain.sh [options]

  (no options)      Install and verify every prerequisite both dashboards need
  --check           Verify only; change nothing, just report what is outstanding
  --skip-addon      Omit the nano-rspow-node native addon, which only the
                    head-to-head dashboard needs
  -h, --help        Show this help

Safe to re-run: each step is skipped once it is already satisfied.
USAGE
}

CHECK_ONLY=0
SKIP_ADDON=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --skip-addon) SKIP_ADDON=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $arg" ;;
  esac
done

# --- host tools -------------------------------------------------------------

step "Checking host tools"

command -v cargo >/dev/null 2>&1 || die "cargo is required. Install Rust from https://rustup.rs and re-run."
ok "cargo $(cargo --version | awk '{print $2}')"

command -v npm >/dev/null 2>&1 || die "npm is required. Install Node.js 20 or newer and re-run."
ok "node $(node --version), npm $(npm --version)"

command -v python3 >/dev/null 2>&1 || die "python3 is required to build the browser-only dashboard."
ok "python3 $(python3 --version | awk '{print $2}')"

# --- Rust wasm target -------------------------------------------------------

step "Rust target wasm32-unknown-unknown"

if rustup target list --installed 2>/dev/null | grep -qx 'wasm32-unknown-unknown'; then
  ok "target already installed"
elif ! command -v rustup >/dev/null 2>&1; then
  die "rustup is not available, so the wasm32-unknown-unknown target cannot be added automatically.
     Install Rust through rustup (https://rustup.rs) and re-run, or add the target by hand:
       rustup target add wasm32-unknown-unknown"
else
  if [[ $CHECK_ONLY -eq 1 ]]; then
    todo "run: rustup target add wasm32-unknown-unknown"
  else
    rustup target add wasm32-unknown-unknown
    ok "installed"
  fi
fi

# --- wasm-bindgen CLI -------------------------------------------------------
#
# Deliberately not installed here. `cargo install wasm-bindgen-cli` compiles for
# several minutes, and silently spending that on a machine that only needs a
# different fix is worse than saying so.

step "wasm-bindgen CLI"

WASM_BINDGEN_BIN="${WASM_BINDGEN:-wasm-bindgen}"
if command -v "$WASM_BINDGEN_BIN" >/dev/null 2>&1; then
  ok "$("$WASM_BINDGEN_BIN" --version)"
elif [[ $CHECK_ONLY -eq 1 ]]; then
  todo "wasm-bindgen is not on PATH (install with: cargo install wasm-bindgen-cli)"
else
  die "wasm-bindgen is required to build both dashboards, and is not on PATH.

     Install it with either:
       cargo install wasm-bindgen-cli        # no extra tooling, takes a few minutes
       cargo binstall wasm-bindgen-cli       # much faster, needs cargo-binstall

     Or point this script at an existing binary:
       export WASM_BINDGEN=/path/to/wasm-bindgen"
fi

# --- native addon for the head-to-head dashboard ---------------------------

if [[ $SKIP_ADDON -eq 1 ]]; then
  printf '\n\033[1m==> nano-rspow-node native addon\033[0m\n    \033[90mskipped (--skip-addon)\033[0m\n'
else
  step "nano-rspow-node native addon"

  ADDON_ENTRY="$REPO_ROOT/nano-rspow-node/index.js"
  if [[ -f $ADDON_ENTRY ]]; then
    ok "already built"
  elif [[ $CHECK_ONLY -eq 1 ]]; then
    todo "run: (cd nano-rspow-node && npm install && npm run build)"
  else
    echo "    building (first run only, this compiles the addon)…"
    (cd "$REPO_ROOT/nano-rspow-node" && npm install && npm run build)
    ok "built"
  fi
fi

# --- dashboard dependencies -------------------------------------------------

step "benchmark-compare npm dependencies"

COMPARE_DIR="$REPO_ROOT/nano-rspow-web/benchmark-compare"
if [[ -d $COMPARE_DIR/node_modules/esbuild ]]; then
  ok "already installed"
elif [[ $CHECK_ONLY -eq 1 ]]; then
  todo "run: npm ci --prefix nano-rspow-web/benchmark-compare"
else
  (cd "$COMPARE_DIR" && npm ci)
  ok "installed"
fi

# --- summary ----------------------------------------------------------------

if [[ $CHECK_ONLY -eq 1 ]]; then
  printf '\n\033[1mCheck complete.\033[0m Any line marked "needed" above is outstanding.\n'
elif [[ $SKIP_ADDON -eq 1 ]]; then
  cat <<'NEXT'

\033[1mPrerequisites ready for the browser-only dashboard.\033[0m

  make web-demo-build   build nano-rspow-web/browser-demo/index.html without opening a browser
  make web-demo         build it and open it

The head-to-head dashboard also needs the native addon; run this script without
--skip-addon first if you want that one.
NEXT
else
  cat <<'NEXT'

\033[1mPrerequisites ready.\033[0m Run either dashboard from the repository root:

  make web-demo        Browser-only dashboard  -> nano-rspow-web/browser-demo/index.html
  make web-compare-run Head-to-head dashboard  -> http://localhost:8080/

See `make help` for the rest.
NEXT
fi
