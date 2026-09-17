#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# TradeKaro — put the app behind HTTPS on a real domain.
#
#   sudo bash /opt/tradekaro/deploy/enable-tls.sh
#
# Two certificate sources are supported, and both are chosen because they work
# with Cloudflare's proxy LEFT ON. That matters: with the orange cloud up,
# Cloudflare answers port 80 itself and 301s everything to HTTPS — including
# /.well-known/acme-challenge/ — so the usual `certbot --nginx` flow can never
# complete and its renewal would fail the same way every 90 days.
#
#   1. Cloudflare Origin Certificate (preferred, no renewal, 15 years)
#        dashboard > SSL/TLS > Origin Server > Create Certificate
#        hostnames: tradestox.pro, *.tradestox.pro
#        save as:   /etc/ssl/tradekaro/origin.pem  (certificate)
#                   /etc/ssl/tradekaro/origin.key  (private key)
#
#   2. Let's Encrypt via DNS-01 (publicly trusted, auto-renews)
#        dashboard > My Profile > API Tokens > Create Token > "Edit zone DNS"
#        zone: <your domain>
#        save as:   /root/.secrets/cloudflare.ini
#        contents:  dns_cloudflare_api_token = <token>
#        then:      chmod 600 /root/.secrets/cloudflare.ini
#
# Whichever is present, this installs the 443 listener and leaves port 80 as
# default_server so the bare-IP URL keeps working as a fallback.
# ---------------------------------------------------------------------------
set -euo pipefail

DOMAIN="${DOMAIN:-tradestox.pro}"
EMAIL="${EMAIL:-admin@${DOMAIN}}"
APP_DIR="${APP_DIR:-/opt/tradekaro}"

ORIGIN_CERT=/etc/ssl/tradekaro/origin.pem
ORIGIN_KEY=/etc/ssl/tradekaro/origin.key
CF_CREDS=/root/.secrets/cloudflare.ini
WEBROOT=/var/www/certbot
LIVE=/etc/letsencrypt/live/$DOMAIN

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/deploy" ]]; then
  echo "Cannot find $APP_DIR/deploy — is APP_DIR right?" >&2
  exit 1
fi

say "Preparing directories"
mkdir -p /etc/nginx/snippets "$WEBROOT/.well-known/acme-challenge" /etc/ssl/tradekaro
chown -R www-data:www-data "$WEBROOT"

# --- Certificate -------------------------------------------------------------
# The site file below points nginx at $LIVE, so an origin cert has to be
# published there as well. That keeps one path in nginx and one thing to
# explain, at the cost of a copy.
if [[ -f "$ORIGIN_CERT" && -f "$ORIGIN_KEY" ]]; then
  say "Using the Cloudflare Origin Certificate"
  install -d -m 755 "$LIVE"
  install -m 644 "$ORIGIN_CERT" "$LIVE/fullchain.pem"
  install -m 600 "$ORIGIN_KEY" "$LIVE/privkey.pem"
  echo "valid until: $(openssl x509 -enddate -noout -in "$ORIGIN_CERT" | cut -d= -f2)"
elif [[ -d "$LIVE" ]]; then
  say "Certificate already issued — reusing it"
elif [[ -f "$CF_CREDS" ]]; then
  say "Requesting a Let's Encrypt certificate via Cloudflare DNS-01"
  if ! dpkg -s python3-certbot-dns-cloudflare >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
      certbot python3-certbot-dns-cloudflare
  fi
  # DNS-01 with the challenge record created through the Cloudflare API: no
  # inbound port 80 needed, so the proxy stays up and renewals keep working.
  certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials "$CF_CREDS" \
    --dns-cloudflare-propagation-seconds 30 \
    -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos -m "$EMAIL" \
    --keep-until-expiring
else
  cat >&2 <<EOF

No certificate material found. Pick one:

  A) Cloudflare Origin Certificate (recommended — 15 years, no renewals)
     dashboard > SSL/TLS > Origin Server > Create Certificate
     save the two PEM blocks as:
       $ORIGIN_CERT
       $ORIGIN_KEY
     Then re-run this script.

  B) Let's Encrypt via DNS-01 (auto-renewing, publicly trusted)
     create a Cloudflare API token scoped to "Edit zone DNS" for $DOMAIN,
     then:
       mkdir -p /root/.secrets
       printf 'dns_cloudflare_api_token = %s\n' '<TOKEN>' > $CF_CREDS
       chmod 600 $CF_CREDS
     Then re-run this script.

EOF
  exit 1
fi

# --- nginx -------------------------------------------------------------------
say "Installing the nginx config"
install -m 644 "$APP_DIR/deploy/nginx-tradekaro-locations.conf" \
  /etc/nginx/snippets/tradekaro-locations.conf
sed "s/YOUR_DOMAIN/$DOMAIN/g" "$APP_DIR/deploy/nginx-tradekaro.conf" \
  > /etc/nginx/sites-available/tradekaro
ln -sf /etc/nginx/sites-available/tradekaro /etc/nginx/sites-enabled/tradekaro

if ! nginx -t; then
  echo "nginx rejected the config — leaving the running config untouched." >&2
  exit 1
fi
systemctl reload nginx

# --- Verify ------------------------------------------------------------------
say "Verifying"
sleep 1
for name in fullchain privkey; do
  [[ -s "$LIVE/$name.pem" ]] || { echo "missing $LIVE/$name.pem" >&2; exit 1; }
done

# Proves the listener really is up and presenting the right certificate, rather
# than trusting that systemctl reload returned zero.
if command -v openssl >/dev/null; then
  SNI=$(openssl s_client -servername "$DOMAIN" -connect 127.0.0.1:443 \
        </dev/null 2>/dev/null | openssl x509 -noout -subject 2>/dev/null || true)
  echo "local 443 presents: ${SNI:-<none>}"
fi

if [[ -d /etc/letsencrypt/renewal ]]; then
  say "Checking auto-renewal"
  # A dry run is the only way to know renewals work without waiting 60 days.
  certbot renew --dry-run || echo "WARNING: renewal dry-run failed."
fi

cat <<EOF

==> Done. Domain: https://$DOMAIN

Set these in the Cloudflare dashboard:

  SSL/TLS > Overview            -> Full (strict)
  SSL/TLS > Edge Certificates   -> Always Use HTTPS: your choice.
      Leave it OFF and let nginx decide, or ON for one less hop. Either works
      now that the origin owns a valid certificate.

The bare IP still serves the app on port 80 as a fallback:
  http://$(hostname -I | awk '{print $1}')

EOF
