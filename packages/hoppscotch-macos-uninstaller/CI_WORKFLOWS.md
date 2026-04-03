# macOS Uninstaller — GitHub Actions Workflows

This document explains the two CI/CD workflows that build the Hoppscotch macOS Uninstaller `.pkg` artefacts. It covers **what** each workflow does, **why** every configuration decision was made, and **how** to use them.

---

## Table of contents

1. [Overview — two workflows, two purposes](#1-overview--two-workflows-two-purposes)
2. [Workflow A — `build-hoppscotch-macos-uninstaller.yml` (production)](#2-workflow-a--build-hoppscotch-macos-uninstallerymls-production)
   - [Trigger & inputs](#21-trigger--inputs)
   - [Environment variable](#22-environment-variable)
   - [Job: `build-pkg`](#23-job-build-pkg)
   - [Step-by-step breakdown](#24-step-by-step-breakdown)
3. [Workflow B — `build-hoppscotch-macos-uninstaller-test.yml` (test / CI gate)](#3-workflow-b--build-hoppscotch-macos-uninstaller-testyml-test--ci-gate)
   - [Trigger & inputs](#31-trigger--inputs)
   - [Concurrency guard](#32-concurrency-guard)
   - [Job: `build-test-pkg`](#33-job-build-test-pkg)
   - [Step-by-step breakdown](#34-step-by-step-breakdown)
4. [Required repository secrets](#4-required-repository-secrets)
5. [Workflow comparison table](#5-workflow-comparison-table)
6. [Secrets setup guide](#6-secrets-setup-guide)
7. [Frequently asked questions](#7-frequently-asked-questions)

---

## 1. Overview — two workflows, two purposes

| | Workflow A — Production | Workflow B — Test |
|---|---|---|
| **File** | `build-hoppscotch-macos-uninstaller.yml` | `build-hoppscotch-macos-uninstaller-test.yml` |
| **Trigger** | Manual (`workflow_dispatch`) only | Manual **+** automatic on PRs |
| **Output** | `HoppscotchUninstaller-<version>.pkg` | `HoppscotchUninstaller-TEST-<version>.pkg` |
| **Deletes files when installed?** | ✅ Yes — real uninstall | ❌ Never — dry-run scan only |
| **Signing / notarization?** | Optional (controlled by inputs) | Not required |
| **Secrets needed?** | Only when signing/notarizing | None |
| **Retention** | 30 days | 7 days |
| **Primary audience** | Release engineers, IT admins | Developers, PR reviewers |

---

## 2. Workflow A — `build-hoppscotch-macos-uninstaller.yml` (production)

### 2.1 Trigger & inputs

```yaml
on:
  workflow_dispatch:
    inputs:
      version:   ...   # optional; defaults to package.json version
      branch:    ...   # required; which branch to build from
      sign:      ...   # boolean; whether to code-sign the PKG
      notarize:  ...   # boolean; whether to notarize with Apple
```

**Why `workflow_dispatch` only?**

Building the production PKG is a deliberate release action, not something that should run automatically on every commit or PR. Using `workflow_dispatch` means:

- A human must consciously decide to create a new production PKG.
- No secrets are consumed accidentally during routine CI.
- The run can be tracked to a specific person and a specific intent.

**Why is `version` optional?**

The build script (`build-pkg.sh`) reads the version from `package.json` automatically via `node -p`. This prevents a mismatch between the file name and the declared package version. You override it with the `version` input only when you need the PKG to carry a version that differs from `package.json` (e.g. a hotfix that isn't reflected in the file yet).

**Why separate `sign` and `notarize` booleans?**

Signing and notarization are two independent Apple requirements:

| Step | Tool | Requirement | Cost |
|------|------|-------------|------|
| **Sign** | `productsign` | Developer ID Installer certificate ($99/yr Apple Developer Program) | Runs in seconds |
| **Notarize** | `xcrun notarytool submit` | Same certificate + Apple ID + app-specific password | Takes 1–5 minutes; requires internet round-trip to Apple servers |

Separating them lets you build and test a signed (but not yet notarized) PKG quickly during development. Only releases intended for end users need both.

---

### 2.2 Environment variable

```yaml
env:
  PACKAGE_PATH: packages/hoppscotch-macos-uninstaller
```

**Why define this at the top level?**

`PACKAGE_PATH` is used in `working-directory:` and `path:` fields across multiple steps. Defining it once at the workflow level avoids copy-paste errors and makes it trivial to rename the package directory in the future.

---

### 2.3 Job: `build-pkg`

```yaml
runs-on: macos-latest
timeout-minutes: 30
```

**Why `macos-latest`?**

`pkgbuild` and `productbuild` — the two Apple tools used by `build-pkg.sh` — are **macOS-only proprietary binaries**. They ship with Xcode Command Line Tools and do not exist on Linux or Windows runners. The workflow cannot be built on any other OS.

**Why `timeout-minutes: 30`?**

- An unsigned build completes in under 1 minute.
- A signed + notarized build adds up to 5 minutes for Apple's notarization servers.
- 30 minutes is generous headroom while still preventing a runaway job from consuming billable runner minutes indefinitely.

---

### 2.4 Step-by-step breakdown

#### Step 1 — Checkout repository

```yaml
- name: Checkout repository
  uses: actions/checkout@v4
  with:
    ref: ${{ inputs.branch }}
```

**What:** Clones the repository at the branch or tag specified by the user.

**Why `actions/checkout@v4`:** v4 is the current major version and uses Node 20 internally. Earlier versions (v3 and below) use Node 16, which reached end-of-life. Using v4 avoids deprecation warnings in workflow logs.

**Why `ref: ${{ inputs.branch }}`:** Allows the user to build from `main`, a release tag (e.g. `v1.2.0`), or a feature branch without editing the workflow file.

---

#### Step 2 — Setup Node.js

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: 20
```

**What:** Installs Node.js 20 on the runner.

**Why Node is needed here:** `build-pkg.sh` reads the PKG version using:

```bash
node -p "require('./package.json').version"
```

Without Node, the script falls back to a hardcoded `"1.0.0"` string, which would produce incorrectly versioned artefacts.

**Why Node 20:** Node 20 is the current Active LTS release. It matches the version used by the `tests.yml` CI workflow (pinned to 22) and the agent/desktop build workflows (pinned to 20–22). Consistency reduces cross-version debugging.

---

#### Step 3 — Verify build tools

```yaml
- name: Verify build tools (pkgbuild / productbuild)
  run: |
    command -v pkgbuild     || { echo "ERROR: pkgbuild not found."; exit 1; }
    command -v productbuild || { echo "ERROR: productbuild not found."; exit 1; }
    sw_vers
    uname -m
```

**What:** Confirms that `pkgbuild` and `productbuild` are on `$PATH`, then prints the macOS version and CPU architecture.

**Why this step exists:**

1. **Fail-fast with a clear message.** If the runner image ever removes these tools, the job fails at step 3 with a human-readable error instead of a cryptic shell error buried in the middle of `build-pkg.sh`.
2. **Architecture logging.** The macOS runner can be either x86_64 (Intel) or arm64 (Apple Silicon). Logging `uname -m` and `sw_vers` makes it easy to reproduce a build failure locally by knowing exactly which runner variant was used.

`pkgbuild` and `productbuild` are always present on GitHub's `macos-latest` runner (they ship with Xcode CLT which is pre-installed), but the explicit check is cheap insurance.

---

#### Step 4 — Import Developer ID Installer certificate

```yaml
- name: Import Developer ID Installer certificate
  if: ${{ inputs.sign == true }}
  uses: apple-actions/import-codesign-certs@v3
  with:
    p12-file-base64: ${{ secrets.MACOS_UNINSTALLER_CERTIFICATE }}
    p12-password: ${{ secrets.MACOS_UNINSTALLER_CERTIFICATE_PASSWORD }}
    keychain-password: ${{ secrets.KEYCHAIN_PASSWORD }}
```

**What:** Decodes the base64-encoded `.p12` certificate, creates a temporary keychain on the runner, and imports the Developer ID Installer identity into it.

**Why `apple-actions/import-codesign-certs@v3`:** This official Apple action handles the fiddly `security` CLI commands needed to create a temporary keychain, import the certificate, and set keychain access policies — work that is error-prone to implement manually. It also automatically deletes the keychain at the end of the run.

**Why `if: ${{ inputs.sign == true }}`:** The certificate import is meaningless (and wastes a few seconds) for unsigned builds. Skipping it also means the certificate secrets do not need to be set for developers who only want to test the build locally or produce unsigned artefacts for review.

**Why three separate secrets (`CERTIFICATE`, `CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`)?**

| Secret | Purpose |
|--------|---------|
| `MACOS_UNINSTALLER_CERTIFICATE` | The `.p12` file, base64-encoded. Contains both the private key and the public certificate. |
| `MACOS_UNINSTALLER_CERTIFICATE_PASSWORD` | Password that protects the private key inside the `.p12`. |
| `KEYCHAIN_PASSWORD` | Password for the temporary macOS keychain the action creates on the runner. Can be any random string — it only exists for the duration of the job. |

The `KEYCHAIN_PASSWORD` is distinct from the `.p12` password because macOS uses two separate passwords: one to unlock the keychain file itself and one to decrypt the private key stored inside it.

---

#### Step 5 — Build the PKG

```yaml
- name: Build PKG
  working-directory: ${{ env.PACKAGE_PATH }}
  env:
    PKG_VERSION: ${{ inputs.version }}
    SIGN_IDENTITY: ${{ inputs.sign == true && secrets.MACOS_UNINSTALLER_SIGN_IDENTITY || '' }}
    APPLE_ID:      ${{ inputs.notarize == true && secrets.MACOS_UNINSTALLER_APPLE_ID      || '' }}
    APPLE_TEAM_ID: ${{ inputs.notarize == true && secrets.MACOS_UNINSTALLER_APPLE_TEAM_ID || '' }}
    APP_PASSWORD:  ${{ inputs.notarize == true && secrets.MACOS_UNINSTALLER_APP_PASSWORD  || '' }}
  run: bash scripts/build-pkg.sh
```

**What:** Runs `build-pkg.sh` from the package directory. The script:

1. Copies `scripts/pkg/preinstall`, `scripts/pkg/postinstall`, and `scripts/uninstall.sh` into a temp staging directory.
2. Calls `pkgbuild --nopayload` to create a *component package* (scripts only, no files to install).
3. Calls `productbuild --distribution` to wrap the component in the GUI installer defined by `resources/distribution.xml`.
4. If `SIGN_IDENTITY` is set: calls `productsign` to code-sign the flat package.
5. If all four Apple credentials are set: calls `xcrun notarytool submit` then `xcrun stapler staple`.
6. Outputs `dist/HoppscotchUninstaller-<VERSION>.pkg`.

**Why pass empty strings instead of skipping the `env` block?**

`build-pkg.sh` reads these variables with `${SIGN_IDENTITY:-}` (default empty) and skips the signing/notarization steps when they are empty. The conditional expression `${{ inputs.sign == true && secrets.X || '' }}` evaluates to the secret value when signing is requested and to an empty string otherwise. This prevents the secret from being passed to the environment (and potentially logged) when not needed.

**Why `working-directory: ${{ env.PACKAGE_PATH }}`?**

`build-pkg.sh` uses relative paths like `../resources` and `./dist`. Running it from any other directory would break those relative references. `working-directory` is cleaner than prefixing every command with `cd packages/hoppscotch-macos-uninstaller &&`.

---

#### Step 6 — List built artifacts

```yaml
- name: List built artifacts
  working-directory: ${{ env.PACKAGE_PATH }}
  run: ls -lah dist/
```

**What:** Prints the contents of `dist/` after the build.

**Why:** Confirms the build produced at least one file and shows the exact file name and size in the workflow log. Makes debugging easy — if the PKG name or version is wrong you see it immediately without downloading the artifact.


---

#### Step 7 — Verify PKG signature

```yaml
- name: Verify PKG signature
  if: ${{ inputs.sign == true }}
  run: pkgutil --check-signature "$file"
```

**What:** Calls Apple's `pkgutil --check-signature` to confirm the signature is valid and chains back to a trusted Developer ID Intermediate certificate.

**Why:** Code-signing can silently succeed with an expired or incorrect identity. This step acts as the CI equivalent of a consumer running `pkgutil --check-signature` before installing — if it fails here, the PKG would be rejected by Gatekeeper on end-user Macs.

---

#### Step 8 — Upload PKG artifact

```yaml
- name: Upload PKG artifact
  uses: actions/upload-artifact@v4
  with:
    name: HoppscotchUninstaller-macos
    path: ${{ env.PACKAGE_PATH }}/dist/*.pkg
    retention-days: 30
```

**What:** Zips and uploads the built `.pkg` file from `dist/` to GitHub Artifacts.

**Why 30-day retention:** Release PKGs should remain available long enough for the release process to complete and for any post-release validation. GitHub's default is 90 days; 30 days is a reasonable reduction that covers typical release timelines while controlling storage costs.

**How to download:** Go to **Actions → this workflow run → Artifacts → HoppscotchUninstaller-macos**.

---

## 3. Workflow B — `build-hoppscotch-macos-uninstaller-test.yml` (test / CI gate)

### 3.1 Trigger & inputs

```yaml
on:
  workflow_dispatch:
    inputs:
      branch: ...   # optional; defaults to "main"
  pull_request:
    paths:
      - "packages/hoppscotch-macos-uninstaller/**"
    branches:
      - main
      - staging
      - next
```

**Why two triggers?**

| Trigger | Purpose |
|---------|---------|
| `workflow_dispatch` | Lets a developer or IT admin build the TEST PKG on demand from any branch. |
| `pull_request` | Automatically validates every PR that modifies the uninstaller package. |

**Why `paths` filtering on the PR trigger?**

Without the `paths` filter, this workflow would spin up a macOS runner (the most expensive runner type) for every PR — even ones that touch backend code or the web app. The `paths` filter restricts macOS runner usage to PRs that actually change `packages/hoppscotch-macos-uninstaller/**`, keeping CI costs proportional to what changed.

**Why `branches: [main, staging, next]`?**

These are the three long-lived integration branches in the repository (matching the pattern from `tests.yml`). Protecting these branches with the TEST PKG CI gate ensures the uninstaller package always builds cleanly before code is merged.

---

### 3.2 Concurrency guard

```yaml
concurrency:
  group: macos-uninstaller-test-${{ github.head_ref || github.ref }}
  cancel-in-progress: true
```

**What:** Cancels any in-progress run for the same branch before starting a new one.

**Why:** Developers often push multiple commits to a PR branch in quick succession. Without this guard, each push would queue a new macOS runner job, consuming minutes for builds that are already superseded. The concurrency group is scoped per-branch so parallel PRs do not cancel each other.

`github.head_ref` is set for PR events (the PR source branch name). `github.ref` is the fallback for `workflow_dispatch` events.

---

### 3.3 Job: `build-test-pkg`

```yaml
runs-on: macos-latest
timeout-minutes: 15
```

**Why a shorter timeout than the production workflow?**

The TEST PKG build:
- Has no signing or notarization steps (the two slowest parts of the production build).
- Runs only `pkgbuild` and `productbuild` — each completes in under 10 seconds.

15 minutes is more than enough and provides a tighter upper bound on accidental runaway jobs during PR validation.

---

### 3.4 Step-by-step breakdown

#### Step 1 — Checkout repository

```yaml
- name: Checkout repository
  uses: actions/checkout@v4
  with:
    ref: ${{ github.event_name == 'workflow_dispatch' && inputs.branch || github.head_ref }}
```

**What:** Checks out the correct branch for each trigger type.

**Why the ternary expression?**

| Event | `github.event_name` | Resolved ref |
|-------|---------------------|--------------|
| `pull_request` | `pull_request` | `github.head_ref` — the PR's source branch |
| `workflow_dispatch` | `workflow_dispatch` | `inputs.branch` — user's choice |

Using a single checkout step with a conditional ref avoids duplicating steps or using a `strategy.matrix`.

---

#### Step 2 — Setup Node.js

Same rationale as [Workflow A, Step 2](#step-2--setup-nodejs). `build-test-pkg.sh` also reads `package.json` for the version string used in the output file name.

---

#### Step 3 — Verify build tools

Same rationale as [Workflow A, Step 3](#step-3--verify-build-tools). Both workflows share this gate because both ultimately call `pkgbuild` and `productbuild`.

---

#### Step 4 — Validate package structure

```yaml
- name: Validate package structure
  working-directory: ${{ env.PACKAGE_PATH }}
  run: |
    required_files=(
      "scripts/build-test-pkg.sh"
      "scripts/pkg-test/preinstall"
      "scripts/pkg-test/postinstall"
      "resources/test/distribution.xml"
      "resources/test/welcome-test.html"
      "resources/test/conclusion-test.html"
      "package.json"
    )
    ...
```

**What:** Checks that every file needed by `build-test-pkg.sh` exists before the build starts.

**Why this step exists (it doesn't exist in Workflow A):**

Workflow B runs automatically on PRs. A PR might accidentally delete a resource file (e.g. `welcome-test.html`) with the intent of renaming it. Without this check, the failure would surface as a cryptic `productbuild: error: no bundle found at ...` message buried mid-script. This step catches that class of error earlier with a message that names the missing file explicitly.

The production workflow (A) skips this step because it is manually triggered by a release engineer who would notice the missing file before triggering the run. For the automated PR gate (B), early validation is worth the few seconds.

---

#### Step 5 — Build the TEST PKG

```yaml
- name: Build TEST PKG (dry-run — nothing deleted)
  working-directory: ${{ env.PACKAGE_PATH }}
  run: bash scripts/build-test-pkg.sh
```

**What:** Runs `build-test-pkg.sh`, which:

1. Copies `scripts/pkg-test/preinstall` and `scripts/pkg-test/postinstall` into a temp directory.
2. Calls `pkgbuild --nopayload` → `component-test.pkg`.
3. Calls `productbuild --distribution resources/test/distribution.xml` → `dist/HoppscotchUninstaller-TEST-<VERSION>.pkg`.

The `postinstall` script inside the TEST PKG (`scripts/pkg-test/postinstall`) scans the Mac for Hoppscotch artefacts and produces an HTML report — but does **not** call `rm` or any destructive command.

**Why no `env` variables for signing?**

The TEST PKG does not need to be signed. It is a developer validation tool, not a distribution artefact. Requiring signing credentials would break the PR CI gate for contributors who do not have Apple Developer Program membership.

---

#### Step 6 — List built artifacts

Same rationale as [Workflow A, Step 6](#step-6--list-built-artifacts), plus an explicit count check that fails the job if no TEST PKG was produced:

```bash
pkg_count=$(find dist/ -name "HoppscotchUninstaller-TEST-*.pkg" | wc -l | tr -d ' ')
[[ "$pkg_count" -ge 1 ]] || { echo "ERROR: No TEST PKG was generated in dist/."; exit 1; }
```

**Why the count check?** `build-test-pkg.sh` uses `set -euo pipefail` so most failures abort the script. However, a subtle bug could result in the script exiting 0 while producing no output file. The count check catches that case.

---

#### Step 7 — Validate PKG is a valid flat package

```yaml
- name: Validate PKG is a valid flat package
  run: |
    pkgutil --expand "$pkg" "$tmp_dir/expanded" && echo "  ✓ PKG expands cleanly" || ...
```

**What:** Attempts to expand the PKG archive using `pkgutil --expand`. A successful expansion proves:
- The file is a valid flat package (not a truncated or corrupt archive).
- The internal structure (`Distribution`, `component-test.pkg`, etc.) is intact.

**Why `--expand` instead of `--check-signature`?**

`pkgutil --check-signature` returns a non-zero exit code for unsigned packages (by design). Since the TEST PKG is deliberately unsigned, using `--check-signature` would always fail. `--expand` succeeds for both signed and unsigned PKGs, making it the correct validator here.

---

#### Step 8 — Upload TEST PKG artifact

```yaml
- name: Upload TEST PKG artifact
  uses: actions/upload-artifact@v4
  with:
    name: HoppscotchUninstaller-TEST-macos
    path: ${{ env.PACKAGE_PATH }}/dist/HoppscotchUninstaller-TEST-*.pkg
    retention-days: 7
```

**What:** Uploads only the TEST PKG file (not checksums — TEST PKGs are not distributed).

**Why 7-day retention (vs 30 for production)?**

TEST PKGs are ephemeral review tools. Once a PR is merged (or closed), the TEST PKG from that PR has no further use. 7 days is enough time for a reviewer to download and test it during an active PR review cycle.

---

#### Step 9 — Post PR comment with test instructions

```yaml
- name: Post PR comment with test instructions
  if: ${{ github.event_name == 'pull_request' }}
  uses: actions/github-script@v7
  with:
    script: |
      await github.rest.issues.createComment({ ... });
```

**What:** Posts a comment on the PR with a link to the artifact and instructions for testing it on a Mac.

**Why this step?**

Most contributors work on Windows or Linux and cannot install the TEST PKG themselves. The comment:

1. Alerts reviewers that a TEST PKG exists and tells them where to find it.
2. Provides copy-paste instructions so a macOS reviewer can verify the installer in under 2 minutes.
3. Makes the review process self-documenting — the PR history shows that the PKG was built and validated.

**Why `if: ${{ github.event_name == 'pull_request' }}`?**

`actions/github-script` cannot post a PR comment when there is no PR (e.g. `workflow_dispatch` runs have no `context.issue.number`). The condition prevents a runtime error on manual triggers.

---

## 4. Required repository secrets

### Workflow A — Production (signing + notarization)

| Secret name | Required when | Value |
|-------------|---------------|-------|
| `MACOS_UNINSTALLER_CERTIFICATE` | `sign == true` | Base64-encoded `.p12` file containing the Developer ID Installer certificate and private key |
| `MACOS_UNINSTALLER_CERTIFICATE_PASSWORD` | `sign == true` | Password protecting the `.p12` private key |
| `KEYCHAIN_PASSWORD` | `sign == true` | Any random string — used for the runner's temporary keychain |
| `MACOS_UNINSTALLER_SIGN_IDENTITY` | `sign == true` | Full identity string: `Developer ID Installer: Company Name (TEAMID)` |
| `MACOS_UNINSTALLER_APPLE_ID` | `notarize == true` | Apple ID email used for notarization |
| `MACOS_UNINSTALLER_APPLE_TEAM_ID` | `notarize == true` | 10-character Apple Team ID (e.g. `ABCD123456`) |
| `MACOS_UNINSTALLER_APP_PASSWORD` | `notarize == true` | App-specific password generated at [appleid.apple.com](https://appleid.apple.com) |

### Workflow B — Test

**No secrets required.** The TEST PKG is unsigned and does not call any Apple credential APIs.

---

## 5. Workflow comparison table

| Attribute | Workflow A (production) | Workflow B (test) |
|-----------|------------------------|-------------------|
| **File name** | `build-hoppscotch-macos-uninstaller.yml` | `build-hoppscotch-macos-uninstaller-test.yml` |
| **Trigger** | `workflow_dispatch` only | `workflow_dispatch` + `pull_request` |
| **PR path filter** | — | `packages/hoppscotch-macos-uninstaller/**` |
| **Concurrency guard** | — | ✅ cancels superseded PR runs |
| **Runner** | `macos-latest` | `macos-latest` |
| **Timeout** | 30 min | 15 min |
| **Node.js** | v20 | v20 |
| **Certificate import** | Optional (when `sign == true`) | ❌ not needed |
| **Signing** | Optional | ❌ |
| **Notarization** | Optional | ❌ |
| **Package structure check** | ❌ | ✅ |
| **PKG integrity check** | `pkgutil --check-signature` (signed) | `pkgutil --expand` (unsigned-safe) |
| **Artifact name** | `HoppscotchUninstaller-macos` | `HoppscotchUninstaller-TEST-macos` |
| **Artifact retention** | 30 days | 7 days |
| **PR comment** | ❌ | ✅ (on PR events) |
| **Deletes files when installed** | ✅ (real uninstall) | ❌ (HTML report only) |
| **Secrets needed** | 7 (only when signing/notarizing) | 0 |

---

## 6. Secrets setup guide

### Step 1 — Export your Developer ID Installer certificate

```bash
# On your Mac, find the certificate in Keychain Access → My Certificates
# Right-click → Export → .p12 format, set a strong password

# Then base64-encode it for GitHub Secrets:
base64 -i DeveloperIDInstaller.p12 | pbcopy
# Paste the result into: Settings → Secrets → MACOS_UNINSTALLER_CERTIFICATE
```

### Step 2 — Store secrets in GitHub

Go to your repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Create each secret from the table in [§4](#4-required-repository-secrets).

### Step 3 — Find your signing identity string

```bash
# On a Mac that has the certificate imported into Keychain:
security find-identity -v -p basic | grep "Developer ID Installer"
# Output example:
#   1) ABCDEF1234... "Developer ID Installer: Hoppscotch Inc (ABCD123456)"
#                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
#                    Copy this string into MACOS_UNINSTALLER_SIGN_IDENTITY
```

### Step 4 — Create an app-specific password (notarization only)

1. Go to [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security** → **App-Specific Passwords**.
2. Click **+**, name it `GitHub Actions Notarize`, generate.
3. Copy the password → store in `MACOS_UNINSTALLER_APP_PASSWORD`.

---

## 7. Frequently asked questions

### Q: Why can't the PKG be built on a Linux or Windows runner?

`pkgbuild` and `productbuild` are Apple-proprietary tools compiled for macOS. They are not open-source and have no Linux or Windows equivalents. Building a `.pkg` on a non-Mac is not supported by Apple. GitHub's `macos-latest` runner (running macOS Ventura/Sonoma on Apple Silicon) has both tools pre-installed via Xcode Command Line Tools.

### Q: Why is the production workflow manual-only?

PKG uninstallers permanently delete application data. Accidentally deploying an untested version via MDM to hundreds of managed Macs could result in data loss for users. Manual triggers enforce a human review gate. The TEST PKG workflow handles automated PR validation — the production PKG workflow is reserved for deliberate release actions.

### Q: What is the difference between `pkgbuild` and `productbuild`?

| Tool | What it does | Output |
|------|-------------|--------|
| `pkgbuild` | Packages scripts and/or files into a low-level component package | `component.pkg` |
| `productbuild` | Wraps one or more component packages in a full macOS Installer GUI (title, welcome screen, licence, conclusion) | Final flat `.pkg` |

The uninstaller uses both in sequence: `pkgbuild` creates a scripts-only component (no payload), then `productbuild` adds the GUI defined by `resources/distribution.xml`.

### Q: Why is the TEST PKG unsigned?

The TEST PKG is a developer validation tool, not a distribution artefact. Signing requires:
1. An Apple Developer Program membership ($99/year).
2. Secrets that not every contributor has access to.

macOS will show a Gatekeeper warning when opening an unsigned PKG, which is acceptable for an internal testing tool used by developers and IT reviewers on trusted machines. End users never receive the TEST PKG.

### Q: Why does the PR trigger only fire for `main`, `staging`, and `next`?

These are the repository's three long-lived integration branches. PRs targeting short-lived feature branches do not need the CI gate because feature branches are not deployed. This also prevents the `pull_request` trigger from firing on PRs that were opened from a fork and targeting a non-standard branch, which could expose secrets or waste runner minutes.

### Q: Can the production workflow run without any secrets?

Yes. If both `sign` and `notarize` are set to `false` (the defaults), the workflow builds an **unsigned PKG** without importing any certificates or calling any Apple APIs. This is useful for:
- Developing and testing the build scripts locally.
- Generating an unsigned PKG for review before obtaining Apple credentials.
- CI validation in environments that do not have access to signing certificates.

### Q: How do I run the workflows?

**Workflow A — Production:**
1. Go to **Actions** → **Build macOS Uninstaller PKG** → **Run workflow**.
2. Fill in `version`, `branch`, and optionally enable `sign` / `notarize`.
3. Click **Run workflow**.
4. Download the artifact from the completed run.

**Workflow B — Test:**
- **Automatically:** Open a PR that modifies any file under `packages/hoppscotch-macos-uninstaller/`. The workflow starts automatically.
- **Manually:** Go to **Actions** → **Build macOS Uninstaller TEST PKG** → **Run workflow** → select branch.

