.PHONY: all

SOURCES := $(wildcard app.js build.mjs index.html nanocurrency-worker.js nano_rspow_web.js nano_rspow_web_bg.wasm package.json package-lock.json styles.css)
DIST_FILES := $(wildcard dist/app.js dist/index.html dist/nanocurrency-worker.js dist/nano_rspow_web_bg.wasm dist/styles.css)

all:
	@if test ! -d node_modules/esbuild || test "$(words $(DIST_FILES))" -ne 5 || find $(SOURCES) -newer dist/app.js -print -quit | grep -q .; then npm ci && npm run build; fi
	@if lsof -tiTCP:$${PORT:-8080} -sTCP:LISTEN >/dev/null; then \
		echo "Port $${PORT:-8080} is already in use; stop that listener or choose another PORT." >&2; \
		exit 1; \
	else \
		python3 -m http.server $${PORT:-8080} --directory dist; \
	fi
