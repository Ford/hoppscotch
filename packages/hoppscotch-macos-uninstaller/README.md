# Hoppscotch macOS Uninstaller

A standalone macOS **`.pkg`** uninstaller for [Hoppscotch Desktop](https://hoppscotch.com).
Designed for distribution via enterprise software centers (Jamf Pro, Munki, Microsoft Intune, SCCM/MECM) as well as direct use by end users.

---

## Package layout

```
hoppscotch-macos-uninstaller/
├── Makefile                      # Convenience build targets
├── package.json
├── scripts/
│   ├── uninstall.sh              # ★ Core uninstall logic (standalone script)
│   ├── build-pkg.sh              # Builds the .pkg using pkgbuild + productbuild
│   └── pkg/
│       ├── preinstall            # PKG preflight check (runs as root)
│       └── postinstall           # PKG payload — calls uninstall.sh (runs as root)
├── resources/
│   ├── distribution.xml          # macOS Installer GUI definition
│   ├── welcome.html              # "What will be removed" screen
│   └── conclusion.html           # "Done" screen
└── dist/                         # ← built .pkg lands here (git-ignored)
```

---

## What gets removed

| Item | Path |
|------|------|
| Application bundle | `/Applications/Hoppscotch.app` |
| App support data | `~/Library/Application Support/io.hoppscotch.desktop` |
| Log files | `~/Library/Logs/io.hoppscotch.desktop` |
| Caches | `~/Library/Caches/io.hoppscotch.desktop` |
| WebKit storage | `~/Library/WebKit/io.hoppscotch.desktop` |
| Saved state | `~/Library/Saved Application State/io.hoppscotch.desktop.savedState` |
| HTTP storages | `~/Library/HTTPStorages/io.hoppscotch.desktop` |
| Preferences plist | `~/Library/Preferences/io.hoppscotch.desktop.plist` |
| LaunchAgents/Daemons | Any `*io.hoppscotch.desktop*` plists under `/Library/Launch*` |

All per-user paths are cleaned for **every local user account** on the machine.

---

## Step-by-step: Build the PKG

### Prerequisites (macOS only)

> ⚠️ **Windows users cannot build this PKG natively.**
> `pkgbuild` and `productbuild` are Apple-proprietary tools that only exist on macOS.

---

#### Command 1 — Install Xcode Command Line Tools

```bash
xcode-select --install
```

| Question | Answer |
|----------|--------|
| **What does it do?** | Downloads and installs Apple's free developer toolchain (`pkgbuild`, `productbuild`, `git`, `make`, `clang`, etc.) from Apple's servers. You do **not** need the full Xcode IDE (4 GB+) — this is a lightweight ~200 MB install. |
| **Does this sign anything?** | ❌ No. This is purely a tool installer. Signing is a completely separate step that requires a paid Apple Developer account. |
| **Who can run it?** | Any macOS user (no Apple Developer account required). |
| **One-time?** | Yes — once installed, you never need to run it again unless you upgrade macOS. |
| **Alternative (Homebrew)?** | `brew install --cask xcode` also works but installs the full Xcode. |

A dialog box will appear asking you to confirm — click **Install**.
Wait for it to finish (~5–10 min depending on your connection), then continue.

---

#### Command 2 — Verify the build tools are available

```bash
which pkgbuild productbuild
```

| Question | Answer |
|----------|--------|
| **What does it do?** | Checks that `pkgbuild` and `productbuild` are on your `$PATH` and prints their locations. If either is missing the command returns nothing for that tool. |
| **Does this sign anything?** | ❌ No. It only checks that the tools exist. |
| **Expected output** | `/usr/bin/pkgbuild` and `/usr/bin/productbuild` — both ship with Xcode CLT. |
| **What are these tools?** | `pkgbuild` creates a raw component `.pkg` from scripts. `productbuild` wraps it in a polished macOS Installer GUI (welcome screen, licence, progress bar, conclusion screen). Both are Apple-owned, macOS-only binaries. |

```
/usr/bin/pkgbuild        ← if this line appears, you are good
/usr/bin/productbuild    ← if this line appears, you are good
```

If either line is **missing**, re-run `xcode-select --install` and try again.

---

**Option B — macOS machine in the cloud**

Use a macOS cloud VM (MacStadium, AWS EC2 Mac, Apple Silicon in Azure) via SSH, then run the build commands there.

**Option C — Ask a macOS colleague**

Hand off the `hoppscotch-macos-uninstaller/` folder to someone with a Mac.
They run `make pkg` and send back the `.pkg` file.

---

### 1. Clone / navigate to the package

```bash
cd packages/hoppscotch-macos-uninstaller
```

### 2. Build an unsigned PKG

> **Run all build commands from inside the `hoppscotch-macos-uninstaller` package directory.**

```bash
# Make sure you are in the right directory first:
cd packages/hoppscotch-macos-uninstaller

# Confirm your working directory (should end with hoppscotch-macos-uninstaller):
pwd
# Expected output:
#   /path/to/hoppscotch/packages/hoppscotch-macos-uninstaller

# Then build:
make pkg
# — or, if you don't have make installed —
bash scripts/build-pkg.sh
```

What happens during the build:

| Step | Tool | What it does |
|------|------|-------------|
| 1 | `pkgbuild` | Packages the `preinstall`, `postinstall`, and `uninstall.sh` scripts into a component `.pkg` (no payload — scripts only) |
| 2 | `productbuild` | Wraps the component pkg with the GUI installer (`distribution.xml`, `welcome.html`, `conclusion.html`) into the final flat `.pkg` |
| 3 | Output | Saves to `dist/HoppscotchUninstaller-<version>.pkg` inside this directory |

Output: **`dist/HoppscotchUninstaller-1.0.0.pkg`**

```
hoppscotch-macos-uninstaller/
└── dist/
    └── HoppscotchUninstaller-1.0.0.pkg   ← distribute this file
```

### 3. Test locally (interactive install)

```bash
open dist/HoppscotchUninstaller-1.0.0.pkg
# macOS Installer opens → click through → Hoppscotch is removed
```

Or silently via Terminal:

```bash
sudo installer -pkg dist/HoppscotchUninstaller-1.0.0.pkg -target /
```

---

## Test PKG — Verify the GUI and file list without deleting anything

Before sharing the real uninstaller with anyone, build the **TEST PKG** first.
It has the **exact same GUI** as the real uninstaller but:

- ✅ Scans the Mac for every file the real uninstaller would remove
- ✅ Opens a detailed HTML report in the browser showing found / not-found status for each item
- ❌ **Deletes absolutely nothing**

### Who should use this

| Person | Purpose |
|--------|---------|
| **You (Windows dev)** | Send to a colleague's Mac to verify the GUI screens and file list are correct |
| **Colleague on Mac** | Run it, check the browser report, confirm the right paths are targeted |
| **IT admin** | Validate before deploying the real PKG via software center |

### How to build the test PKG (on a Mac)

```bash
# Step 1 — Go to the package directory
cd packages/hoppscotch-macos-uninstaller

# Step 2 — Confirm you are in the right place
pwd
# Expected: .../hoppscotch/packages/hoppscotch-macos-uninstaller

# Step 3 — Build the test PKG
make pkg-test
# or without make:
bash scripts/build-test-pkg.sh
```

Output: **`dist/HoppscotchUninstaller-TEST-1.0.0.pkg`**

### What your colleague does with it

```
1. Receive:  HoppscotchUninstaller-TEST-1.0.0.pkg
2. Action:   Double-click the file
3. Screen 1: Welcome screen — "Test Mode, nothing will be deleted"
4. Action:   Click Continue → Install
5. Screen 2: macOS Installer runs the scan (a few seconds)
6. Screen 3: Conclusion — "Scan complete, check your browser"
7. Result:   Browser opens with a full HTML report
```

### What the HTML report looks like

The report opens automatically and shows:

```
┌─────────────────────────────────────────────────────────────┐
│  🧪 TEST MODE — Nothing was deleted                         │
├─────────────────────────────────────────────────────────────┤
│  Total scanned: 9   │  Would remove: 7   │  Not present: 2  │
├────────────────────────────────┬────────┬───────────────────┤
│ Path                           │ Size   │ Status            │
├────────────────────────────────┼────────┼───────────────────┤
│ /Applications/Hoppscotch.app  │ 312 MB │ 🔴 Will be removed│
│ ~/Library/Application Support │  48 MB │ 🔴 Will be removed│
│ ~/Library/Logs/...            │   2 MB │ 🔴 Will be removed│
│ ~/Library/Caches/...          │  89 MB │ 🔴 Will be removed│
│ ~/Library/WebKit/...          │  12 MB │ 🔴 Will be removed│
│ ~/Library/HTTPStorages/...    │   1 MB │ 🔴 Will be removed│
│ ~/Library/Preferences/...     │   4 KB │ 🔴 Will be removed│
│ ~/Library/Saved Application.. │  —     │ ✅ Not present     │
│ /Library/LaunchDaemons/...    │  —     │ ✅ Not present     │
└────────────────────────────────┴────────┴───────────────────┘
```

### Real PKG vs Test PKG — side by side

| | Real PKG (`make pkg`) | Test PKG (`make pkg-test`) |
|---|---|---|
| PKG identifier | `io.hoppscotch.uninstaller` | `io.hoppscotch.uninstaller.test` |
| Output file | `HoppscotchUninstaller-1.0.0.pkg` | `HoppscotchUninstaller-TEST-1.0.0.pkg` |
| Welcome screen | "Uninstall Hoppscotch" | "Uninstall Hoppscotch — TEST MODE" |
| Conclusion screen | "Successfully uninstalled" | "Scan complete — check browser" |
| Deletes files? | ✅ Yes (real deletion) | ❌ Never |
| Opens HTML report? | ❌ No | ✅ Yes |
| Requires sudo? | ✅ Yes (to delete) | ✅ Yes (macOS PKG always runs as root) |

---

## Running the script directly (no PKG)

For IT admins who prefer a plain shell script:

```bash
# Download and run (requires sudo)
curl -fsSL https://your-cdn.example.com/uninstall.sh | sudo bash

# Or from a local copy
sudo bash scripts/uninstall.sh
```

---

## Dry run (see what would be deleted without deleting anything)

A dry run **prints every path the uninstaller would remove** but makes zero changes to your system.
Nothing is deleted. Nothing is moved. It is completely safe to run at any time.

---

### Who should use this?

| Person | Why useful |
|--------|-----------|
| **IT admin** | Verify the correct paths are targeted before deploying to managed Macs |
| **Developer** | Confirm the script covers all Hoppscotch data locations |
| **End user** | See exactly what will be wiped before committing to a full uninstall |

---

### Which directory to run it from

You must be inside the `hoppscotch-macos-uninstaller` package directory.

```bash
# Step 1 — Navigate to the package (from the repo root)
cd packages/hoppscotch-macos-uninstaller

# Step 2 — Confirm you are in the right place
pwd
# Expected output:
#   /path/to/hoppscotch/packages/hoppscotch-macos-uninstaller

# Step 3 — Run the dry run
make test
```

> If you do not have `make` installed, run the equivalent directly:
> ```bash
> APP_ID="io.hoppscotch.desktop"
> echo "/Applications/Hoppscotch.app"
> for home in /Users/*/; do
>   echo "$home/Library/Application Support/$APP_ID"
>   echo "$home/Library/Logs/$APP_ID"
>   echo "$home/Library/Caches/$APP_ID"
>   echo "$home/Library/WebKit/$APP_ID"
>   echo "$home/Library/Saved Application State/$APP_ID.savedState"
>   echo "$home/Library/HTTPStorages/$APP_ID"
>   echo "$home/Library/Preferences/$APP_ID.plist"
> done
> ```

---

### What `make test` does internally

It does **not** call `uninstall.sh` at all.
It is a pure shell `echo` loop defined inside the `Makefile` that just prints paths — no `rm`, no `sudo`, no file system changes of any kind.

---

### Expected output

Running `make test` on a Mac that has Hoppscotch installed will print something like this:

```
=== Dry-run: paths that would be removed ===
  /Applications/Hoppscotch.app
  /Users/john/Library/Application Support/io.hoppscotch.desktop
  /Users/john/Library/Logs/io.hoppscotch.desktop
  /Users/john/Library/Caches/io.hoppscotch.desktop
  /Users/john/Library/WebKit/io.hoppscotch.desktop
  /Users/john/Library/Saved Application State/io.hoppscotch.desktop.savedState
  /Users/john/Library/HTTPStorages/io.hoppscotch.desktop
  /Users/john/Library/Preferences/io.hoppscotch.desktop.plist
=== End dry-run ===
```

If the machine has **multiple user accounts**, you will see one block of paths per user:

```
=== Dry-run: paths that would be removed ===
  /Applications/Hoppscotch.app
  /Users/alice/Library/Application Support/io.hoppscotch.desktop
  /Users/alice/Library/Logs/io.hoppscotch.desktop
  /Users/alice/Library/Caches/io.hoppscotch.desktop
  /Users/alice/Library/WebKit/io.hoppscotch.desktop
  /Users/alice/Library/Saved Application State/io.hoppscotch.desktop.savedState
  /Users/alice/Library/HTTPStorages/io.hoppscotch.desktop
  /Users/alice/Library/Preferences/io.hoppscotch.desktop.plist
  /Users/bob/Library/Application Support/io.hoppscotch.desktop
  /Users/bob/Library/Logs/io.hoppscotch.desktop
  /Users/bob/Library/Caches/io.hoppscotch.desktop
  /Users/bob/Library/WebKit/io.hoppscotch.desktop
  /Users/bob/Library/Saved Application State/io.hoppscotch.desktop.savedState
  /Users/bob/Library/HTTPStorages/io.hoppscotch.desktop
  /Users/bob/Library/Preferences/io.hoppscotch.desktop.plist
=== End dry-run ===
```

> **Note:** The dry run lists paths based on the `/Users/*/` glob — it shows all
> user home directories that exist, regardless of whether Hoppscotch was actually
> installed for that user. During a real uninstall, `uninstall.sh` silently skips
> any path that does not exist.

---

### Dry run vs. real uninstall — comparison

| | `make test` (dry run) | `sudo bash scripts/uninstall.sh` (real) |
|---|---|---|
| Requires `sudo`? | ❌ No | ✅ Yes |
| Deletes anything? | ❌ Never | ✅ Yes — permanent |
| Output | List of paths | Live log of removed / skipped items |
| Safe to run repeatedly? | ✅ Yes | ⚠️ Only run when you mean it |

---

## Versioning

The PKG version is read from `package.json` automatically.
Override it at build time:

```bash
PKG_VERSION="2.0.0" make pkg
```

