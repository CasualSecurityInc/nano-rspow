#!/usr/bin/env bash
#
# Verify the browser-only dashboard is present, complete, and built from the
# current sources.
#
# `browser-demo/index.html` is generated and deliberately not committed: a
# 550 KB self-contained artifact sitting in git is a stale artifact waiting to
# happen, and opening it would silently benchmark an old WebAssembly module.
# This is what replaces the safety a committed copy appeared to provide.
#
#   scripts/check-browser-demo.sh          # verify
#   scripts/check-browser-demo.sh --quiet  # exit status only, for CI
#
# CI runs this so a broken or outdated dashboard fails a build rather than
# shipping.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARD="$REPO_ROOT/nano-rspow-web/browser-demo/index.html"
DEMO_DIR="$REPO_ROOT/nano-rspow-web/browser-demo"
QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

if [[ $QUIET -eq 1 ]]; then
  say() { :; }
  ok()  { :; }
else
  say() { printf '    \033[1m%s\033[0m\n' "$1"; }
  ok()  { printf '    \033[32mok\033[0m      %s\n' "$1"; }
fi

fail() {
  printf '\n\033[31merror:\033[0m %s\n' "$1" >&2
  exit 1
}

# --- the artifact exists at all ---------------------------------------------

if [[ ! -f $DASHBOARD ]]; then
  fail "The browser-only dashboard has not been built.

    It is a generated, self-contained file and is not committed, so it cannot
    be stale. Build it from the repository root:

      make web-demo          build it and open it
      make web-demo-build    build it without opening a browser

    The published copy is always available without any build:
      https://casualsecurityinc.github.io/nano-rspow/"
fi

if [[ ! -s $DASHBOARD ]]; then
  fail "$DASHBOARD exists but is empty. The last build did not finish; re-run:
    make web-demo-build"
fi

if [[ $QUIET -eq 0 ]]; then
  size=$(wc -c < "$DASHBOARD" | tr -d ' ')
  ok "$DASHBOARD ($size bytes)"
fi

# --- it is actually a complete, inlined page --------------------------------
#
# The page is opened straight from disk over file://, where fetching a sibling
# asset would fail, so the WebAssembly, the wasm-bindgen glue and the WGSL
# shader all have to be inlined. A half-finished build can leave a page that
# looks fine and then throws on load.

check_inlined() {
  if ! grep -qF "$1" "$DASHBOARD"; then
    fail "$DASHBOARD does not contain '$1'.

      The page is meant to inline the WebAssembly, the wasm-bindgen glue and the
      WGSL shader so it works from file:// with no sibling files. That marker is
      missing, so the build is incomplete. Re-run:

        make web-demo-build"
  fi
  [[ $QUIET -eq 0 ]] && ok "inlined: $1"
}

check_inlined 'const wasmBase64'
check_inlined 'globalThis.generate_work'
check_inlined '@compute @workgroup_size(WGS_PLACEHOLDER)'

# --- it was built from the current sources -----------------------------------
#
# This is the check that a committed artifact could never give you.

stale=$(find "$REPO_ROOT/nano-rspow/src" "$REPO_ROOT/nano-rspow-web/src" \
  \( -name '*.rs' -o -name '*.wgsl' \) \
  -newer "$DASHBOARD" -print -quit)
if [[ -z $stale ]]; then
  stale=$(find "$DEMO_DIR" -maxdepth 1 \
    \( -name 'demo.js' -o -name 'index.template.html' \) \
    -newer "$DASHBOARD" -print -quit)
fi

if [[ -n $stale ]]; then
  relative="${stale#"$REPO_ROOT"/}"
  fail "$relative is newer than the built dashboard.

    The page on disk predates its own sources, so it would be benchmarking an
    older WebAssembly module than the code in this checkout. Rebuild with:

      make web-demo-build"
fi

[[ $QUIET -eq 0 ]] && ok "up to date with the crate, shader and demo sources"
[[ $QUIET -eq 0 ]] && printf '\n\033[1mBrowser-only dashboard verified.\033[0m\n'
