#!/usr/bin/env bash
# Validate the TLS nginx config end-to-end with a throwaway self-signed cert.
# If Cloudflare's SSL mode is "Full" this also makes the site reachable
# immediately; if it is "Full (strict)" the response changes from 522 to 526,
# which tells us a real certificate is required.
set -euo pipefail

DOMAIN=tradestox.pro
LIVE=/etc/letsencrypt/live/$DOMAIN
APP_DIR=/opt/tradekaro

mkdir -p "$LIVE" /etc/nginx/snippets /var/www/certbot

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$LIVE/privkey.pem" \
  -out "$LIVE/fullchain.pem" \
  -subj "/CN=$DOMAIN" \
  -addext "subjectAltName=DNS:$DOMAIN,DNS:www.$DOMAIN" 2>/dev/null

chmod 600 "$LIVE/privkey.pem"
echo "placeholder cert written"

install -m 644 "$APP_DIR/deploy/nginx-tradekaro-locations.conf" \
  /etc/nginx/snippets/tradekaro-locations.conf
sed "s/YOUR_DOMAIN/$DOMAIN/g" "$APP_DIR/deploy/nginx-tradekaro.conf" \
  > /etc/nginx/sites-available/tradekaro
ln -sf /etc/nginx/sites-available/tradekaro /etc/nginx/sites-enabled/tradekaro

nginx -t
systemctl reload nginx

echo "--- local 443 check ---"
curl -sk -o /dev/null -w "https://127.0.0.1/ -> %{http_code}\n" https://127.0.0.1/
echo "--- port 80 still serves the IP ---"
curl -s -o /dev/null -w "http://127.0.0.1/ -> %{http_code}\n" http://127.0.0.1/
echo "--- SSE path still configured on 443? ---"
grep -c "proxy_buffering off" /etc/nginx/snippets/tradekaro-locations.conf
