.PHONY: all build start node-addon

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

all: build start

# The bridge loads the native addon at startup, and the page stays on its
# loading state if it is missing, so build it on the way past. The addon is a
# one-time build and is skipped once present.
node-addon:
	@if test ! -f ../../nano-rspow-node/index.js; then \
		echo "Building the nano-rspow-node addon (first run only)…"; \
		(cd ../../nano-rspow-node && npm install && npm run build) || { \
			echo "The nano-rspow-node addon failed to build. The head-to-head dashboard will" >&2; \
			echo "stay on its loading state without it, and the nano-rspow-node provider will be" >&2; \
			echo "reported as unavailable." >&2; \
		}; \
	fi

build: node-addon
	@if test ! -d node_modules/esbuild || test "$(words $(DIST_FILES))" -ne 4 || find $(SOURCES) -newer dist/app.js -print -quit | grep -q .; then npm ci && npm run build; fi

start:
	@if lsof -tiTCP:$(PORT) -sTCP:LISTEN >/dev/null; then \
		echo "Port 8080 is already in use; stop that listener or choose another PORT." >&2; \
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
	NANO_WORK_URL="$(NANO_WORK_URL)" PORT="$(PORT)" npx --no-install concurrently \
		--kill-others --kill-others-on-fail --kill-signal SIGTERM --kill-timeout 3000 \
		--names work-peer,proxy --prefix name --no-color \
		"$(CARGO) run --package nano-rspow-cli --release -- serve --listen $(WORK_PEER_LISTEN) --backend $(WORK_PEER_BACKEND)" \
		"node bridge.mjs"
