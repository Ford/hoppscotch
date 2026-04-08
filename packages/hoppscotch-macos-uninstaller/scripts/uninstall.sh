#!/usr/bin/env bash
# =============================================================================
# Hoppscotch macOS Uninstaller
# =============================================================================
#
# Usage (interactive — requires sudo):
#   chmod +x uninstall.sh && sudo ./uninstall.sh
#
# Usage (dry-run — no sudo needed, nothing deleted, just prints what would go):
#   ./uninstall.sh --dry-run
#
# Usage (full purge — also removes user collections, environments, history):
#   sudo ./uninstall.sh --purge-data
#
# The script:
#   1. Removes the .app bundle from /Applications
#   2. Removes per-user Library caches, logs, WebKit data, and preferences
#      for every local user account.
#      ► Application Support (collections / environments / history) is KEPT
#        by default — pass --purge-data to remove it too.
#   3. Removes any LaunchAgents / LaunchDaemons the app may have installed
#   4. Updates the Spotlight index
#   5. Reports what was removed / skipped
# =============================================================================

# -e (errexit) is intentionally omitted.
# With -e, any command that returns non-zero immediately kills the script, which
# would propagate through the postinstall wrapper and trigger macOS Installer's
# failure-cleanup path — showing the "Downloads folder" TCC permission popup.
# Every error is handled explicitly with || true or if/else guards instead.
set -uo pipefail   # -u: unset vars are errors  -o pipefail: broken pipes are caught

# ── Constants ─────────────────────────────────────────────────────────────────
readonly APP_ID="io.hoppscotch.desktop"
readonly APP_NAME="Hoppscotch"
readonly APP_BUNDLE="/Applications/${APP_NAME}.app"
readonly SCRIPT_VERSION="1.0.0"

# ── Argument parsing ──────────────────────────────────────────────────────────
DRY_RUN="false"
PURGE_DATA="false"
for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN="true" ;;
    --purge-data) PURGE_DATA="true" ;;
  esac
done

# ── Colour helpers (disabled when not a TTY, e.g. MDM log streams) ───────────
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  CYAN='\033[0;36m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; BLUE=''; BOLD=''; RESET=''
fi

log()     { echo -e "${CYAN}[INFO]${RESET}     $*"; }
dryrun()  { echo -e "${BLUE}[DRY-RUN]${RESET}  $*"; }
ok()      { echo -e "${GREEN}[OK]${RESET}      $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}    $*"; }
error()   { echo -e "${RED}[ERROR]${RESET}   $*" >&2; }
section() { echo -e "\n${BOLD}$*${RESET}"; }

# ── Counters ──────────────────────────────────────────────────────────────────
removed=0
skipped=0
would_remove=0
would_skip=0

# ── remove_path ───────────────────────────────────────────────────────────────
# Remove a path if it exists; increment counters either way.
remove_path() {
  local path="$1"

  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ -e "$path" || -L "$path" ]]; then
      dryrun "Would remove : $path"
      (( would_remove++ )) || true
    else
      dryrun "Not present  : $path"
      (( would_skip++ )) || true
    fi
    return
  fi

  # Real mode
  if [[ -e "$path" || -L "$path" ]]; then
    rm -rf "$path"
    ok "Removed      : $path"
    (( removed++ )) || true
  else
    log "Already gone : $path"
    (( skipped++ )) || true
  fi
}

# ── Privilege check ───────────────────────────────────────────────────────────
# Dry-run does not need root; real removal does.
if [[ "$DRY_RUN" != "true" && "$EUID" -ne 0 ]]; then
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
elif [[ "$PURGE_DATA" == "true" ]]; then
  echo -e "${BOLD}Hoppscotch macOS Uninstaller v${SCRIPT_VERSION} — PURGE MODE${RESET}"
  echo -e "${YELLOW}User collections and all app data will also be removed.${RESET}"
else
  echo -e "${BOLD}Hoppscotch macOS Uninstaller v${SCRIPT_VERSION}${RESET}"
  echo -e "${GREEN}User collections and app data will be preserved (pass --purge-data to remove them too).${RESET}"
fi

# ── 1. Kill the app if it is running ─────────────────────────────────────────────────
section "1. Stopping Hoppscotch (if running)"

