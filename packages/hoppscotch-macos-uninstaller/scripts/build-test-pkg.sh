#!/usr/bin/env bash
# =============================================================================
# build-test-pkg.sh — Build the Hoppscotch TEST Uninstaller .pkg
# =============================================================================
# Produces a PKG with the same GUI as the real uninstaller but runs a
# dry-run scan only — nothing is deleted.
#
# Run from the package root:
#   cd packages/hoppscotch-macos-uninstaller
#   bash scripts/build-test-pkg.sh
#
# Output: dist/HoppscotchUninstaller-TEST-<VERSION>.pkg
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

VERSION="${PKG_VERSION:-$(node -p "require('${ROOT_DIR}/package.json').version" 2>/dev/null || echo "1.0.0")}"
IDENTIFIER="io.hoppscotch.uninstaller.test"
PKG_NAME="HoppscotchUninstaller-TEST-${VERSION}.pkg"
OUTPUT_DIR="${ROOT_DIR}/dist"
SCRIPTS_DIR="${SCRIPT_DIR}/pkg-test"
RESOURCES_DIR="${ROOT_DIR}/resources/test"
DISTRIBUTION_XML="${RESOURCES_DIR}/distribution.xml"

log()     { echo "  [build-test] $*"; }
section() { echo ""; echo "▶ $*"; }

command -v pkgbuild     &>/dev/null || { echo "ERROR: pkgbuild not found. Run: xcode-select --install"; exit 1; }
command -v productbuild &>/dev/null || { echo "ERROR: productbuild not found. Run: xcode-select --install"; exit 1; }

mkdir -p "$OUTPUT_DIR"
BUILD_TMP="$(mktemp -d)"
trap 'rm -rf "$BUILD_TMP"' EXIT

# ── Stage scripts ─────────────────────────────────────────────────────────────
section "Staging test PKG scripts"
cp "${SCRIPTS_DIR}/preinstall"  "$BUILD_TMP/preinstall"
cp "${SCRIPTS_DIR}/postinstall" "$BUILD_TMP/postinstall"
chmod +x "$BUILD_TMP/preinstall" "$BUILD_TMP/postinstall"
log "Scripts staged in: $BUILD_TMP"

# ── Build component PKG (no payload, scripts only) ────────────────────────────
section "Building component PKG"
COMPONENT_PKG="${BUILD_TMP}/component-test.pkg"
pkgbuild \
  --nopayload \
  --scripts   "$BUILD_TMP" \
  --identifier "$IDENTIFIER" \
  --version    "$VERSION" \
  "$COMPONENT_PKG"
log "Component PKG: $COMPONENT_PKG"

# ── Build product PKG with GUI ────────────────────────────────────────────────
section "Building product PKG with GUI"
FINAL_PKG="${OUTPUT_DIR}/${PKG_NAME}"
productbuild \
  --distribution "$DISTRIBUTION_XML" \
  --package-path "$BUILD_TMP" \
  --resources    "$RESOURCES_DIR" \
  "$FINAL_PKG"

# productbuild drops a 'shas/' folder in the cwd as a build intermediate.
# It is not needed after the PKG is produced — remove it immediately.
rm -rf "${ROOT_DIR}/shas"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  TEST PKG built successfully!"
echo "  File : ${FINAL_PKG}"
echo "  Size : $(du -sh "$FINAL_PKG" | cut -f1)"
echo ""
echo "  Send this file to your colleague and ask them to:"
echo "  1. Double-click HoppscotchUninstaller-TEST-${VERSION}.pkg"
echo "  2. Click through the installer (Introduction → Install)"
echo "  3. A browser window opens showing every file that WOULD"
echo "     be removed — nothing is actually deleted."
echo "════════════════════════════════════════════════════════════"
echo ""

