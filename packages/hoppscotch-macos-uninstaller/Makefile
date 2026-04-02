# =============================================================================
# Makefile — Hoppscotch macOS Uninstaller
# =============================================================================
#
# Targets:
#   make pkg         Build an unsigned .pkg (default)
#   make sign        Build + sign with Developer ID Installer certificate
#   make notarize    Build + sign + notarize (requires Apple credentials)
#   make clean       Remove the dist/ directory
#   make test        Dry-run the uninstall script (prints paths, no deletion)
#
# Environment variables for signing / notarization:
#   SIGN_IDENTITY    Developer ID Installer: Your Name (TEAMID)
#   APPLE_ID         your@apple.id
#   APPLE_TEAM_ID    Your 10-character team ID
#   APP_PASSWORD     App-specific password from appleid.apple.com
#   PKG_VERSION      Override version (default: read from package.json)
# =============================================================================

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := pkg

BUILD_SCRIPT      := scripts/build-pkg.sh
BUILD_TEST_SCRIPT := scripts/build-test-pkg.sh

.PHONY: pkg pkg-test sign notarize clean test help

## Build the real unsigned PKG (deletes files when run on a Mac)
pkg:
	@bash $(BUILD_SCRIPT)

## Build the TEST PKG (same GUI, zero deletions, opens HTML report in browser)
pkg-test:
	@bash $(BUILD_TEST_SCRIPT)

## Build and sign the real PKG (requires SIGN_IDENTITY)
sign:
	@[[ -n "$(SIGN_IDENTITY)" ]] || \
	  { echo "ERROR: Set SIGN_IDENTITY=Developer ID Installer: ..."; exit 1; }
	@SIGN_IDENTITY="$(SIGN_IDENTITY)" bash $(BUILD_SCRIPT)

## Build, sign, and notarize (requires all Apple credentials)
notarize: sign
	@echo "Notarization is handled inside build-pkg.sh when credentials are set."

## Remove build artefacts
clean:
	rm -rf dist/
	@echo "dist/ removed."

## Show what the uninstaller WOULD remove (safe dry run — no changes made)
test:
	@echo "=== Dry-run: paths that would be removed ==="
	@APP_ID="io.hoppscotch.desktop"; \
	 echo "  /Applications/Hoppscotch.app"; \
	 for home in /Users/*/; do \
	   [[ -d "$$home" ]] || continue; \
	   lib="$$home/Library"; \
	   echo "  $$lib/Application Support/$$APP_ID"; \
	   echo "  $$lib/Logs/$$APP_ID"; \
	   echo "  $$lib/Caches/$$APP_ID"; \
	   echo "  $$lib/WebKit/$$APP_ID"; \
	   echo "  $$lib/Saved Application State/$$APP_ID.savedState"; \
	   echo "  $$lib/HTTPStorages/$$APP_ID"; \
	   echo "  $$lib/Preferences/$$APP_ID.plist"; \
	 done
	@echo "=== End dry-run ==="

## Show help
help:
	@grep -E '^## ' Makefile | sed 's/## //'

