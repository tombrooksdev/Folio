#!/usr/bin/env bash
# Build Folio installers and packages into ./dist
#
#   packaging/build.sh                      all targets
#   TARGETS="linux-x64" packaging/build.sh  just one
#   SKIP_INSTALLER=1 packaging/build.sh     skip the Windows .exe (needs NSIS or Docker)
#
# Produces, for the version in package.json:
#   folio_<v>_amd64.deb / _arm64.deb         Debian, Ubuntu, Raspberry Pi OS (systemd service)
#   folio-<v>-linux-x64.tar.gz / -arm64      any Linux (includes install.sh)
#   folio-<v>-win-x64.zip                    portable Windows
#   Folio-Setup-<v>.exe                      Windows installer
#   SHA256SUMS
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
VERSION=$(node -p "require('./package.json').version")
NODE_VERSION=$(tr -d '[:space:]' < packaging/node-version)
TARGETS=${TARGETS:-"linux-x64 linux-arm64 win-x64"}
CACHE=$ROOT/packaging/.cache
STAGE=$ROOT/packaging/.stage
DIST=$ROOT/dist
WINSW_URL=https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
rm -rf "$STAGE" "$DIST"; mkdir -p "$CACHE" "$STAGE" "$DIST"

# ---- the application, once (all dependencies are pure JavaScript, so it is identical on every platform)
say "Staging Folio $VERSION"
APP=$STAGE/app
mkdir -p "$APP"
cp -r src public scripts package.json package-lock.json CHANGELOG.md LICENSE THIRD-PARTY-NOTICES.md README.md "$APP/"
(cd "$APP" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)

# ---- download and verify a Node.js runtime
fetch_node() { # $1 = linux-x64 | linux-arm64 | win-x64
  local ext=tar.xz; [[ $1 == win-* ]] && ext=zip
  local file=node-v$NODE_VERSION-$1.$ext
  if [ ! -f "$CACHE/$file" ]; then
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$file" -o "$CACHE/$file"
  fi
  [ -f "$CACHE/SHASUMS256-$NODE_VERSION.txt" ] || curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$CACHE/SHASUMS256-$NODE_VERSION.txt"
  local want; want=$(grep " $file\$" "$CACHE/SHASUMS256-$NODE_VERSION.txt" | cut -d' ' -f1)
  local got; got=$(sha256sum "$CACHE/$file" | cut -d' ' -f1)
  [ -n "$want" ] && [ "$want" = "$got" ] || { echo "Checksum mismatch for $file" >&2; exit 1; }
  rm -rf "$CACHE/x-$1"; mkdir -p "$CACHE/x-$1"
  if [ "$ext" = zip ]; then unzip -q "$CACHE/$file" -d "$CACHE/x-$1"; else tar -xJf "$CACHE/$file" -C "$CACHE/x-$1"; fi
}

linux_tree() { # $1 = target, $2 = destination directory (becomes the install root)
  fetch_node "$1"
  mkdir -p "$2/runtime/bin" "$2/bin"
  cp "$CACHE/x-$1"/node-v*/bin/node "$2/runtime/bin/node"
  cp "$CACHE/x-$1"/node-v*/LICENSE "$2/runtime/NODE-LICENSE.txt"
  cp -r "$APP" "$2/app"
  cp packaging/linux/folio "$2/bin/folio"
  chmod 755 "$2/bin/folio" "$2/runtime/bin/node"
}

build_linux() {
  local target=$1 arch; [[ $target == *arm64 ]] && arch=arm64 || arch=amd64
  say "Linux $target"

  # tarball
  local tar=$STAGE/folio-$VERSION-$target
  linux_tree "$target" "$tar"
  cp packaging/linux/{install.sh,folio.service,folio.env} "$tar/"
  cp LICENSE README.md "$tar/"
  tar -C "$STAGE" -czf "$DIST/folio-$VERSION-$target.tar.gz" "folio-$VERSION-$target"

  # .deb
  local deb=$STAGE/deb-$arch
  mkdir -p "$deb/DEBIAN" "$deb/opt" "$deb/etc/folio" "$deb/lib/systemd/system" "$deb/usr/share/doc/folio"
  linux_tree "$target" "$deb/opt/folio"
  cp packaging/linux/folio.env "$deb/etc/folio/folio.env"
  cp packaging/linux/folio.service "$deb/lib/systemd/system/folio.service"
  cp README.md CHANGELOG.md "$deb/usr/share/doc/folio/"
  cat > "$deb/usr/share/doc/folio/copyright" <<COPY
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: Folio
Source: https://github.com/tombrooksdev/Folio

Files: *
Copyright: 2026 Tom Brooks (tombrooks.dev)
License: MIT
 See /opt/folio/app/LICENSE for the full licence text.
COPY
  cp packaging/linux/deb/{postinst,prerm,postrm} "$deb/DEBIAN/"
  echo /etc/folio/folio.env > "$deb/DEBIAN/conffiles"
  local size; size=$(du -sk "$deb" | cut -f1)
  cat > "$deb/DEBIAN/control" <<CONTROL
Package: folio
Version: $VERSION
Section: web
Priority: optional
Architecture: $arch
Installed-Size: $size
Depends: adduser
Maintainer: tombrooks.dev <165925533+tombrooksdev@users.noreply.github.com>
Homepage: https://github.com/tombrooksdev/Folio
Description: Self-hosted wiki and Scrum board
 Folio combines Confluence-style spaces and pages with a Jira-style backlog,
 sprints and board. One small service, one SQLite database, no subscription.
 .
 This package bundles its own Node.js runtime and runs as a systemd service
 on port 3000. Data is kept in /var/lib/folio.
CONTROL
  find "$deb" -type d -exec chmod 755 {} +
  find "$deb/opt" "$deb/etc" "$deb/usr" "$deb/lib" -type f ! -perm -u+x -exec chmod 644 {} +
  chmod 755 "$deb/DEBIAN/postinst" "$deb/DEBIAN/prerm" "$deb/DEBIAN/postrm"
  fakeroot dpkg-deb -Zxz --build "$deb" "$DIST/folio_${VERSION}_${arch}.deb" >/dev/null
}

