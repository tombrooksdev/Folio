# Folio security fixes

Instructions for an AI coding agent. Source: `SECURITY-AUDIT.html` (audit of Folio v0.5.0, 2026-10-12).
Read this whole file, then fix every item below **in order**.

## Ground rules

- Work in `/home/tom/Documents/CodeProjects/Folio`. Node ≥ 22.5, ESM, Express 4, `node:sqlite`. Match the existing code style (terse, template-literal HTML, `esc()` on every interpolation).
- The working tree already has uncommitted changes (`git status`); do **not** revert or reformat them. Do not commit unless asked.
- Do not add new runtime dependencies unless an item says so. Prefer `node:crypto`, `node:fs`.
- Keep behaviour for valid input unchanged. Existing databases must keep working (use the `addColumn` migration pattern in `src/db.js`).
- Add or update tests in `test/app.test.js` for each item (each item lists a test). Run `npm test` after each group of fixes and fix regressions before moving on.
- Update `README.md` (Security / configuration sections) and `CHANGELOG.md` for user-visible changes (new env vars, roles, new defaults).
- After all items: run `npm test`, `npm audit --omit=dev`, and re-run the probes in "Verification" below.

## Severity summary

| ID | Severity | Title |
|----|----------|-------|
| F01 | Medium | GitHub integration allows path traversal on api.github.com (uses the server token) |
| F02 | Medium | Insecure defaults: cookies not `Secure`, plain HTTP published on all interfaces |
| F03 | Medium | Stack traces and file paths leak to clients; malformed input causes 500s |
| F04 | Medium | Login: username enumeration by timing, and a weak brute-force limiter |
| F05 | Medium | First-run `/setup` can be claimed by anyone who reaches the instance first |
| F06 | Medium | No authorization model: every user can modify or delete everything |
| F07 | Medium | User-authored content can embed password inputs and remote images |
| F08 | Low | Missing hardening headers and cache controls |
| F09 | Low | Database and uploads are created world-readable |
| F10 | Low | Upload and rendering resource limits |
| F11 | Low | Session lifecycle gaps |
| F12 | Low | SQL built by string concatenation in issue search |
| F13 | Low | CSRF defence is partial |
| F14 | Low | Async route handlers can crash the process (Express 4) |
| F15 | Info | Supply-chain hygiene |
| F16 | Info | Account and credential hygiene |

