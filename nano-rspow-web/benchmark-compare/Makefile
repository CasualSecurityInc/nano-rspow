.PHONY: all build start

SOURCES := $(wildcard Makefile app.js bridge.mjs build.mjs index.html nano_rspow_web.js nano_rspow_web_bg.wasm package.json package-lock.json styles.css)
DIST_FILES := $(wildcard dist/app.js dist/index.html dist/nano_rspow_web_bg.wasm dist/styles.css)

PORT ?= 8080
WORK_PEER_PORT ?= 7076
WORK_PEER_LISTEN ?= 127.0.0.1:$(WORK_PEER_PORT)
WORK_PEER_BACKEND ?= auto
NANO_WORK_URL ?= http://127.0.0.1:$(WORK_PEER_PORT)
CARGO ?= cargo

all: build start

build:
	@if test ! -d node_modules/esbuild || test "$(words $(DIST_FILES))" -ne 4 || find $(SOURCES) -newer dist/app.js -print -quit | grep -q .; then npm ci && npm run build; fi

start:
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
	NANO_WORK_URL="$(NANO_WORK_URL)" PORT="$(PORT)" npx --no-install concurrently \
		--kill-others --kill-others-on-fail --kill-signal SIGTERM --kill-timeout 3000 \
		--names work-peer,proxy --prefix name --no-color \
		"$(CARGO) run --package nano-rspow-cli --release -- serve --listen $(WORK_PEER_LISTEN) --backend $(WORK_PEER_BACKEND)" \
		"node bridge.mjs"