# Returns 0 if the main process OR any Tauri helper is still alive
app_is_running() {
  pgrep -x "${APP_NAME}" &>/dev/null ||
  pgrep -f  "${APP_BUNDLE}" &>/dev/null
}

if app_is_running; then
  if [[ "$DRY_RUN" == "true" ]]; then
    dryrun "Hoppscotch is running — would quit gracefully, then SIGTERM, then SIGKILL"
  else
    # Stage 1 — ask the app to quit gracefully via AppleScript
    log "Asking Hoppscotch to quit gracefully..."
    osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
    sleep 2

    # Stage 2 — SIGTERM the main process and any Tauri helper processes
    if app_is_running; then
      log "Still running — sending SIGTERM..."
      pkill -TERM -x "${APP_NAME}"        2>/dev/null || true
      pkill -TERM -f "${APP_BUNDLE}"      2>/dev/null || true
      sleep 2
    fi

    # Stage 3 — force-kill anything left
    if app_is_running; then
      warn "Still running after SIGTERM — sending SIGKILL..."
      pkill -KILL -x "${APP_NAME}"        2>/dev/null || true
      pkill -KILL -f "${APP_BUNDLE}"      2>/dev/null || true
      sleep 1
    fi

    if app_is_running; then
      warn "Could not fully terminate Hoppscotch. Some helper processes may still be running."
    else
      ok "Hoppscotch and all helper processes terminated."
    fi
  fi
else
  log "Hoppscotch is not running."
fi

# ── 2. Application bundle ─────────────────────────────────────────────────────
section "2. Application bundle"
remove_path "$APP_BUNDLE"

# ── 3. Remove per-user Library data ──────────────────────────────────────────
section "3. Per-user data"