Suggested order: **F03 → F01 → F07 → F04 → F05 → F02 → F08 → F09 → F06 → F11 → F12 → F13 → F14 → F10 → F16 → F15** (F03's error handler and string helper are reused by the others; F06 is the largest change, so do it after the small ones).

## Fixes

### F01 · Medium · GitHub integration allows path traversal on api.github.com (uses the server token)

- **Where:** `src/github.js:5, 12, 28-31`
- **Problem:** The repo validator `^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$` accepts `.` and `..` as segments. Linking a space to `../user` makes the server request `https://api.github.com/repos/../user/commits`, which URL-normalises to `https://api.github.com/user/commits`. Any signed-in user can therefore make Folio send authenticated GETs (with `FOLIO_GITHUB_TOKEN`) to arbitrary api.github.com paths, and some response fields are rendered back to them.
- **Evidence:** Confirmed: `createGithub().valid("../user")` and `valid("../..")` both return true; `new URL("/repos/../user/commits", "https://api.github.com")` resolves to `/user/commits`; `../..` resolves to the API root.
- **Impact:** Limited to GET on the GitHub API host, but it can read anything the token can reach and bypasses the "repo only" intent. The host is fixed, so this is not full SSRF.

**Do this:**

1. In `REPO`/`valid()`, reject any segment that is `.` or `..` or starts with `.` (GitHub owner names cannot start with `.`; use `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$` for owner and `^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$` for repo).
2. In `get(path)`, build the URL with `new URL()` and assert `url.origin === "https://api.github.com"` and `url.pathname.startsWith("/repos/")` before fetching.
3. Re-validate `space.github_repo` when reading it from the DB (existing rows may already hold bad values) and in `/i/:id/dev`.

**Test:** Add a test: `POST /s/ENG/code/link` with `repo=../user` returns 400, and `valid("..")`, `valid("a/..")`, `valid("../a")` are false.

### F02 · Medium · Insecure defaults: cookies not `Secure`, plain HTTP published on all interfaces

- **Where:** `src/app.js:62-63, src/server.js:8, docker-compose.yml:6-9, Dockerfile`
- **Problem:** `secureCookies` defaults to false, `docker-compose.yml` publishes `3000:3000` on every interface and sets `FOLIO_SECURE_COOKIES: "0"`. A default deployment sends passwords and the session cookie in clear text and is reachable directly from the network, not only via a TLS proxy. There is also no HSTS.
- **Evidence:** Observed `Set-Cookie: folio_sid=...; HttpOnly; SameSite=Lax` with no `Secure` flag in a default instance.
- **Impact:** Credential and session theft on any shared or hostile network if the operator forgets the two env vars.

**Do this:**

1. docker-compose.yml: bind to loopback by default, `ports: ["127.0.0.1:3000:3000"]`, with a comment explaining how to front it with a TLS proxy.
2. Make secure cookies the default when `NODE_ENV=production`, and print a startup warning when `FOLIO_SECURE_COOKIES` is not `1` and `NODE_ENV=production`.
3. Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` when `secureCookies` is on.
4. Rename the cookie to `__Host-folio_sid` when `secure` is on (requires `Path=/`, no `Domain`), which is already how it is set.
5. Dockerfile: add `ENV NODE_ENV=production` (also fixes F03).

**Test:** Start the app with `secureCookies: true` and assert the `Set-Cookie` header contains `Secure` and the response has `Strict-Transport-Security`.

### F03 · Medium · Stack traces and file paths leak to clients; malformed input causes 500s

- **Where:** `src/app.js:44 and every `(req.body.x ?? '').trim()` call (app.js, board.js, comments.js, epics.js, github.js); no error handler registered`
- **Problem:** There is no Express error handler and `NODE_ENV` is not set, so Express returns the full stack trace (absolute server paths, line numbers) in the response body. Two easy triggers: a repeated form field (`name=A&name=B`) makes `req.body.name` an array so `.trim()` throws, and a request with `Origin: null` (sent by sandboxed iframes and some privacy modes) makes `new URL(origin)` throw.
- **Evidence:** Confirmed: `POST /spaces` with `name=A&name=B&key=ENG` and `POST /spaces` with `Origin: null` both returned HTTP 500 with a body containing `TypeError ... at file:///home/tom/.../src/app.js:143:40`.
- **Impact:** Information disclosure (server paths, versions) and an easy way for any logged-in user (or a cross-origin request with a null Origin) to generate errors. Does not crash the process.

**Do this:**

1. Add a final error middleware in `createApp`: log the error server-side, respond with a generic `500 Something went wrong` (HTML for browsers, JSON for `Accept: application/json` / `X-Requested-With: fetch`). Never send `err.stack`.
2. Add a small helper `str(v, max)` = `typeof v === "string" ? v.trim().slice(0, max) : ""` and use it everywhere request fields are read instead of `(x ?? "").trim()`. Add sane max lengths (title 200, body 1 MB, comment 20 000, name 60).
3. Origin check: wrap in try/catch; treat an unparseable or `"null"` Origin on a state-changing request as blocked (403) rather than throwing.
4. Set `ENV NODE_ENV=production` in the Dockerfile and compose file.

**Test:** Assert `POST /spaces` with duplicate `name` fields returns 400/500 with a body that does not contain `at file:` or `node_modules`, and that `Origin: null` returns 403.

### F04 · Medium · Login: username enumeration by timing, and a weak brute-force limiter

- **Where:** `src/app.js:84-95, src/auth.js:6-17, 44-54`
- **Problem:** (a) When the username does not exist, `verifyPassword` (scrypt) is skipped, so unknown users respond ~30x faster. (b) The limiter is keyed on `req.ip`: behind a proxy without `FOLIO_TRUST_PROXY=1` all users share one bucket (one attacker locks everyone out); with it enabled on a directly exposed port, `X-Forwarded-For` can be spoofed to dodge the limit. (c) Limits are per IP only, never per username; a successful login does not reset the counter; the `attempts` Map is never pruned (slow memory growth). (d) `scryptSync` blocks the event loop for every attempt, so a handful of parallel logins can stall the whole server.
- **Evidence:** Confirmed: average response for 4 wrong-password attempts was 32.2 ms for an existing user vs 1.1 ms for a non-existent one.
- **Impact:** Attackers can list valid usernames, then brute-force with distributed IPs; targeted lock-out or CPU-based DoS is possible.

**Do this:**

1. Always run a scrypt comparison: when the user is missing, verify against a precomputed dummy hash so timing matches.
2. Switch to async `crypto.scrypt` (promisified) for hashing and verification so the event loop is not blocked.
3. Rate-limit per (IP) AND per (lower-cased username); reset the counter on success; prune stale entries (e.g. on each call or with an unref'd interval).
4. Return the same generic message and same status for unknown user and wrong password (already done) and add a short constant delay on failure.
5. Document that `FOLIO_TRUST_PROXY=1` must only be used behind a proxy that overwrites `X-Forwarded-For`.
6. Cap password length (e.g. 1 024 chars) before hashing.

**Test:** Unit-test the limiter (per-user + per-IP, reset on success, pruning) and assert the unknown-user path calls the hash function.

### F05 · Medium · First-run `/setup` can be claimed by anyone who reaches the instance first

- **Where:** `src/app.js:66-79`
- **Problem:** While the users table is empty, `/setup` is open to the network and the first caller becomes administrator. If an instance is deployed on a public address and not set up immediately, an attacker can claim it. The check-then-insert is also not atomic (two simultaneous requests can both create a user).
- **Evidence:** Code review.
- **Impact:** Full takeover of a fresh deployment.

**Do this:**

1. Support `FOLIO_SETUP_TOKEN`: if set, `/setup` requires it (a form field) and refuses otherwise. If unset, log a prominent one-time warning at startup that setup is open.
2. Alternatively allow creating the first user only via `npm run add-user` and disable `/setup` when `FOLIO_DISABLE_SETUP=1`.
3. Make the insert atomic: `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM users)` and check `changes === 1`.

**Test:** With `FOLIO_SETUP_TOKEN` set, `POST /setup` without or with a wrong token returns 403 and creates no user.

### F06 · Medium · No authorization model: every user can modify or delete everything

- **Where:** `src/app.js (all routes), src/files.js:89-95, src/board.js, src/epics.js; README line ~182 documents it`
- **Problem:** There are no roles or per-space permissions. Any account can delete any page (and its children), issue, epic, sprint, or attachment, restore versions, change any assignee, and link/unlink GitHub repos. Only page-comment deletion checks ownership (`comments.js:43`). There is also no admin-only user management and no audit log of deletions. This is documented ("All users currently have equal access"), but it is the single biggest risk once more than a few trusted people use the instance.
- **Evidence:** Code review: no role column on `users`, no permission checks beyond "logged in".
- **Impact:** A single compromised or careless account can destroy all data. Page deletes are hard deletes with no recycle bin.

**Do this:**

1. Add `role` to `users` (`admin` | `member` | `viewer`) via the existing `addColumn` migration; first user becomes `admin`.
2. Add an `requireRole()` middleware: viewers can only GET; destructive routes (`/p/:id/delete`, `/i/:id/delete`, `/e/:id/delete`, `/attachments/:id/delete`, `/s/:key/code/unlink|link`, `/spaces`) require `member`, and space-level/GitHub-link/user admin routes require `admin`.
3. Restrict attachment and comment deletion to the uploader/author or an admin.
4. Optional but recommended: soft-delete pages (a `deleted_at` column) so a mistaken delete is recoverable.
5. Update README to describe the roles.

**Test:** A `viewer` receives 403 on every POST route; a `member` cannot delete another user's attachment; an `admin` can.

### F07 · Medium · User-authored content can embed password inputs and remote images

- **Where:** `src/render.js:6-18, src/app.js:37 (CSP `img-src`)`
- **Problem:** The sanitizer allows `<input>` with a free `type`, so a page, comment or issue can contain a fake `<input type="password" placeholder="Password">` (UI redress / in-app phishing). `<img>` allows any `http(s)` and protocol-relative (`//host`) source, and the CSP permits `img-src https:`, so an author can embed a tracking pixel that reveals every viewer's IP, user agent and view time to a third party. Links get no `rel` hardening.
- **Evidence:** Confirmed: rendering `<input type="password" placeholder="Password"> <img src="//evil.example/x.png"> <img src="https://evil.example/p.gif">` produced exactly those elements in the page. `javascript:` links and `<svg onload>` were correctly stripped.
- **Impact:** Phishing inside a trusted origin and viewer tracking by any account holder. Not script execution.

**Do this:**

1. Restrict inputs to task-list checkboxes: add `allowedAttributes.input = ["type","checked","disabled"]` plus `exclusiveFilter`/`transformTags` that drops any `input` whose `type !== "checkbox"` and forces `disabled`.
2. Set `allowProtocolRelative: false` in the sanitizer options.
3. Either (a) remove `https:` from the CSP `img-src` (keep `'self' data:`) so only uploaded images render, or (b) add `FOLIO_ALLOW_REMOTE_IMAGES=1` to opt in. Keep GitHub avatars out of scope (none are used).
4. Add `transformTags` for `a` to set `rel="noopener noreferrer nofollow"` and `target="_blank"` on external links.

**Test:** Render markdown with `<input type=password>` and `<img src=//x/y.png>`; assert the password input and the remote image are removed.

### F08 · Low · Missing hardening headers and cache controls

- **Where:** `src/app.js:35-40`
- **Problem:** The CSP omits `base-uri`, `form-action`, `object-src` and `font-src`. No `Strict-Transport-Security`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` or `Cache-Control: no-store` on authenticated HTML, so pages can be served from the browser cache after logout (back button / shared computer). Static assets are served before the header middleware and do not get these headers.
- **Evidence:** Observed headers on `GET /`: only `content-security-policy` and `referrer-policy` (no cache-control).
- **Impact:** Defence in depth; a base-tag or form-action injection would not be blocked, and sensitive pages can be recovered from cache.

**Do this:**

1. CSP: `default-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'`.
2. Add `Cache-Control: no-store` to all authenticated HTML responses (not to `/files/*` or static assets), `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY`.
3. Move the header middleware above `express.static` so static files get `nosniff` too.

**Test:** Assert the headers on `GET /` after login.

### F09 · Low · Database and uploads are created world-readable

- **Where:** `src/db.js:5-8, src/files.js:24, 70`
- **Problem:** `data/folio.db` is created `0644` and `data/uploads` `0755`. On a multi-user host any local account can read password hashes, session-token hashes, every page and every attachment.
- **Evidence:** Confirmed: `stat` shows `644 data/folio.db` and `755 data/uploads`.
- **Impact:** Local information disclosure on shared servers.

**Do this:**

1. Create the data directory with `mkdirSync(dir, { recursive: true, mode: 0o700 })`, call `chmodSync(file, 0o600)` after opening the DB (and the `-wal`/`-shm` files), create the uploads directory with `0o700`, and write uploads with `{ mode: 0o600 }`.
2. Backup script: write the backup file and `.uploads` copy with the same restrictive modes.
3. In Docker, document that the `./data` volume should be owned by uid 1000 (`node`).

**Test:** After `openDb(tmpfile)`, `statSync(file).mode & 0o077 === 0`.

### F10 · Low · Upload and rendering resource limits

- **Where:** `src/files.js:59-75, src/app.js:33, 340, src/diff.js:6-9`
- **Problem:** There is no per-user or total upload quota; every file up to 25 MB is buffered fully in memory (`express.raw`) and written synchronously (`writeFileSync`), so a few parallel uploads can use hundreds of MB and block the event loop. Uploads that are never attached to a page/issue (e.g. abandoned drafts) are never cleaned up. Stored content is not checked against its claimed extension. `/preview` will render a 2 MB Markdown body on demand, and the diff allocates up to ~4M-entry `Uint32Array` tables per request.
- **Evidence:** Code review.
- **Impact:** Authenticated disk/memory/CPU exhaustion.

**Do this:**

1. Stream uploads to disk (`pipeline(req, createWriteStream(...))`) with a byte counter instead of `express.raw`, and use async fs APIs.
2. Add a total-storage cap (`FOLIO_MAX_STORAGE_MB`) and a per-user rate limit on `POST /attachments`, `/preview` and `/search.json`.
3. Purge orphaned attachments (no page/issue, older than 24 h) on startup and daily.
4. Sniff the first bytes for images (PNG/JPEG/GIF/WebP signatures) and reject mismatches before serving inline.
5. Lower the urlencoded body limit for non-editor routes (e.g. 100 KB) and keep 2 MB only for page/issue bodies.

**Test:** Uploading a file with a `.png` extension but HTML content is rejected or served as `application/octet-stream` attachment.

### F11 · Low · Session lifecycle gaps

- **Where:** `src/auth.js:21-42, src/app.js:96-100`
- **Problem:** Expired sessions are never deleted (table grows forever). There is no way to change a password or revoke other sessions, and the CLI cannot do either, so a stolen cookie is valid for 30 days. Logout is a state-changing POST but does not get special protection (logout CSRF, minor). Sessions are not rotated at login.
- **Evidence:** Code review.
- **Impact:** Longer exposure window after a cookie or password leak.

**Do this:**

1. Delete expired sessions on startup and hourly (`DELETE FROM sessions WHERE expires_at < ?`).
2. Add `/account` with change-password (requires current password, destroys all other sessions) and a "sign out everywhere" button; add `npm run reset-password -- <user>` that also deletes that user's sessions.
3. On login, delete any session for the same browser token before issuing a new one.

**Test:** Changing a password invalidates a previously issued session token.

### F12 · Low · SQL built by string concatenation in issue search

- **Where:** `src/board.js:133`
- **Problem:** The text filter builds `('KEY-' || i.num)` by interpolating `space.key` into the SQL. It is safe today only because keys are restricted to `[A-Z0-9-]` at creation (`app.js:145`) and the code strips quotes; a future change to key rules or an imported database would make it injectable.
- **Evidence:** Code review. No exploit possible with current validation.
- **Impact:** Latent SQL injection.

**Do this:**

1. Replace the interpolation with a bound parameter: add `? || '-' || i.num` and push `space.key` into `args` in the right position.
2. Add a `CHECK (key GLOB '[A-Z0-9-]*')` constraint or validate keys when reading them.

**Test:** Search for `a%` and `x' OR 1=1 --` returns normal results and no SQL error.

### F13 · Low · CSRF defence is partial

- **Where:** `src/app.js:41-45`
- **Problem:** Cross-site POSTs are blocked by `SameSite=Lax` and by an Origin check, but the Origin check is skipped when the header is absent, compares against the attacker-influenceable `Host` header, and crashes on `Origin: null` (F03). Older browsers and some privacy tools omit or alter Origin/SameSite behaviour.
- **Evidence:** Code review plus the `Origin: null` 500.
- **Impact:** Defence in depth only; no working bypass was found in modern browsers.

**Do this:**

1. Prefer `Sec-Fetch-Site`: for non-GET requests reject unless it is `same-origin` (or absent AND Origin matches).
2. Compare Origin against a configured `FOLIO_PUBLIC_URL` when set, falling back to Host.
3. Optionally add a per-session CSRF token (hidden input + `X-CSRF-Token` header for fetch calls).

**Test:** POST with `Sec-Fetch-Site: cross-site` returns 403.

### F14 · Low · Async route handlers can crash the process (Express 4)

- **Where:** `src/github.js:56-94, 112-128`
- **Problem:** Express 4 does not catch rejections from `async` handlers. In `/s/:key/code` the `catch` block calls `done()` again, which can throw a second time (for example if rendering fails), producing an unhandled rejection that terminates Node 22. Not reproduced in practice, but the pattern is fragile.
- **Evidence:** Code review only.
- **Impact:** Possible remote-triggered crash if GitHub returns unexpected data.

**Do this:**

1. Wrap async handlers: `const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)` and register the global error handler from F03.
2. Or upgrade to Express 5, which forwards async errors automatically (see F15).
3. Add `process.on("unhandledRejection", log)` as a last-resort logger.

**Test:** Stub `github.commits` to return `null`; the route responds 502/500 and the server keeps running.

### F15 · Info · Supply-chain hygiene

- **Where:** `package.json, Dockerfile, .github/workflows/ci.yml`
- **Problem:** `npm audit` is clean, but `express` is on 4.x (5.3.0 current) and `marked` on 14.x (18.1.0 current). The base image `node:22-alpine` and GitHub Actions are pinned by tag, not digest/SHA. The workflow has no `permissions:` block (defaults to broad token scope) and there is no Dependabot/Renovate config.
- **Evidence:** `npm outdated` and file review.
- **Impact:** Slower uptake of upstream security fixes; a compromised tag could alter builds.

**Do this:**

1. Add `permissions: { contents: read }` to ci.yml and pin `actions/checkout`, `actions/setup-node` to commit SHAs.
2. Add `.github/dependabot.yml` for npm, docker and github-actions (weekly).
3. Pin the Docker base image by digest and add `npm audit --omit=dev --audit-level=high` to CI.
4. Plan the Express 5 and newer `marked` upgrades; re-run the test suite and re-check the sanitiser (F07) afterwards.

**Test:** CI fails on `npm audit --audit-level=high`.

### F16 · Info · Account and credential hygiene

- **Where:** `src/app.js:70-79, scripts/add-user.js`
- **Problem:** Minimum password length is 8 with no maximum or breached-password check. Usernames are case-sensitive and not normalised, so `Admin` and `admin` can coexist (look-alike accounts) and any characters/length are accepted. `add-user` accepts the password via the `FOLIO_PASSWORD` env var, which may end up in shell history or process listings.
- **Evidence:** Code review.
- **Impact:** Weak passwords and impersonation by look-alike usernames.

**Do this:**

1. Enforce 10+ characters (max 1 024), reject the top few hundred common passwords.
2. Normalise usernames: trim, restrict to `[A-Za-z0-9._-]{2,32}`, and make uniqueness case-insensitive (`COLLATE NOCASE` unique index).
3. Prefer the prompt in `add-user.js`; warn when `FOLIO_PASSWORD` is used.

**Test:** Creating `Admin` when `admin` exists fails.

## New environment variables introduced by these fixes

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | `production` in Docker | Disables Express stack traces; enables secure-cookie default |
| `FOLIO_SETUP_TOKEN` | *(none)* | Required on `/setup` when set (F05) |
| `FOLIO_DISABLE_SETUP` | `0` | Disable the web setup page; use `npm run add-user` (F05) |
| `FOLIO_PUBLIC_URL` | *(none)* | Canonical origin for CSRF checks (F13) |
| `FOLIO_ALLOW_REMOTE_IMAGES` | `0` | Allow `https:` images in content and CSP (F07) |
| `FOLIO_MAX_STORAGE_MB` | `2048` | Total attachment storage cap (F10) |

## Verification (run after the fixes)

```bash
npm test
npm audit --omit=dev
# Each of these should now be rejected or sanitised, with no stack trace in the response body:
#  - POST /spaces with duplicate fields:   name=A&name=B&key=ENG        -> 400, no "at file:" in body
#  - POST /spaces with header "Origin: null"                             -> 403
#  - POST /s/ENG/code/link with repo=../user                            -> 400
#  - markdown "<input type=password>" and "<img src=//x/y.png>"        -> both removed from rendered HTML
#  - login timing: unknown vs known user within ~20% of each other
#  - stat -c %a data/folio.db data/uploads                              -> 600 / 700
#  - Set-Cookie includes Secure + HSTS header when secure cookies are on
```

Report back: for each ID, one line saying **fixed / partly fixed / skipped (why)**, plus the `npm test` result.
