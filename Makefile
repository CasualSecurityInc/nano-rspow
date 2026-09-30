# Entry points for the two web dashboards.
#
# Both dashboards compile `nano-rspow-web` to WebAssembly, so both share the
# same prerequisites. Run `make web-prereqs` once after cloning, then use either
# dashboard from here. `make help` lists everything.

.DEFAULT_GOAL := help

DEMO_DIR := nano-rspow-web/browser-demo
COMPARE_DIR := nano-rspow-web/benchmark-compare
PORT ?= 8080

.PHONY: help web-prereqs web-demo web-demo-build web-compare web-compare-run web-all web-clean

help: ## Show this help
	@echo "nano-rspow web dashboards"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "Typical use:"
	@echo "  make web-prereqs      # once, after cloning"
	@echo "  make web-demo         # browser-only dashboard, then open it"
	@echo "  make web-compare-run  # head-to-head dashboard on :$(PORT)"

web-prereqs: ## Install and verify everything both dashboards need (run once)
	@./scripts/setup-web-toolchain.sh

web-demo: ## Build the browser-only dashboard and open it
	@python3 $(DEMO_DIR)/build-demo.py

# Same build, no browser launch. Used by CI and anything headless.
web-demo-build: ## Build the browser-only dashboard without opening a browser
	@python3 $(DEMO_DIR)/build-demo.py --no-open

web-compare: ## Build the head-to-head dashboard into dist/ without serving it
	@$(MAKE) --no-print-directory -C $(COMPARE_DIR) build

web-compare-run: ## Build and serve the head-to-head dashboard on :$(PORT)
	@$(MAKE) --no-print-directory -C $(COMPARE_DIR) PORT=$(PORT) run

web-all: web-demo web-compare ## Build both dashboards

web-clean: ## Remove generated dashboard output
	@rm -rf $(COMPARE_DIR)/dist $(COMPARE_DIR)/.generated
	@echo "Removed benchmark-compare dist/ and .generated/."
	@echo "browser-demo/index.html is kept; delete it to force a rebuild."
