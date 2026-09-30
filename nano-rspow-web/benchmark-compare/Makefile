.PHONY: all prereqs build run start node-addon clean

# Only the JavaScript side gates a rebuild. Cargo is invoked by build.mjs and is
# incremental, so the Rust sources must invalidate the cache too — comparing
# directory timestamps would not, because editing a file inside a directory
# leaves the directory's mtime alone.
JS_SOURCES := $(wildcard Makefile app.js bridge.mjs build.mjs index.html package.json package-lock.json styles.css)
RUST_SOURCES := $(shell find ../../nano-rspow/src -name '*.rs' 2>/dev/null) \
	$(wildcard ../src/lib.rs ../../Cargo.toml ../../Cargo.lock)
SOURCES := $(JS_SOURCES) $(RUST_SOURCES)
DIST_FILES := $(wildcard dist/app.js dist/index.html dist/nano_rspow_web_bg.wasm dist/styles.css)

PORT ?= 8080
WORK_PEER_PORT ?= 7076
WORK_PEER_LISTEN ?= 127.0.0.1:$(WORK_PEER_PORT)
WORK_PEER_BACKEND ?= auto
NANO_WORK_URL ?= http://127.0.0.1:$(WORK_PEER_PORT)
CARGO ?= cargo

all: build run

# The same prerequisites the browser-only dashboard needs, plus the native addon
# and this directory's npm dependencies. Shared with the repository root so
# there is one description of the toolchain rather than two that drift.
prereqs:
	@../../scripts/setup-web-toolchain.sh

# The bridge loads the native addon at startup and the page otherwise stays on
# its loading state forever, so it is built on the way past. Kept separate from
# `prereqs` so a failure here degrades to "this provider is unavailable" rather
# than blocking a build that CI also uses for verification.
node-addon:
	@if test ! -f ../../nano-rspow-node/index.js; then \
		echo "Building the nano-rspow-node addon (first run only)…"; \
		(cd ../../nano-rspow-node && npm install && npm run build) || { \
			echo "Warning: the nano-rspow-node addon failed to build. The page will" >&2; \
			echo "still load, but the nano-rspow-node provider will be reported as" >&2; \
			echo "unavailable and /api/health will return 503." >&2; \
		}; \
	fi

# build.mjs compiles nano-rspow-web to wasm32 itself, so this needs the wasm
# target and wasm-bindgen. It reports both clearly if they are missing.
build: node-addon
	@if test ! -d node_modules/esbuild || test "$(words $(DIST_FILES))" -ne 4 || find $(SOURCES) -newer dist/app.js -print -quit | grep -q .; then npm ci && npm run build; fi

# Start the work peer and the proxy. Foreground; Ctrl-C once stops both.
run: build
	@if lsof -tiTCP:$(PORT) -sTCP:LISTEN >/dev/null; then \
		echo "Port $(PORT) is already in use; stop that listener or choose another PORT." >&2; \
		exit 1; \
	fi
	@if lsof -tiTCP:$(WORK_PEER_PORT) -sTCP:LISTEN >/dev/null; then \
		echo "Work-peer port $(WORK_PEER_PORT) is already in use; stop that listener or choose another WORK_PEER_PORT." >&2; \
		exit 1; \
	fi
	@if ! command -v "$(CARGO)" >/dev/null 2>&1; then \
		echo "cargo is required to build and run the local work peer; install Rust or add cargo to PATH." >&2; \
		exit 1; \
	fi
	@echo "Head-to-head dashboard: http://localhost:$(PORT)/"
	NANO_WORK_URL="$(NANO_WORK_URL)" PORT="$(PORT)" npx --no-install concurrently \
		--kill-others --kill-others-on-fail --kill-signal SIGTERM --kill-timeout 3000 \
		--names work-peer,proxy --prefix name --no-color \
		"$(CARGO) run --package nano-rspow-cli --release -- serve --listen $(WORK_PEER_LISTEN) --backend $(WORK_PEER_BACKEND)" \
		"node bridge.mjs"

# Backwards-compatible alias for the original target name.
start: run

clean:
	@rm -rf dist .generated