# Build list of real user home directories (valid /Users/* home dirs)
# dscl output is captured into a variable FIRST, then piped to awk via a
# here-string.  This breaks the dscl|awk pipeline and prevents a SIGPIPE edge
# case where awk closes its stdin early, making dscl exit non-zero, which
# fires pipefail BEFORE the trailing || true can catch it — ultimately
# causing the "Downloads folder" TCC permission popup on Close.
user_homes=()
_dscl_out="$(dscl . -list /Users NFSHomeDirectory 2>/dev/null || true)"
while IFS=$'\t' read -r _username home; do
  [[ "$home" == /Users/* && -d "$home" ]] || continue
  user_homes+=("$home")
done < <(awk '{print $1"\t"$2}' <<< "$_dscl_out")

if [[ ${#user_homes[@]} -eq 0 ]]; then
  warn "No user home directories found via dscl."
else
  for home in "${user_homes[@]}"; do
    log "Cleaning data for: $home"
    lib="$home/Library"

    # Application Support contains user collections and all persisted app data.
    # By default we PRESERVE this directory so that collections, environments,
    # and history are not lost on uninstall.  Pass --purge-data to remove it.
    if [[ "$PURGE_DATA" == "true" ]]; then
      remove_path "$lib/Application Support/${APP_ID}"
    else
      if [[ "$DRY_RUN" == "true" ]]; then
        dryrun "Preserving   : $lib/Application Support/${APP_ID}  (pass --purge-data to remove)"
      else
        log "Preserving   : $lib/Application Support/${APP_ID}  (pass --purge-data to remove)"
      fi
      (( would_skip++ )) || true
    fi

    remove_path "$lib/Logs/${APP_ID}"
    remove_path "$lib/Caches/${APP_ID}"
    remove_path "$lib/WebKit/${APP_ID}"
    remove_path "$lib/Saved Application State/${APP_ID}.savedState"
    remove_path "$lib/HTTPStorages/${APP_ID}"
    remove_path "$lib/Preferences/${APP_ID}.plist"
  done
fi

# ── 3b. Ensure collections store is in the path the app reads after reinstall ─
# The app reads collections from:
#   ~/Library/Application Support/io.hoppscotch.desktop/latest/store/hoppscotch-unified.store
#
# Older versions wrote the store directly to the configDir root:
#   ~/Library/Application Support/io.hoppscotch.desktop/hoppscotch-unified.store
#
# The app's built-in migration only moves *.hoppscotch.store files and misses
# hoppscotch-unified.store, so after a reinstall the app starts with an empty
# store even though the data is still present.  We fix that here by copying the
# file into the correct sub-directory so it is found immediately on first launch.
section "3b. Preserving collections store path for reinstall"

UNIFIED_STORE="hoppscotch-unified.store"

if [[ ${#user_homes[@]} -eq 0 ]]; then
  warn "No user home directories found — skipping store path fix."
else
  for home in "${user_homes[@]}"; do
    app_support="$home/Library/Application Support/${APP_ID}"
    store_src="${app_support}/${UNIFIED_STORE}"
    store_dir="${app_support}/latest/store"
    store_dst="${store_dir}/${UNIFIED_STORE}"

    if [[ "$DRY_RUN" == "true" ]]; then
      if [[ -f "$store_src" && ! -f "$store_dst" ]]; then
        dryrun "Would copy store for reinstall : $store_src → $store_dst"
      elif [[ -f "$store_dst" ]]; then
        dryrun "Store already in correct location : $store_dst"
      else
        dryrun "No store file found at root or latest/store — nothing to copy"
      fi
      continue
    fi

    if [[ -f "$store_src" && ! -f "$store_dst" ]]; then
      # Destination directory may not exist yet if the app was never launched
      # with the newer directory structure — create it first.
      mkdir -p "$store_dir" || true
      cp "$store_src" "$store_dst" && \
        ok "Copied store to reinstall path : $store_dst" || \
        warn "Could not copy store to $store_dst — collections may not appear after reinstall"
    elif [[ -f "$store_dst" ]]; then
      log "Store already in correct location : $store_dst"
    else
      log "No root-level store found for $home — nothing to migrate"
    fi
  done
fi

# ── 4. Remove LaunchAgents / LaunchDaemons ────────────────────────────────────
section "4. LaunchAgents and LaunchDaemons"

for dir in \
  /Library/LaunchDaemons \
  /Library/LaunchAgents \
  /Users/*/Library/LaunchAgents; do
  [[ -d "$dir" ]] || continue
  while IFS= read -r -d '' plist; do
    remove_path "$plist"
  done < <(find "$dir" -maxdepth 1 -name "*${APP_ID}*" -print0 2>/dev/null || true)
done

# ── 5. Update Spotlight index ─────────────────────────────────────────────────
section "5. Updating Spotlight index"
if [[ "$DRY_RUN" == "true" ]]; then
  dryrun "Would update Spotlight index (mdimport -r)"
elif [[ -d "$APP_BUNDLE" ]]; then
  # Only needed if the bundle removal above failed
  mdimport -d1 "$APP_BUNDLE" 2>/dev/null || true
fi
log "Spotlight step done."

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "${BLUE}${BOLD}Dry-Run Summary (nothing was deleted)${RESET}"
  echo "  Would remove : ${would_remove} items"
  echo "  Would skip   : ${would_skip} items (not found on this system)"
  echo ""
  echo -e "${BLUE}Run with sudo to perform the real uninstall:${RESET}"
  echo "  sudo bash $0"
  echo ""
  if [[ "$PURGE_DATA" != "true" ]]; then
    echo -e "${BLUE}To also remove collections and app data:${RESET}"
    echo "  sudo bash $0 --purge-data"
  fi
else
  echo -e "${BOLD}Uninstall Summary${RESET}"
  echo "  Items removed : ${removed}"
  echo "  Items skipped : ${skipped} (already absent)"
  echo ""
  if [[ "$PURGE_DATA" != "true" ]]; then
    echo -e "${GREEN}${BOLD}Your collections and app data have been preserved.${RESET}"
    echo -e "  Location: ${BOLD}~/Library/Application Support/${APP_ID}/${RESET}"
    echo ""
    echo -e "  This folder contains your saved collections, environments, and history."
    echo -e "  To fully remove all data, run:"
    echo -e "  ${CYAN}sudo bash $0 --purge-data${RESET}"
    echo ""
  fi
  echo -e "${GREEN}${BOLD}Hoppscotch has been successfully uninstalled.${RESET}"
fi
echo ""

exit 0

