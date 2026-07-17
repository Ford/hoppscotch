# 🚀 Hoppscotch CLI — Socket Hangup Fix Demo Guide

## 🛠️ 1 — Build the CLI

**Working directory:** `packages/hoppscotch-cli`

```powershell
cd C:\Users\AJ34\Downloads\Si\hoppscotch\packages\hoppscotch-cli
pnpm run build
```

The compiled output lands in `dist/index.js`. The binary entry-point is `bin/hopp.js`.
All demo commands below run from **this same folder**.

---

## 🎯 2 — How the CLI Works

```
hopp test <path-to-collection.json> [options]
```

A **collection JSON** is a Hoppscotch workspace export. It contains:

- **Folders** → grouping of requests
- **Requests** → method, URL, headers, body, auth, pre-request script, test script

The CLI runs every request top-to-bottom, executes pre-request & test scripts, and exits:
- `0` — all tests passed ✅
- `1` — one or more failures ❌

---

## 🔌 3 — The Socket Hang-up Fix — What We Fixed

| Problem (Before) | Fix (After) |
|---|---|
| A new `ProxyAgent` / `http.Agent` / `https.Agent` was created on **every retry attempt** — abandoned socket pools triggered `ECONNRESET` ("socket hang up") | Agents are created **once per request**, outside the retry loop. `collectionsRunner` creates **one shared agent** for the entire collection run — all requests share the same keep-alive socket pool |
| `ECONNRESET` crashed with no user hint | Error message now says: *"socket hang up — check proxy settings (HTTP_PROXY / HTTPS_PROXY env vars)…"* |
| No retry on transient errors | `--retries N` (default 1) auto-retries `ECONNRESET`, `ECONNABORTED`, `ETIMEDOUT`, `ENOTFOUND` |

---

## 🚀 4 — Baseline Demo (Shared Socket Pool)

Runs 3 requests through the shared keep-alive socket pool.

```powershell
node bin/hopp.js test demo\demo-collection.json
```

Full socket-fix demo (auth + retry folders in one run):

```powershell
node bin/hopp.js test demo\socket-fix-full-demo.json
```

---

## 🔑 5 — Bearer Token Demos

### With Bearer Token (expect HTTP 200 ✅) vs. Without Token (expect 401 ❌)

```powershell
node bin/hopp.js test demo\bearer-collection.json
```

> The collection fires two requests back-to-back:
> 1. `auth: bearer` → **200 OK** + `authenticated: true`
> 2. `auth: none`   → **401 Unauthorized**

### Pass Token via Environment File

Create `demo\env.json`:

```json
{
  "v": 1,
  "id": "env-demo",
  "name": "Demo Env",
  "variables": [
    { "key": "TOKEN", "value": "my-super-secret-token", "secret": false }
  ]
}
```

Reference `<<TOKEN>>` in the collection, then run:

```powershell
node bin/hopp.js test demo\bearer-collection.json -e demo\env.json
```

---

## 🔄 6 — Retry Demo (Proves ECONNRESET Fix)

```powershell
# Default: 1 automatic retry (ENOTFOUND on bad host)
node bin/hopp.js test demo\retry-collection.json

# Disable retries — fail immediately on first error
node bin/hopp.js test demo\retry-collection.json --retries 0

# 3 retries with visible back-off
node bin/hopp.js test demo\retry-collection.json --retries 3
```

---

## 🌐 7 — Proxy Demos

### Force all traffic through a proxy (`--proxy` flag)

```powershell
node bin/hopp.js test demo\demo-collection.json --proxy http://your-proxy:8080
```

### Via standard environment variable

```powershell
$env:HTTPS_PROXY = "http://your-proxy:8080"
node bin/hopp.js test demo\demo-collection.json
Remove-Item Env:\HTTPS_PROXY
```

### Exclude a host from proxy using `NO_PROXY`

```powershell
$env:HTTPS_PROXY = "http://your-proxy:8080"
$env:NO_PROXY    = "httpbin.org"   # direct connection — no proxy
node bin/hopp.js test demo\demo-collection.json
```

### Force proxy even if host is in `NO_PROXY` (`--proxy` always wins)

```powershell
$env:NO_PROXY = "httpbin.org"
node bin/hopp.js test demo\demo-collection.json --proxy http://your-proxy:8080
# --proxy flag overrides NO_PROXY, matching curl --proxy behaviour
```

---

## 🔒 8 — TLS / Insecure Demos

```powershell
# Skip TLS cert validation (self-signed / corporate certs)
node bin/hopp.js test demo\demo-collection.json --insecure

# Provide a custom CA certificate bundle (PEM)
node bin/hopp.js test demo\demo-collection.json --ca-cert C:\path\to\ca-bundle.pem
```

---

## ⏱️ 9 — Timeout Demo

```powershell
# Default timeout: 30 seconds
node bin/hopp.js test demo\demo-collection.json

# Cut timeout to 500 ms — the /delay/1 request will fail
node bin/hopp.js test demo\demo-collection.json --timeout 500

# No timeout at all
node bin/hopp.js test demo\demo-collection.json --timeout 0
```

---

---

## 📁 Demo Files Reference

| File | Purpose |
|---|---|
| `demo/demo-collection.json` | 3-request baseline — shared socket pool |
| `demo/bearer-collection.json` | Bearer token ✅ vs. no token ❌ side-by-side |
| `demo/socket-fix-full-demo.json` | All scenarios in one run (baseline + auth + retry) |
| `demo/retry-collection.json` | ENOTFOUND retry trigger |

---

## 🗂️ All Available CLI Flags

```
hopp test <file_path_or_id> [options]

Options:
  -e, --env <file_path_or_id>           environment variables JSON file
  -d, --delay <delay_in_ms>             delay (ms) between requests
  --token <access_token>                personal access token for workspace access
  --server <server_url>                 self-hosted instance URL
  --reporter-junit [path]               generate JUnit XML report
  --iteration-count <n>                 number of iterations to run
  --iteration-data <file_path>          CSV file for data-driven testing
  --legacy-sandbox                      opt out of the new scripting sandbox
  --timeout <ms>                        request timeout (0 = no timeout, default: 30000)
  --retries <n>                         retries on transient socket errors (default: 1)
  --insecure                            disable TLS certificate validation
  --ca-cert <path>                      custom CA certificate bundle (PEM)
  --proxy <url>                         force proxy URL, ignores NO_PROXY
  -h, --help                            display help
```

