---
title: Updates and installing
minutes: 2
---
## Update

Run the newer installer or install the newer package over the old one. Your data and settings are kept, and the database is upgraded automatically the first time Folio starts.

| Install | Update |
|---|---|
| Windows | Run the new `Folio-Setup` |
| Debian, Ubuntu, Raspberry Pi | `sudo apt install ./folio_x.y.z_amd64.deb` |
| Other Linux | `sudo ./install.sh` from the new tarball |
| Docker | `git pull` then `docker compose up -d --build` |

## What changed?

Click the version number at the bottom of the sidebar to open **What's new**, which lists every release.

## Settings

Edit `/etc/folio/folio.env` on Linux or `C:\ProgramData\Folio\config.txt` on Windows, then restart Folio. Common ones: `PORT`, `FOLIO_HOST`, `FOLIO_MAX_UPLOAD_MB`, `FOLIO_GITHUB_TOKEN`, `FOLIO_WEBHOOK_URL`.

> [!TIP]
> Put Folio behind an HTTPS reverse proxy if anyone outside your network will use it.
