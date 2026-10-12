#!/bin/sh
# Install Folio from the release tarball:  sudo ./install.sh        (install or upgrade)
#                                          sudo ./install.sh --uninstall   (remove; data is kept)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
PREFIX=/opt/folio

[ "$(id -u)" = 0 ] || { echo "Please run as root: sudo $0 $*" >&2; exit 1; }

if [ "$1" = "--uninstall" ]; then
  if [ -d /run/systemd/system ]; then systemctl disable --now folio 2>/dev/null || true; fi
  rm -f /etc/systemd/system/folio.service /usr/local/bin/folio
  [ -d /run/systemd/system ] && systemctl daemon-reload || true
  rm -rf "$PREFIX"
  echo "Folio removed. Your data in /var/lib/folio and settings in /etc/folio were kept."
  exit 0
fi

echo "Installing Folio to $PREFIX ..."
if [ -d /run/systemd/system ]; then systemctl stop folio 2>/dev/null || true; fi
rm -rf "$PREFIX"
mkdir -p "$PREFIX"
cp -a "$HERE/app" "$HERE/runtime" "$HERE/bin" "$PREFIX/"
chmod 755 "$PREFIX/bin/folio"
ln -sf "$PREFIX/bin/folio" /usr/local/bin/folio

id folio >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/folio --no-create-home --shell /usr/sbin/nologin folio
mkdir -p /var/lib/folio /etc/folio
chown -R folio:folio /var/lib/folio
[ -f /etc/folio/folio.env ] || cp "$HERE/folio.env" /etc/folio/folio.env   # never overwrite your settings

if [ -d /run/systemd/system ]; then
  cp "$HERE/folio.service" /etc/systemd/system/folio.service
  systemctl daemon-reload
  systemctl enable --now folio
  echo
  echo "Folio is running: http://localhost:$(. /etc/folio/folio.env 2>/dev/null; echo "${PORT:-3000}")"
  echo "Open it in a browser to create your admin account."
  echo "Status: systemctl status folio     Settings: /etc/folio/folio.env"
else
  echo
  echo "systemd was not detected. Start Folio with:  folio start"
fi
