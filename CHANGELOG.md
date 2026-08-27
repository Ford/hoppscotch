# Changelog

Visit [releases](https://github.com/hoppscotch/hoppscotch/releases) for the upstream changelog.

---

## [v2026.1.2] — Ford Internal Release (April 2, 2026)

> **Note:** This is a Ford-internal release. The version was bumped on the `staging` branch by [@dyoganan_ford](mailto:dyoganan@ford.com) but was never tagged or published as an official GitHub Release. This entry retroactively documents the release.

### 🚀 Ford-Specific Features

- **Collection Runner — Selection-Based Execution:** Requests in the collection runner can now be individually selected or deselected before a run. Supports drag-to-reorder for flexible test ordering.
- **Data-Driven Testing (CSV / JSON):** Added support for uploading CSV or JSON dataset files to drive collection runs. Enables parameterized, data-driven test execution directly from the UI.
- **Iterations & Validation in Collection Runner:** Collection runs can now be executed over multiple iterations, with built-in validation support across iteration cycles.
- **Cookie Persistence in Cookie Jar:** Cookies are now persisted across sessions in the cookie jar service, preserving state between requests and collection runs.
- **Automatic Cookie Management Improvements:** Updated cookie management logic (aligned with the `newchanges` branch); fixes cookie deletion not working for GET requests.
- **Scripting Enhancements:** Added specific changes to Greater and Less comparison helpers in pre/post scripts.

### 🔧 Ford-Specific Fixes

- **Settings:** Disabled experimental mock servers and cleaned up the settings page.
- **Collection Display:** Restored collection folder/request display broken from `newchanges` branch merge.
- **CLI:** Added missing runtime dependencies — `form-data` and `proxy-agent` — for the Ford CLI build.
- **Relay Request:** Fixed issue with relay request after rebase.

### 🏗️ Build / CI (Ford)

- Added macOS and Windows desktop build workflow files.
- Multiple pnpm/Node version fixes and stabilisation across build workflows.
- Removed `prisma generate` step and updated Node to v22 in backend workflow.
- Fixed missing macOS artifact handling in CI.
- Updated `--no-frozen-lockfile` flag for pnpm installs in CI.
- Added `.npmrc` to `.gitignore`.
- Removed documentation links from the settings page.

---

### 📦 Upstream Changes Incorporated (v2025.9.0 → v2026.1.1)

The following upstream Hoppscotch changes were merged into the Ford `staging` branch as part of this release cycle.

---

#### Upstream v2026.1.1

- **fix(common):** Correctly load mock servers on initialization and workspace change (#5832)
- **fix(cli):** Strip module prefix before script execution (#5835)
- **fix(common):** Correctly populate OpenAPI response examples (#5831)
- **fix(backend):** Upgrade nodemailer dependency to `v8` (#5833)
- **fix(backend):** Resolve database connection leak in infra-config operations (#5825)
- **fix(backend):** Use duration instead of timestamp for auth cookie `maxAge` (#5821)
- **fix(common):** Prevent support menu from triggering in editors (#5811)
- **fix:** Broken scroll on latest Chrome versions (#5816)
- **fix(common):** Handle null request `ref` in `InspectionService` for test-runner tabs (#5814)

#### Upstream v2026.1.0

- **feat(common):** Display user roles in member stack tooltips (#5793)
- **feat(common):** Show full request path in tab tooltip (#5750)
- **feat(desktop):** Host mapping infra for cloud orgs (#5795)
- **feat(js-sandbox):** Add extensive Web Crypto API support (#5791)
- **feat:** Migrate ESLint to `v9` across packages (#5773)
- **feat(common):** Update and complete Dutch translations (#5734)
- **feat(common):** Add Armenian translation (#5740)
- **feat(common):** Use `jq` for JSON response filtering (#5703)
- **feat(common):** Add copy functionality to console output entries (#5743)
- **fix(desktop):** Use store dir for unified store path (#5799)
- **fix(common):** Ignore shift keybindings in CodeMirror editors (#5794)
- **fix:** Add teamID/userUid filter to `updateMany` queries; fixed row-level locking to prevent deadlocks (~100× performance improvement) (#5647)
- **fix(common):** Restore scrolling on response panel (#5783)
- **fix:** Improve endpoint parsing in `parseExample` method (#5762)
- **fix(common):** Prevent duplication of request ID when duplicating requests (#5781)
- **fix(common):** Correct typo in French locale (#5733)
- **fix(common):** Prevent hang when highlighting large responses (#5714)
- **fix(cli):** Inherit collection variables in folders without own variables (#5771)
- **fix:** Strip comments from JSON request bodies in CLI (#5769)
- **fix(common):** Environment variable mapping when referencing other variables (#5704)
- **fix:** Enable scrolling for console tab in response section

#### Upstream v2025.12.1

- **perf(desktop):** Cache store path resolution (#5747)
- **fix:** Remove redundant label on the Desktop App
- **chore:** Apply `ThrottlerBehindProxyGuard` across controllers (#5746)

#### Upstream v2025.12.0

- **feat(common):** Create and manage example responses in collections (#5652)
- **feat(common):** Add platform support for organization switcher (#5708)
- **feat(desktop):** URL focus and MRU tab shortcuts (#5683)
- **fix(common):** Resolve Postman API key authorization header import mapping (#5701)
- **fix(common):** Restore scrolling on settings and profile pages (#5695)
- **fix:** Improve keyboard shortcuts (#5601)
- **fix:** Resolve CodeMirror editor syntax highlighting issues
- **chore(common):** Czech, Chinese, and Korean translation improvements (#5672, #5699, #5660)

#### Upstream v2025.11.2

- **chore:** Add `sslmode` support to `PrismaService` database URL parser (#5671)
- **fix(common):** Remove double scrollbar in response pane (#5665)
- **fix(common):** Environment variables not detected in request body editors (#5616)
- **fix(common):** Increase modal dialog width for bigger screens (#5631)

#### Upstream v2025.11.1

- **feat(desktop):** Atomic write for registry persistence (#5658)
- **feat(common):** Adjust layout for created server info display in mock server (#5655)
- **feat:** Add auto-create collection option to mock server creation (#5637)
- **fix:** Add database URL parsing to `PrismaService` (#5656)
- **fix:** Remove `ref_id` field before collection exports and address race conditions (#5626)
- **fix:** Support dots/dashes in environment variable autocomplete (#5630)
- **fix:** Ensure correct parser for XML and plain text (#5597)
- **fix:** Prevent `clear response` action in response examples and test runner (#5641)
- **hotfix:** Clean up published docs with deleted collections (#5624)

#### Upstream v2025.11.0

- **feat:** Improve documentation UI and add published docs indicators (#5620)
- **feat(common):** Add erase response functionality with keybindings (#5435)
- **feat(scripting-revamp):** Add support for sending requests in scripting context (#5596)
- **feat(common):** Add better UX to profile page by enabling routing for each tab (#5544)
- **feat:** API Documentation (#5499)
- **feat:** Mock server feature enhancements (#5609)
- **feat(desktop):** Portable phase-3 — Instance manager (#5421)
- **feat:** Add platform-specific import support for personal collections (#5570)
- **fix:** Guard Tauri calls with kernel check (#5619)
- **fix:** Prevent duplicate requests from showing active indicator simultaneously (#5605)
- **fix:** Resolve collection variable referencing issues (#5584)
- **fix:** Filter undefined values in config and update build files (#5610)
- **fix:** API Documentation UI flow improvements (#5618)

#### Upstream v2025.10.1

- **fix(common):** Preserve team environment name during collection runs (#5578)
- **fix:** Team collection not loading on route change (#5533)
- **fix:** Capture environment before request run (#5560)
- **fix(desktop):** Token validation and cookie parsing (#5569)

#### Upstream v2025.10.0

- **feat:** Mock server (#5482)
- **feat(scripting-revamp):** Chai-powered assertions and Postman compatibility layer (#5417)
- **feat(relay):** Control redirect follow (#5508)
- **feat:** Add configurable session cookie name (#5425)
- **feat:** Add `$randomCompanyName` predefined variable (#5479)
- **feat:** Add auth refresh token flow if token expires (#5490)
- **feat(ci):** Agent workflow with platform jobs (#5514)
- **fix:** Preserve PKCE and client secret in Postman collection imports (#5480)
- **fix:** Avoid rapid polling while fetching teams in selector (#5485)
- **fix:** Ensure graceful shutdown when `stopApp` is called (#5494)
- **fix:** Reset `ONBOARDING_COMPLETED` to `false` during infra config reset (#5496)
- **fix(common):** Preserve file uploads in experimental scripting sandbox (#5512)
- **refactor:** Cleanup sync logic and imports (#5428)

#### Upstream v2025.9.2

- **fix:** Focus existing request tab instead of duplicating (#5452)
- **fix:** Prevent syncing secret variable initial values (#5434)
- **fix(js-sandbox):** Resolve errors with `pw.env` namespace in legacy sandbox (#5433)

#### Upstream v2025.9.1

- **fix:** Correctly resolve inherited properties before request runs (#5418)

#### Upstream v2025.9.0

- **feat(scripting-revamp):** Introduce `hopp` namespace (#5388)
- **feat:** Add alphabetical sort for user and team collections (#5383)
- **fix:** Highlight environment on string containing dot (#5409)
- **fix:** Accept single character length name and trim whitespace (#5412)
- **fix:** Race condition in active team collection tab inheritance (#5184)
- **fix:** Close modal on clicking overlay for non-input modals (#5403)
- **fix(native):** Bump `tauri-plugin-shell` to `v2.2.1` (#5402)
- **fix:** Correct indentation for nested endpoints in sidebar (#5370)
- **fix:** Handle actions for logged-in users on token expiration (#5249)
- **fix(desktop):** Window lifecycle for instance switch (#5381)
- **fix:** Prevent empty entries when dragging items past last row (#5384)
- **fix(relay):** Multiple `Set-Cookie` headers in response (#5394)

---

*Previous releases: see [GitHub Releases](https://github.com/hoppscotch/hoppscotch/releases)*
