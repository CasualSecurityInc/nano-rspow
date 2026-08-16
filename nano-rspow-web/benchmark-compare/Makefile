.PHONY: all

SOURCES := $(wildcard app.js build.mjs index.html nanocurrency-worker.js nano-pow-bundle.js nano_rspow_web.js nano_rspow_web_bg.wasm package.json package-lock.json styles.css)
DIST_FILES := $(wildcard dist/app.js dist/index.html dist/nanocurrency-worker.js dist/nano_rspow_web_bg.wasm dist/styles.css)

all:
	@if test ! -d node_modules/esbuild || test "$(words $(DIST_FILES))" -ne 5 || find $(SOURCES) -newer dist/app.js -print -quit | grep -q .; then npm ci && npm run build; fi
	@if lsof -tiTCP:8080 -sTCP:LISTEN >/dev/null; then \
		echo "Benchmark server already listening at http://localhost:8080/"; \
	else \
		python3 -m http.server 8080 --directory dist; \
	fi
