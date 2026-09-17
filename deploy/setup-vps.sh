#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# TradeKaro — one-shot setup for a fresh Ubuntu/Debian VPS.
#
#   sudo bash deploy/setup-vps.sh yourdomain.com
#
# Installs Node 24, nginx and a firewall, creates the service user, clones the
# repo, builds it and starts it under systemd. Safe to re-run: every step checks
# before it acts, and the database is never touched.
#
# It does NOT create .env.production — do that by hand (see the runbook) so
# secrets never pass through a script argument or shell history.
# ---------------------------------------------------------------------------
set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-https://github.com/h0i5/Foursight.git}"
APP_DIR=/opt/tradekaro
APP_USER=tradekaro

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash deploy/setup-vps.sh yourdomain.com" >&2
  exit 1
fi

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

say "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git nginx ufw ca-certificates

# --- Node 24 -----------------------------------------------------------------
# Hard requirement, not a preference: the backend is built on the built-in
# node:sqlite module, which only works unflagged from Node 23.4/24 onward.
say "Installing Node.js 24"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$MAJOR" -ge 24 ]]; then
    echo "node $(node -v) already installed"
    NEED_NODE=0
  fi
fi
if [[ "$NEED_NODE" -eq 1 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

# --- Service user ------------------------------------------------------------
say "Creating service user and app directory"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"

# --- Code --------------------------------------------------------------------
if [[ -d "$APP_DIR/.git" ]]; then
  say "Updating existing checkout"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" reset --hard origin/main
else
  say "Cloning $REPO"
  # git clone accepts an existing *empty* directory, which is all mkdir left
  # behind. Anything else is a genuine conflict and should fail loudly rather
  # than be silently overwritten.
  git clone "$REPO" "$APP_DIR"
fi

# data/ is gitignored, so it never arrives with the clone. Create it before the
# service user is asked to write into it.
mkdir -p "$APP_DIR/data"

if [[ ! -f "$APP_DIR/.env.production" ]]; then
  say "No .env.production found"
  cat >&2 <<'EOF'
Create it before starting the service:

  sudo -u tradekaro tee /opt/tradekaro/.env.production >/dev/null <<'ENV'
  UPSTOX_ANALYTICS_TOKEN=paste-token-here
  ADMIN_EMAIL=you@example.com
  ADMIN_PASSWORD=pick-a-strong-one
  AUTH_SECRET=paste-64-hex-chars
  NEXT_PUBLIC_SITE_URL=https://yourdomain.com
  ENV
  sudo chmod 600 /opt/tradekaro/.env.production
  sudo chown tradekaro:tradekaro /opt/tradekaro/.env.production

Generate AUTH_SECRET with:
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
EOF
fi

# --- Build -------------------------------------------------------------------
say "Installing dependencies and building"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci"
# NEXT_PUBLIC_* is inlined at build time, so it has to be present NOW, not just
# when the service starts.
if [[ -f "$APP_DIR/.env.production" ]]; then
  set -a; . "$APP_DIR/.env.production"; set +a
fi
sudo -u "$APP_USER" -E bash -c "cd '$APP_DIR' && npm run build"

# --- systemd -----------------------------------------------------------------
say "Installing systemd service"
cp "$APP_DIR/deploy/tradekaro.service" /etc/systemd/system/tradekaro.service
systemctl daemon-reload
systemctl enable tradekaro
systemctl restart tradekaro

# --- nginx -------------------------------------------------------------------
say "Configuring nginx for $DOMAIN"
sed "s/YOUR_DOMAIN/$DOMAIN/g" "$APP_DIR/deploy/nginx-tradekaro.conf" \
  > /etc/nginx/sites-available/tradekaro
ln -sf /etc/nginx/sites-available/tradekaro /etc/nginx/sites-enabled/tradekaro
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# --- Firewall ----------------------------------------------------------------
say "Configuring firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

# --- Report ------------------------------------------------------------------
say "Service status"
systemctl is-active tradekaro && echo "tradekaro is running" || echo "tradekaro FAILED to start - check: journalctl -u tradekaro -n 50"

cat <<EOF

Next steps
  1. Point $DOMAIN's A record at this server, then turn on HTTPS:
       bash $APP_DIR/deploy/enable-tls.sh
     Read the header of that script first — it takes either a Cloudflare Origin
     Certificate or a Cloudflare API token, and explains why plain
     \`certbot --nginx\` cannot work while Cloudflare proxies the domain
     (Cloudflare answers port 80 itself and 301s the ACME challenge).
  2. Confirm the app answers:
       curl -fsS http://127.0.0.1:3000/api/market/stats | head -c 200
  3. Read the bootstrap admin password if you left ADMIN_PASSWORD blank:
       journalctl -u tradekaro | grep 'bootstrap password'
  4. Logs:    journalctl -u tradekaro -f
     Restart: systemctl restart tradekaro

EOF