build_windows() {
  say "Windows x64"
  fetch_node win-x64
  local files=("Start Folio.vbs" folio.cmd)

  # portable zip
  local z=$STAGE/Folio
  mkdir -p "$z/runtime"
  cp "$CACHE"/x-win-x64/node-v*/node.exe "$z/runtime/node.exe"
  cp "$CACHE"/x-win-x64/node-v*/LICENSE "$z/runtime/NODE-LICENSE.txt"
  cp -r "$APP" "$z/app"
  for f in "${files[@]}"; do cp "packaging/windows/$f" "$z/"; done
  cp packaging/windows/README-WINDOWS.txt "$z/"
  cp packaging/windows/config.txt "$z/config.example.txt"
  : > "$z/portable.txt"
  # Windows tools expect CRLF in scripts
  for f in "$z/folio.cmd" "$z/Start Folio.vbs" "$z/README-WINDOWS.txt" "$z/config.example.txt"; do sed -i 's/\r$//; s/$/\r/' "$f"; done
  (cd "$STAGE" && zip -qr "$DIST/folio-$VERSION-win-x64.zip" Folio)

  [ -n "${SKIP_INSTALLER:-}" ] && { echo "Skipping the Windows installer (SKIP_INSTALLER set)"; return; }

  # installer
  local w=$STAGE/win-installer
  mkdir -p "$w/runtime" "$w/service"
  cp "$CACHE"/x-win-x64/node-v*/node.exe "$w/runtime/node.exe"
  cp "$CACHE"/x-win-x64/node-v*/LICENSE "$w/runtime/NODE-LICENSE.txt"
  cp -r "$APP" "$w/app"
  for f in "${files[@]}"; do cp "packaging/windows/$f" "$w/"; done
  cp packaging/windows/config.txt "$w/config.txt"
  cp packaging/windows/folio-service.xml "$w/service/folio-service.xml"
  for f in "$w/folio.cmd" "$w/Start Folio.vbs" "$w/config.txt" "$w/service/folio-service.xml"; do sed -i 's/\r$//; s/$/\r/' "$f"; done
  [ -f "$CACHE/WinSW.NET461.exe" ] || curl -fsSL "$WINSW_URL" -o "$CACHE/WinSW.NET461.exe"
  (cd "$CACHE" && sha256sum -c "$ROOT/packaging/winsw.sha256" >/dev/null) || { echo "WinSW checksum mismatch" >&2; exit 1; }
  cp "$CACHE/WinSW.NET461.exe" "$w/service/folio-service.exe"
  local out=Folio-Setup-$VERSION.exe
  if command -v makensis >/dev/null; then
    makensis -V2 -DVERSION="$VERSION" -DSTAGE="$w" -DOUTFILE="$DIST/$out" packaging/windows/folio.nsi
  elif command -v docker >/dev/null; then
    docker run --rm -v "$ROOT":/w -w /w debian:12-slim sh -c \
      "apt-get update -qq >/dev/null && apt-get install -y -qq nsis >/dev/null && makensis -V2 -DVERSION=$VERSION -DSTAGE=/w/packaging/.stage/win-installer -DOUTFILE=/w/dist/$out packaging/windows/folio.nsi"
  else
    echo "Neither makensis nor docker is available: skipping the Windows installer." >&2
    return
  fi
}

for t in $TARGETS; do
  case $t in
    linux-x64|linux-arm64) build_linux "$t" ;;
    win-x64) build_windows ;;
    *) echo "Unknown target $t" >&2; exit 1 ;;
  esac
done

say "Checksums"
(cd "$DIST" && sha256sum * > SHA256SUMS && cat SHA256SUMS)
