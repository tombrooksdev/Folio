# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead:
**Security tab, "Report a vulnerability"** on this repository. If that is not available, contact the maintainer through [tombrooks.dev](https://tombrooks.dev).

Include what you found, how to reproduce it, and the version (shown at the bottom of the sidebar). You will get a reply within a few days, and a fix or a mitigation as quickly as possible.

## What Folio does to protect you

- Passwords are hashed with scrypt (async, so logins can't stall the server), must be 10+ characters, and common passwords are refused.
- Sessions are random 256-bit tokens stored only as hashes, expire after 30 days, are rotated at login, and can all be revoked from **Account**.
- Login attempts are limited per address and per username, and unknown usernames take as long as known ones.
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` (with the `__Host-` prefix) in production.
- Cross-site requests are refused (`Sec-Fetch-Site`, `Origin`).
- A strict Content Security Policy (no inline script or style, no remote images by default), plus `nosniff`, framing and permissions headers, and `Cache-Control: no-store` on signed-in pages.
- Markdown is sanitised: no scripts, no form fields except read-only task checkboxes, external links open with `noopener noreferrer nofollow`.
- Uploads are streamed to disk with size and storage limits, named randomly, checked against their extension, and only images and PDFs display inline.
- The database and attachments are created readable by the owner only.
- Three roles: administrators, members and read-only viewers.
- The GitHub integration is read-only and can only reach `/repos/...` on `api.github.com`.

## Running Folio safely

1. Put it behind an **HTTPS reverse proxy** and set `FOLIO_TRUST_PROXY=1` (only behind a proxy that overwrites `X-Forwarded-For`). Do not expose port 3000 directly.
2. On a new install, create your account straight away, or set `FOLIO_SETUP_TOKEN` (or `FOLIO_DISABLE_SETUP=1` and use `folio add-user`).
3. Give people the lowest role that works. Keep the number of administrators small.
4. Keep Folio updated and back up the data folder somewhere else.
