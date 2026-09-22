#!/usr/bin/env bash
# Install the real-client-IP logging + Cloudflare origin lock on the VPS.
# Backs up first, tests before reloading, and rolls back if the config is bad.
set -uo pipefail

REPO=/opt/tradekaro
TS=$(date -u +%Y%m%d-%H%M%S)
BK="/root/nginx-backup-$TS"

echo "==> backing up the live nginx config to $BK"
mkdir -p "$BK"
cp -a /etc/nginx/sites-available/tradekaro "$BK/tradekaro.site"
cp -a /etc/nginx/snippets/tradekaro-locations.conf "$BK/tradekaro-locations.conf"
ls -1 "$BK"

echo
echo "==> generating the Cloudflare allow-list"
if ! bash "$REPO/deploy/refresh-cloudflare-ips.sh"; then
  echo "refresh failed — nothing installed, site untouched" >&2
  exit 1
fi
echo "--- first and last lines of the generated snippet ---"
head -12 /etc/nginx/snippets/cloudflare-only.conf | tail -4
tail -2 /etc/nginx/snippets/cloudflare-only.conf

echo
echo "==> installing the site config and locations snippet"
sed 's/YOUR_DOMAIN/tradestox.pro/g' "$REPO/deploy/nginx-tradekaro.conf" \
  > /etc/nginx/sites-available/tradekaro
install -m 644 "$REPO/deploy/nginx-tradekaro-locations.conf" \
  /etc/nginx/snippets/tradekaro-locations.conf
echo "installed"
grep -n 'cloudflare-only' /etc/nginx/snippets/tradekaro-locations.conf | head
grep -n 'tk_combined\|tk_client_ip' /etc/nginx/sites-available/tradekaro | head

echo
echo "==> nginx -t"
if ! nginx -t 2>&1; then
  echo
  echo "!!! nginx -t FAILED — rolling back"
  cp -a "$BK/tradekaro.site" /etc/nginx/sites-available/tradekaro
  cp -a "$BK/tradekaro-locations.conf" /etc/nginx/snippets/tradekaro-locations.conf
  nginx -t && echo "rolled back cleanly; the site was never reloaded"
  exit 1
fi

echo
echo "==> reloading nginx"
systemctl reload nginx
sleep 1
systemctl is-active nginx

echo
echo "=== through Cloudflare (expect 200) ==="
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 25 https://tradestox.pro/

echo "=== straight at the origin, no Cloudflare (expect 403) ==="
curl -sS -k -o /dev/null -w '%{http_code}\n' --max-time 15 \
  --resolve tradestox.pro:443:127.0.0.1 https://tradestox.pro/

echo "=== same, but claiming to be Cloudflare in the header (expect 403) ==="
curl -sS -k -o /dev/null -w '%{http_code}\n' --max-time 15 \
  -H 'CF-Connecting-IP: 104.16.0.1' -H 'X-Forwarded-For: 104.16.0.1' \
  --resolve tradestox.pro:443:127.0.0.1 https://tradestox.pro/

echo "=== ACME path must stay OPEN to the world (expect 404, NOT 403) ==="
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 \
  http://127.0.0.1/.well-known/acme-challenge/definitely-not-here

echo "=== plain HTTP to the origin (expect 403) ==="
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 http://127.0.0.1/

echo
echo "=== the app itself is untouched (expect 200) ==="
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 http://127.0.0.1:3000/

echo
echo "=== last log lines, first field is now the real client ==="
tail -3 /var/log/nginx/access.log
