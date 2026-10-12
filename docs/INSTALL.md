# Installing Folio

Pick whichever suits your machine. Every option gives you the same app, and your data is always one folder you can copy.

| You have | Use | Runs as |
|---|---|---|
| Windows 10 / 11 | [Windows installer](#windows) | Start-menu app, or a Windows service |
| Windows, no admin rights, or a USB stick | [Portable zip](#windows-portable) | Double-click to start |
| Debian, Ubuntu, Raspberry Pi OS | [.deb package](#debian-ubuntu-raspberry-pi-os) | systemd service |
| Any other Linux | [Tarball + install.sh](#other-linux) | systemd service |
| A server with Docker | [Docker](#docker) | Container |

Downloads are on the [releases page](https://github.com/tombrooksdev/Folio/releases). Each release lists a `SHA256SUMS` file so you can verify what you downloaded:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

No Node.js install is needed for the installers: each one bundles its own copy.

---

## Windows

1. Download **Folio-Setup-x.y.z.exe** and run it (it asks for administrator rights because it installs to *Program Files*).
2. Choose what you want:
   - **Start menu shortcuts** (recommended)
   - **Desktop shortcut**
   - **Run in the background and start with Windows**: installs Folio as a Windows service so it is always available, even before anyone signs in
   - **Let other computers on my network connect**: opens port 3000 in Windows Firewall. Leave it off for a personal, this-computer-only setup.
3. Finish, and Folio opens in your browser at <http://localhost:3000>. The first visit asks you to create the administrator account.

Windows SmartScreen may warn about an unrecognised publisher because the installer is not code-signed. Choose **More info, Run anyway** after checking the checksum above.

**Where things live**

| | |
|---|---|
| Program | `C:\Program Files\Folio` |
| Your data (database, attachments, settings) | `C:\ProgramData\Folio` |
| Settings | `C:\ProgramData\Folio\config.txt` |
| Service logs | `C:\ProgramData\Folio\logs` |

**Day to day:** open **Folio** from the Start menu. It starts the server quietly if it is not already running and opens your browser. **Stop Folio** is in the same folder. If you installed the service, there is nothing to start.

**Command line** (Command Prompt in `C:\Program Files\Folio`):

```
folio.cmd add-user alice     add another person
folio.cmd backup             back up the database and attachments
folio.cmd config             show where everything is
folio.cmd stop               stop the server
```

**Upgrade:** run the new installer over the old one. Your data and settings are kept.
**Uninstall:** *Settings, Apps*, or the Start menu entry. Your data in `C:\ProgramData\Folio` is kept; delete it yourself if you no longer need it.
**Silent install** (for IT): `Folio-Setup-x.y.z.exe /S` (add `/D=C:\Folio` to choose the folder).

### Windows portable

1. Download **folio-x.y.z-win-x64.zip** and unzip it anywhere.
2. Double-click **Start Folio.vbs**.

Data is stored in the `data` folder next to the program. Copy the whole folder to back up or move Folio. Settings: copy `config.example.txt` to `data\config.txt` and edit it.

---

## Debian, Ubuntu, Raspberry Pi OS

```bash
sudo apt install ./folio_x.y.z_amd64.deb     # use _arm64.deb on a Raspberry Pi or other ARM server
```

That's it. The package creates a `folio` system user, starts a systemd service and prints the address. Open <http://localhost:3000> to create the administrator account.

| | |
|---|---|
| Program | `/opt/folio` |
| Data | `/var/lib/folio` |
| Settings | `/etc/folio/folio.env` (edit, then `sudo systemctl restart folio`) |
| Logs | `journalctl -u folio -f` |

```bash
sudo folio add-user alice       # add another person
sudo folio backup               # back up the database and attachments
folio config                    # show where everything is
sudo systemctl status folio
```

**Upgrade:** install the newer `.deb`; settings and data are kept.
**Remove:** `sudo apt remove folio`. Your data in `/var/lib/folio` is never deleted automatically.

## Other Linux

```bash
tar xzf folio-x.y.z-linux-x64.tar.gz      # or linux-arm64
cd folio-x.y.z-linux-x64
sudo ./install.sh                          # installs to /opt/folio and starts the service
```

Same layout and commands as the `.deb`. To remove it: `sudo ./install.sh --uninstall` (data is kept).

**Just try it without installing:** run `./bin/folio start` from the unpacked folder. Data goes in `./data`.

## Docker

```bash
git clone https://github.com/tombrooksdev/Folio.git
cd Folio
docker compose up -d --build
```

Data is in `./data`. See the README for HTTPS and configuration.

---

## Configuration

| Setting | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `FOLIO_HOST` | `0.0.0.0` on Linux and Docker, `127.0.0.1` on Windows | `127.0.0.1` accepts connections from this computer only |
| `FOLIO_MAX_UPLOAD_MB` | `25` | Largest attachment |
| `FOLIO_GITHUB_TOKEN` | none | For private repos or a higher GitHub rate limit |
| `FOLIO_SECURE_COOKIES`, `FOLIO_TRUST_PROXY` | `0` | Set both to `1` behind an HTTPS reverse proxy |

Linux: `/etc/folio/folio.env`. Windows: `C:\ProgramData\Folio\config.txt` (installed) or `data\config.txt` (portable).

## Putting it on the internet

Folio speaks plain HTTP, so put a reverse proxy in front for HTTPS (Caddy is the easiest) and set `FOLIO_SECURE_COOKIES=1` and `FOLIO_TRUST_PROXY=1`. See the README for examples. Do not expose port 3000 directly.

## Backups

Everything is in the data folder. `folio backup` makes a consistent copy while Folio is running. To restore: stop Folio, put the database and `uploads` folder back, and start it again.

## Troubleshooting

- **"Port 3000 is already in use"**: set a different `PORT`.
- **Can't reach it from another computer**: set `FOLIO_HOST=0.0.0.0` and allow the port through your firewall.
- **Windows: nothing happens when I click Folio**: run `folio.cmd start` in a Command Prompt to see the error.
- **Linux: service won't start**: `journalctl -u folio -n 50`.

## Building the installers yourself

```bash
npm install
npm run package          # needs bash, curl, zip, dpkg-deb, fakeroot and NSIS (or Docker)
```

Output goes to `dist/`. Pushing a `v*` tag builds and publishes everything through GitHub Actions.
