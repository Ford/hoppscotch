#!/usr/bin/env bash
# =============================================================================
# build-pkg.sh — Build the Hoppscotch macOS Uninstaller .pkg
# =============================================================================
#
# Prerequisites (on macOS):
#   - Xcode Command Line Tools:  xcode-select --install
#   - (Optional) Developer ID Installer certificate for signing
#   - (Optional) App-specific password for notarization
#
# Usage:
#   ./scripts/build-pkg.sh                          # unsigned PKG
#   SIGN_IDENTITY="Developer ID Installer: ..." \
#   APPLE_ID="you@example.com" \
#   APPLE_TEAM_ID="ABCD1234EF" \
#   APP_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
#   ./scripts/build-pkg.sh                          # signed + notarized
#
# Output:
#   dist/HoppscotchUninstaller-<VERSION>.pkg
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Configuration ─────────────────────────────────────────────────────────────
VERSION="${PKG_VERSION:-$(node -p "require('${ROOT_DIR}/package.json').version" 2>/dev/null || echo "1.0.0")}"
IDENTIFIER="io.hoppscotch.uninstaller"
PKG_NAME="HoppscotchUninstaller-${VERSION}.pkg"
OUTPUT_DIR="${ROOT_DIR}/dist"
SCRIPTS_PKG_DIR="${SCRIPT_DIR}/pkg"
RESOURCES_DIR="${ROOT_DIR}/resources"
DISTRIBUTION_XML="${RESOURCES_DIR}/distribution.xml"

# Signing (optional — leave empty to skip)
SIGN_IDENTITY="${SIGN_IDENTITY:-}"
APPLE_ID="${APPLE_ID:-}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"
APP_PASSWORD="${APP_PASSWORD:-}"

# ── Helpers ───────────────────────────────────────────────────────────────────
log()    { echo "  [build] $*"; }
section(){ echo ""; echo "▶ $*"; }

require_cmd() {
  command -v "$1" &>/dev/null || { echo "ERROR: '$1' not found. Install Xcode Command Line Tools."; exit 1; }
}

require_cmd pkgbuild
require_cmd productbuild

mkdir -p "$OUTPUT_DIR"

BUILD_TMP="$(mktemp -d)"
trap 'rm -rf "$BUILD_TMP"' EXIT

# ── Copy uninstall.sh into the PKG scripts dir ────────────────────────────────
section "Preparing PKG scripts"
cp -r "$SCRIPTS_PKG_DIR"/* "$BUILD_TMP/"
cp "${SCRIPT_DIR}/uninstall.sh" "$BUILD_TMP/uninstall.sh"
chmod +x "$BUILD_TMP/preinstall" "$BUILD_TMP/postinstall" "$BUILD_TMP/uninstall.sh"
log "Scripts ready in: $BUILD_TMP"

# ── Build the component pkg (no payload — scripts only) ───────────────────────
section "Building component PKG"
COMPONENT_PKG="${BUILD_TMP}/component.pkg"
pkgbuild \
  --nopayload \
  --scripts "$BUILD_TMP" \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  "$COMPONENT_PKG"
log "Component PKG: $COMPONENT_PKG"

# ── Wrap in a product PKG with GUI installer flow ────────────────────────────
section "Building product PKG"
UNSIGNED_PKG="${BUILD_TMP}/unsigned.pkg"
productbuild \
  --distribution "$DISTRIBUTION_XML" \
  --package-path "$BUILD_TMP" \
  --resources "$RESOURCES_DIR" \
  "$UNSIGNED_PKG"
log "Unsigned PKG: $UNSIGNED_PKG"

# ── Sign (optional) ───────────────────────────────────────────────────────────
FINAL_PKG="${OUTPUT_DIR}/${PKG_NAME}"
if [[ -n "$SIGN_IDENTITY" ]]; then
  section "Signing PKG"
  productsign \
    --sign "$SIGN_IDENTITY" \
    "$UNSIGNED_PKG" \
    "$FINAL_PKG"
  log "Signed PKG: $FINAL_PKG"
  pkgutil --check-signature "$FINAL_PKG"
else
  cp "$UNSIGNED_PKG" "$FINAL_PKG"
  log "PKG is unsigned (set SIGN_IDENTITY to sign)."
fi

# ── Notarize (optional — requires signing + Apple credentials) ────────────────
if [[ -n "$SIGN_IDENTITY" && -n "$APPLE_ID" && -n "$APPLE_TEAM_ID" && -n "$APP_PASSWORD" ]]; then
  section "Submitting for notarization"
  xcrun notarytool submit "$FINAL_PKG" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APP_PASSWORD" \
    --wait
  log "Stapling notarization ticket..."
  xcrun stapler staple "$FINAL_PKG"
  log "Notarization complete."
else
  log "Notarization skipped (APPLE_ID / APPLE_TEAM_ID / APP_PASSWORD not set)."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Built: ${FINAL_PKG}"
echo "  Size : $(du -sh "$FINAL_PKG" | cut -f1)"
echo "════════════════════════════════════════════════════════════"
echo ""

