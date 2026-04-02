#!/usr/bin/env bash
# =============================================================================
# Hoppscotch macOS Uninstaller
# =============================================================================
#
# Usage (interactive):
#   chmod +x uninstall.sh && sudo ./uninstall.sh
# Usage (dry-run — no sudo, nothing deleted, just prints paths):
#   ./uninstall.sh --dry-run
#
# The script:
#   1. Removes the .app bundle from /Applications
#   2. Removes all per-user Library data for every local user account
#   3. Removes any LaunchAgents / LaunchDaemons the app may have installed
#   4. Reports what was removed / skipped
# =============================================================================


# ── Constants ─────────────────────────────────────────────────────────────────
readonly APP_ID="io.hoppscotch.desktop"
readonly APP_NAME="Hoppscotch"
readonly APP_BUNDLE="/Applications/${APP_NAME}.app"
readonly SCRIPT_VERSION="1.0.0"

# Colour helpers (disabled when not a TTY, e.g. MDM log streams)
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  CYAN='\033[0;36m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; BLUE=''; BOLD=''; RESET=''
fi

  CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
log()     { echo -e "${CYAN}[INFO]${RESET}     $*"; }
  RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; RESET=''
dryrun()  { echo -e "${BLUE}[DRY-RUN]${RESET}  $*"; }
log()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
ok()     { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()   { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()  { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
section(){ echo -e "\n${BOLD}$*${RESET}"; }
    if [[ -e "$path" || -L "$path" ]]; then
      dryrun "Would remove : $path"
      (( would_remove++ )) || true
    else
      (( would_skip++ )) || true
    fi
# Remove a path if it exists; increment counters either way.
  fi

  # Real mode
  error "This script must be run as root."
  error "Re-run with:       sudo $0"
  error "Or for a dry-run:  $0 --dry-run"
  exit 1
fi

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "${BLUE}${BOLD}Hoppscotch macOS Uninstaller v${SCRIPT_VERSION} — DRY-RUN MODE${RESET}"
  echo -e "${BLUE}Nothing will be deleted. This is a preview only.${RESET}"
else
# ── Privilege check ───────────────────────────────────────────────────────────
if [[ "$EUID" -ne 0 ]]; then
# ── 1. Kill the app if it is running ─────────────────────────────────────────
section "1. Stopping Hoppscotch (if running)"
  error "Re-run with: sudo $0"
    dryrun "Hoppscotch is running — would send SIGTERM then SIGKILL"
  else
    log "Hoppscotch is not running."
  fi
else
echo -e "${BOLD}Hoppscotch macOS Uninstaller v${SCRIPT_VERSION}${RESET}"
section "2. Application bundle"
remove_path "$APP_BUNDLE"

# ── 3. Remove per-user Library data ──────────────────────────────────────────
section "3. Per-user data"

# Build list of real user home directories (UID >= 500, valid home dirs)
user_homes=()
while IFS=$'\t' read -r _username home; do
  [[ "$home" == /Users/* && -d "$home" ]] || continue
  user_homes+=("$home")
done < <(dscl . -list /Users NFSHomeDirectory 2>/dev/null | tr ' ' '\t' || true)

if [[ ${#user_homes[@]} -eq 0 ]]; then
  remove_path "$lib/Preferences/com.apple.preference.security.plist.lockfile"
if pgrep -x "${APP_NAME}" &>/dev/null; then
  pkill -TERM -x "${APP_NAME}" 2>/dev/null || true
  sleep 1
  pkill -KILL -x "${APP_NAME}" 2>/dev/null || true
  ok "Process terminated."
else
  log "Hoppscotch is not running."
done

# ── 4. Remove LaunchAgents / LaunchDaemons ────────────────────────────────────
section "4. LaunchAgents and LaunchDaemons"

for dir in \
  /Library/LaunchDaemons \
  /Library/LaunchAgents \
  /Users/*/Library/LaunchAgents; do
  [[ -d "$dir" ]] || continue
  while IFS= read -r -d '' plist; do
    remove_path "$plist"
section "2. Removing application bundle"
done

# ── 5. Clear Spotlight index entry ───────────────────────────────────────────
section "5. Updating Spotlight index"
if [[ -d "$APP_BUNDLE" ]]; then
  # Only needed if the bundle removal above failed
# ── 5. Spotlight ──────────────────────────────────────────────────────────────
section "3. Removing per-user data"
if [[ "$DRY_RUN" == "true" ]]; then
  dryrun "Would update Spotlight index (mdimport)"
elif [[ -d "$APP_BUNDLE" ]]; then
  mdimport -d1 "$APP_BUNDLE" 2>/dev/null || true
fi
log "Spotlight cleanup done."
log "Spotlight step done."

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Uninstall Summary${RESET}"
echo "  Items removed : ${removed}"
echo "  Items skipped : ${skipped} (already absent)"
echo ""
echo -e "${GREEN}${BOLD}Hoppscotch has been successfully uninstalled.${RESET}"
  log "Cleaning data for: $home"

if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "${BLUE}${BOLD}Dry-Run Summary (nothing was deleted)${RESET}"
  echo "  Would remove : ${would_remove} items"
  echo "  Would skip   : ${would_skip} items (not found on this system)"
  echo ""
  echo -e "${BLUE}Run with sudo to perform the real uninstall:${RESET}"
  echo "  sudo bash $0"
else
section "4. Removing LaunchAgents and LaunchDaemons"
  echo "  Items removed : ${removed}"
  echo "  Items skipped : ${skipped} (already absent)"
  echo ""
  echo -e "${GREEN}${BOLD}Hoppscotch has been successfully uninstalled.${RESET}"
fi
echo ""

exit 0

