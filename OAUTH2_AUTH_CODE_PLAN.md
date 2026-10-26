# OAuth 2.0 Authorization Code: Postman Parity Plan

## 1. Goal

Make Hoppscotch generate an OAuth 2.0 token for the **"bff - auth code testing"**
Postman collection, the same way Postman does. **Do not change any existing
behaviour.**

### What the Postman collection does

| Postman field | Value / meaning |
|---|---|
| `grant_type` | `authorization_code` |
| `authUrl` | `https://loginqa.ford.com/<tenant>/b2c_1a_qa_signinsignup_en-us/oauth2/v2.0/authorize` (Azure AD B2C) |
| `accessTokenUrl` | `.../oauth2/v2.0/token` |
| `clientId`, `clientSecret`, `scope` | `openid offline_access <clientId>` |
| `redirect_uri` | `https://localdev.ford.com:8443/login/oauth2/code/aadb2c`, a **custom callback URL** registered in B2C |
| `useBrowser: false` | Postman opens its **own login window** and catches the redirect to `redirect_uri`, so no server has to run on `localdev.ford.com` |
| `authRequestParams` | `country_code=USA`, `ford_application_id=...`, `response_mode=query` (`send_as: request_url`) |
| `tokenRequestParams` | `[]` |
| `client_authentication` | `body`: the client ID and secret are sent in the token request body |
| `addTokenTo` | `header` |

---

## 2. How Hoppscotch handles OAuth 2.0 today

| Layer | Location |
|---|---|
| Data schema | `packages/hoppscotch-data/src/rest/v/15/auth.ts` (`AuthCodeGrantTypeParams`, `HoppRESTAuthOAuth2`). Latest versions: REST `v17`, GraphQL `v10`, Collection `v12` |
| Form state / actions | `packages/hoppscotch-common/src/composables/oauth2/useOAuth2GrantTypes.ts` |
| Advanced params UI state | `packages/hoppscotch-common/src/composables/oauth2/useOAuth2AdvancedParams.ts` |
| UI | `packages/hoppscotch-common/src/components/http/authorization/OAuth2.vue` |
| Flow logic | `packages/hoppscotch-common/src/services/oauth/flows/authCode.ts` |
| Shared OAuth service | `packages/hoppscotch-common/src/services/oauth/oauth.service.ts` (`OauthAuthService.redirectURI`, `routeOAuthRedirect`) |
| Refresh logic | `packages/hoppscotch-common/src/services/oauth/utils.ts` |
| Callback page | `packages/hoppscotch-common/src/pages/oauth.vue` |
| Postman import | `packages/hoppscotch-common/src/helpers/import-export/import/postman.ts` |
| Desktop shell | `packages/hoppscotch-desktop/src-tauri` (Tauri v2, deep-link scheme `io.hoppscotch.desktop`) |

### Current Authorization Code flow

1. **Generate Token** → `authCode.init()` saves the flow settings to `oauth_temp_config`.
2. `window.location.assign(authUrl)` sends **the whole app** to the provider.
   The `redirect_uri` is always `${window.location.origin}/oauth`.
3. The provider redirects to `/oauth` → `pages/oauth.vue` → `routeOAuthRedirect()`.
4. `handleRedirectForAuthCodeOauthFlow()` checks `state` and exchanges the `code`
   for a token through `KernelInterceptorService` (the proxy, extension, agent or native interceptor).
5. The token is written back to the request tab or collection.

---

## 3. Gap analysis

| # | Gap | Severity for this collection |
|---|---|---|
| G1 | The callback URL is **hard-coded** (`${origin}/oauth`) and cannot be changed | 🔴 Blocker: B2C only accepts the registered `localdev.ford.com` URL |
| G2 | There is **no way to catch a redirect to another domain** (Postman's `useBrowser:false`) | 🔴 Blocker |
| G3 | `tokenRequestParams` are stored but **ignored** in the code-for-token request | 🟠 Bug |
| G4 | Authorization Code has **no client authentication option** (basic auth header vs body). Only Client Credentials has it | 🟡 Missing option (body, today's behaviour, is what this collection needs) |
| G5 | The Postman importer **drops** `redirect_uri`, `useBrowser`, `authRequestParams`, `tokenRequestParams`, `refreshRequestParams`, `client_authentication` and `addTokenTo`. It also **always** imports the grant as Authorization Code | 🟠 Imported collection is incomplete |
| G6 | Logging in navigates the whole app away. A popup or new tab would be better | 🟢 Nice-to-have, covered by Option A |

---

## 4. Design decisions

* **Option A (web and desktop): manual "paste redirect URL".** The login page
  opens in a new window. After login the browser lands on
  `https://localdev.ford.com:8443/...?code=...&state=...` (the page may not load,
  which is expected). The user pastes that full URL into a Hoppscotch dialog, and
  Hoppscotch checks `state` and exchanges the code.
* **Option B (desktop only): automatic capture.** A Tauri login window opens the
  login page and watches each navigation. When the URL starts with the configured
  callback URL, it **cancels** that navigation, sends the URL to the frontend and
  closes itself. The frontend then follows the same path as Option A.
* **Backward compatibility rules**
  * New fields are **optional, with defaults that reproduce today's behaviour**:
    * `useBrowserCallback` (default `true`): the existing `/oauth` redirect flow is unchanged.
    * `redirectURI` (default `""`): ignored unless `useBrowserCallback` is `false`.
    * `clientAuthentication` (default `"IN_BODY"`): matches what is sent today.
  * Schema changes are **additive optional fields on the existing OAuth 2.0
    schema (`rest/v/15/auth.ts`) with no version bump**. This follows the
    upstream precedent for `tokenType` (#6444). A version bump
    (REST v18 / GQL v11 / Collection v13) would make older clients, the CLI and
    teammates on older builds **reject** shared team data. Optional fields work in
    both directions: older clients just ignore them.
  * Sending `tokenRequestParams` only adds the user's own enabled parameters,
    so it is a no-op for existing users who have none.
  * The existing `/oauth` page and `routeOAuthRedirect()` stay as they are.

---

## 5. Implementation steps

Each step is a separate, reviewable change. After each step, run the type check and relevant tests before starting the next one.

### Step 1: Data model (`packages/hoppscotch-data`) ✅

1. `src/rest/v/15/auth.ts`: `AuthCodeGrantTypeParams` gains **optional** fields:
   * `useBrowserCallback: z.boolean().optional().catch(true)` (`undefined` means today's `/oauth` flow)
   * `redirectURI: z.string().optional().catch("")`
   * `clientAuthentication: OAuth2ClientAuthentication.optional().catch("IN_BODY")`
   * New exported enum `OAuth2ClientAuthentication` (`AS_BASIC_AUTH_HEADERS` | `IN_BODY`).
2. GraphQL (`graphql/v/9.ts`) and Collection (`collection/v/9+`) reuse
   `HoppRESTAuthOAuth2`, so they pick up the fields automatically.
3. Invalid values fall back to safe defaults through `.catch()`, so a request never fails to parse.
4. Tests: `hoppscotch-common/src/helpers/auth/types/__tests__/oauth2-schema.spec.ts`
   (legacy data unchanged, fields kept, invalid values fall back, REST, GQL and collection parsing).

### Step 2: Flow logic (`services/oauth`) ✅

Implemented as planned, with these details:
* `init()` returns `E.right({ mode: "redirect" })` (unchanged navigation) or
  `E.right({ mode: "external", authUrl, redirectURI })`.
* `exchangeCodeForToken(callbackUrl, localConfig)` is exported. It does **not**
  clear `oauth_temp_config`, because `pages/oauth.vue` still reads it afterwards.
  Cleanup for external mode belongs to Step 3.
* Shared helpers in `utils.ts`: `encodeBasicAuthComponent` (moved from
  `clientCredentials.ts`), `getBasicAuthHeaderValue`, `applyOAuth2AdvancedParams`,
  `appendQueryParamsToURL` (leaves the endpoint string untouched when there are no URL params).
* The composable passes `useBrowserCallback`, `redirectURI` and `clientAuthentication`
  from the saved auth into `init()` and `refreshToken()`.
* Tests: `services/oauth/__tests__/authCode.spec.ts` (15 tests, including a byte-for-byte
  legacy token request check).

Original plan for this step:

1. `flows/authCode.ts`
   * Extend `AuthCodeOauthFlowParamsSchema` with the new fields.
   * Add `getEffectiveRedirectURI(params)`. It returns the custom `redirectURI` when
     `useBrowserCallback === false` and the value is not empty. Otherwise it returns `OauthAuthService.redirectURI`.
   * `init()` now:
     * Builds the auth URL (logic unchanged) using the effective redirect URI.
     * Saves `redirectURI`, `clientAuthentication`, `tokenRequestParams` and
       `useBrowserCallback` in `oauth_temp_config`.
     * **Branch:**
       * `useBrowserCallback === true` → `window.location.assign(url)`, exactly as today.
       * otherwise → returns `E.right({ mode: "external", authUrl, redirectURI })`.
         The caller (Step 4) then starts Option A or B.
   * Split the token exchange into a reusable
     `exchangeCodeForToken(callbackUrl: string, localConfig: string)`.
     * Parses `code`, `state` and `error` (plus `error_description`) from **any** URL.
       It reads both the query string and the fragment.
     * Checks `state`.
     * Builds the request:
       * `client_id` / `client_secret` go in the body (`IN_BODY`) **or** in the
         `Authorization: Basic` header (`AS_BASIC_AUTH_HEADERS`, RFC 6749 §2.3.1 encoding,
         reusing `encodeBasicAuthComponent` from `clientCredentials.ts`, moved to `utils.ts`).
       * `redirect_uri` is the **stored** effective redirect URI, so it matches the auth request.
       * `tokenRequestParams` go in headers, URL query or body according to `sendIn` (same pattern as `refreshToken`).
       * PKCE `code_verifier` is unchanged.
     * Does **not** clear `oauth_temp_config` itself. The caller (the `/oauth` page, or
       `OAuth2.vue` for external flows) clears it after use.
   * `handleRedirectForAuthCodeOauthFlow()` (the `/oauth` page) now calls
     `exchangeCodeForToken(window.location.href, localConfig)`, so behaviour is unchanged.
2. `utils.ts` → `refreshToken()` also respects `clientAuthentication`. It keeps
   today's body behaviour when the option is not set.
3. Unit tests: auth URL building, token request building (body vs basic,
   token parameters in each location), state mismatch, error response, fallback when the redirect URI is empty.

### Step 3: Redirect capture (Option A + Option B) ✅

> **Implementation notes**
> * The shared helpers live in `services/oauth/external-callback.ts` (plain functions instead of a service class).
>   The orchestration (try B, then fall back to A) lives in `OAuth2.vue`
>   (`startExternalLogin` / `finishExternalLogin` / `cancelExternalLogin`).
> * Error-key translation was extracted to `services/oauth/errors.ts`
>   (`translateOAuthRedirectError`), which `pages/oauth.vue` and `OAuth2.vue` share.
>   A new `INVALID_CALLBACK_URL` key was added.
> * Option B errors `WINDOW_CLOSED` / `TIMEOUT` are terminal: a toast is shown and the temp config is cleared.
>   Any other error (including the command being missing in an older desktop shell) falls back to Option A.
> * The desktop login window uses `incognito(true)`, so each login is clean. The user signs in each time
>   (no SSO cookie persistence). No capability change was needed: the window
>   loads remote `https` content, which has no IPC access.
> * Option A opens the login page via `platform.kernelIO.openExternalLink` (web and desktop).
> * Every external path (success, cancel or error) clears `oauth_temp_config`, so the
>   collection-properties modal doesn't reopen unexpectedly.
> * Tests: `services/oauth/__tests__/external-callback.spec.ts` and 4 Rust unit tests in `oauth.rs`.

#### 3a. Shared frontend service `services/oauth/oauth-external-callback.service.ts`

* `startExternalAuth({ authUrl, redirectURI }) → Promise<E.Either<Error, string /* callback URL */>>`
* Picks the strategy:
  * `getKernelMode() === "desktop"` **and** the Tauri command is available → **Option B**.
    If it fails or is unavailable, it falls back to Option A.
  * otherwise → **Option A**.
* Then calls `exchangeCodeForToken(callbackUrl, oauth_temp_config)` and returns the token.

#### 3b. Option A: paste the redirect URL (web and desktop fallback)

* Opens `authUrl` with `window.open(authUrl, "_blank", "noopener")`. On desktop it
  uses the shell/opener plugin to open the system browser.
* Shows the modal `components/http/authorization/OAuth2PasteRedirect.vue`:
  * Explains that after login the browser lands on `<redirectURI>?code=...` and
    asks the user to copy the full address from the address bar.
  * Input: the redirect URL. Checks that it starts with `redirectURI` and contains `code` or `error`.
  * Buttons: **Open login page again**, **Cancel**, **Get Token**.

#### 3c. Option B: automatic capture in a desktop login window (`packages/hoppscotch-desktop`)

* New Rust command `oauth_capture_redirect(auth_url, redirect_uri, timeout_secs)`
  in `src-tauri/src/oauth.rs`, registered in `lib.rs` and allowed in
  `capabilities/default.json`.
  * Builds a `WebviewWindowBuilder` with a unique label and an external URL
    (`auth_url`), using a fresh, non-persistent data directory so each login is clean.
  * `.on_navigation(|url| …)`: if `url` starts with `redirect_uri` → send the URL
    through a oneshot channel, **return `false`** to stop the navigation, then close the window.
  * Resolves with the captured URL. Errors: user closed the window, timeout, or invalid URL.
* Frontend wrapper: `invoke("oauth_capture_redirect", …)` inside the service from 3a.
* Security: only the callback URL is sent back. No cookies or other data
  cross the boundary. The login window has **no** IPC access (no capability is granted to it).

### Step 4: UI (`useOAuth2GrantTypes.ts`, `OAuth2.vue`, i18n) ✅

> **Implementation notes**
> * Form order (Authorization Code): PKCE, Auth/Token endpoints, Client ID/Secret, Scopes,
>   **Authorize using browser** (checkbox, default on), **Callback URL** (read-only Hoppscotch
>   URL with a copy button when checked, an editable env-aware field when unchecked),
>   **Client Authentication** (reuses `label_send_as` / `label_send_in_body` / `label_send_as_basic_auth`), Token Type.
> * A new `readonly` form-element type is rendered in `OAuth2.vue`.
> * `runAction` returns `VALIDATION_FAILED` when "Authorize using browser" is off and the callback URL is empty.
> * The token, auth and refresh request parameter sections were already shown for all grant types, so no change was needed.
> * New i18n keys: `label_use_browser`, `label_callback_url`. The rest came from Step 3 or are reused.
> * Tests: `composables/oauth2/__tests__/useOAuth2GrantTypes.spec.ts` (7 tests).

1. Authorization Code form gets:
   * Checkbox **"Authorize using browser"** (`useBrowserCallback`, default on).
     It shows the read-only Hoppscotch callback URL `${origin}/oauth` with a copy button.
   * When unchecked, a text field **"Callback URL"** (`redirectURI`, supports environment variables).
   * Dropdown **"Client Authentication"**: *Send in body* (default) / *Send as basic auth header*.
     It reuses the existing dropdown element type.
2. `runAction` handles the new `init()` result:
   `mode: "external"` → `OauthExternalCallbackService.startExternalAuth()` → on success,
   writes the token and refresh token exactly like the `/oauth` page does today, then shows a toast.
3. Show the "Token request" advanced-parameter tab for Authorization Code if it isn't already shown
   (`useOAuth2AdvancedParams.ts`).
4. Add the new keys to `packages/hoppscotch-common/locales/en.json`:
   `authorization.oauth.label_use_browser`, `label_callback_url`,
   `label_client_authentication`, `paste_redirect_title`, `paste_redirect_hint`,
   `paste_redirect_invalid`, `login_window_closed`, `login_timeout`, …
5. Keep collection-level auth (`collection-properties` context) and GraphQL working
   with the same composable, so no extra UI is needed there.

### Step 5: Postman importer (`helpers/import-export/import/postman.ts`) ✅

> **Implementation notes**
> * The Postman SDK normalises both the v2.0 object format and the v2.1 array format into a variable list
>   and keeps the raw JSON types (arrays, booleans). A `getRawVariableValue` helper reads them.
> * Grant types are mapped. Client Credentials and Password use `accessTokenUrl` as `authEndpoint`, because Hoppscotch
>   uses that field as the token URL for those flows.
> * `useBrowser: true` → `useBrowserCallback: true`.
>   A custom `redirect_uri` (with `useBrowser` false or absent) → `useBrowserCallback: false` + `redirectURI`.
>   `useBrowser: false` with no `redirect_uri` → Hoppscotch callback.
> * `send_as` mapping: `request_header`→`headers`, `request_url`→`url`, `request_body`→`body`.
>   Auth request params drop `sendIn`, because they always go in the authorization URL. `enabled: false` → inactive.
> * `client_authentication`: `header`→`AS_BASIC_AUTH_HEADERS`, `body`→`IN_BODY`.
> * `addTokenTo`: `queryParams`→`QUERY_PARAMS`, otherwise `HEADERS`.
> * PKCE is detected from `usePkce` as a boolean **or** the string `"true"` (previously only the string),
>   or from `grant_type: authorization_code_with_pkce`.
> * New fields are only emitted when present in the Postman data, so legacy output is unchanged.
> * Tests: `import/__tests__/postman-oauth2.spec.ts` (7 tests, fixture mirrors the Azure B2C collection with secrets masked).
>   The real collection was also verified to import and pass `HoppCollection` validation.

* Map `grant_type`:
  * `authorization_code` / `authorization_code_with_pkce` → `AUTHORIZATION_CODE`
  * `client_credentials` → `CLIENT_CREDENTIALS`
  * `password_credentials` → `PASSWORD`
  * `implicit` → `IMPLICIT`
* Fields:
  * `redirect_uri` → `redirectURI`
  * `useBrowser` → `useBrowserCallback`. This is set to `false` when a custom `redirect_uri` is present, unless `useBrowser` is `true`.
  * `authRequestParams` → `authRequestParams`
  * `tokenRequestParams` / `refreshRequestParams` → same names, with `send_as`: `request_body` → `body`, `request_url` → `url`, `request_header` → `headers`
  * `client_authentication`: `header` → `AS_BASIC_AUTH_HEADERS`, `body` → `IN_BODY`
  * `addTokenTo`: `header` → `HEADERS`, `queryParams` → `QUERY_PARAMS`
  * `username` / `password` for the password grant
* Postman variables (`{{var}}`) go through `replacePMVarTemplating` (already in use).
* Tests: import this collection as a fixture (secrets masked) and check the mapped auth object.

### Step 6: Verification (automated ✅, manual ⬜)

> **Automated results**
> * `hoppscotch-common` full vitest run: 90 files, 1274 passed, 2 skipped. The baseline before this work was 85 files and 1231 tests.
>   One earlier run showed a module-initialisation failure in `collections-inherited-props.spec.ts`
>   while `cargo` was building in parallel. It passes in isolation and in a clean full rerun (unrelated, load-dependent).
> * New tests:
>   * schema: 6
>   * auth code flow: 15
>   * external callback
>   * form composable: 7
>   * Postman importer: 7
> * `vue-tsc` (v2.2.10 + TS 5.9.3, temporary install; the repo's vue-tsc 1.8.8 crashes with TS 5.9) reports no errors in
>   any changed file. The remaining errors also exist on the baseline.
> * ESLint is clean on all changed files.
> * Desktop: `cargo check` passes; `cargo test oauth` 4/4 passed; `rustfmt` clean.
> * The real collection imports and passes `HoppCollection` validation.

1. `pnpm --filter @hoppscotch/data test` / type check.
2. `pnpm --filter @hoppscotch/common test` (`oauth2.spec.ts`, importer specs, new flow specs) + `vue-tsc`.
3. Desktop: `cargo check` in `packages/hoppscotch-desktop/src-tauri`.
4. Manual checks (to be done by the user, since they need real logins):
   * **Regression:** existing Authorization Code with the default Hoppscotch callback works as before (web).
   * **Option A:** import this collection in the web app → Generate Token → log in → paste the redirect URL → token is filled in.
   * **Option B:** desktop app → Generate Token → login window → captured automatically → token is filled in.
   * Refresh token works with both client authentication options.
   * Client Credentials, Password and Implicit grants are unchanged.

---

## 6. Risks and notes

* **Azure B2C:** the code is single-use and short-lived (about 10 minutes). With Option A the user has to paste the URL
  quickly. `response_mode=query` must stay set so the code arrives in the query string; the parser also accepts the fragment.
* **CORS on the token endpoint (web):** the request goes through the selected interceptor
  (proxy, extension or agent), as it does today. Without one the browser may block it.
* **Secrets:** the client secret is stored in `oauth_temp_config` (local storage), as it is today, and is
  cleared after the exchange.
* **Desktop login window cookies:** the login window runs in incognito mode, so the provider's session stays apart
  from the app and the user signs in on every token generation.
* The Postman request item itself (`POST` to the token URL with a manual `code`) still imports as a normal
  request. It is not affected.

---

## 7. Progress tracker

| Step | Description | Status |
|---|---|---|
| 1 | Data model (optional fields on the v15 OAuth 2.0 schema, no version bump) | ✅ Done |
| 2 | Flow logic (redirect URI, token params, client auth) | ✅ Done |
| 3a | External callback service | ✅ Done |
| 3b | Option A: paste redirect URL | ✅ Done |
| 3c | Option B: desktop login window capture | ✅ Done |
| 4 | UI and i18n | ✅ Done |
| 5 | Postman importer | ✅ Done |
| 6 | Verification | ✅ Automated / ⬜ Manual (needs real login) |
