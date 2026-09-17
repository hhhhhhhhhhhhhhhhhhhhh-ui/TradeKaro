#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# TradeKaro — redeploy after pushing to GitHub.
#
#   sudo bash /opt/tradekaro/deploy/deploy.sh
#
# Pulls, reinstalls, rebuilds and restarts. Your data is untouched: data/ is
# gitignored, so `git reset --hard` cannot remove the database.
#
# The service is stopped only for the ~2s restart, not for the build, so the app
# keeps serving while npm ci and next build run.
# ---------------------------------------------------------------------------
set -euo pipefail

APP_DIR=/opt/tradekaro
APP_USER=tradekaro
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

cd "$APP_DIR"

say "Taking a database snapshot first"
# Cheap insurance: the build below should never touch the DB, but if anything
# goes wrong this is the file you restore from.
if [[ -f data/trade.db ]]; then
  sudo -u "$APP_USER" node scripts/backup.mjs || {
    echo "WARNING: backup failed. Continuing, but you have no fresh snapshot." >&2
  }
else
  echo "no database yet - skipping backup"
fi

say "Pulling latest"
sudo -u "$APP_USER" git fetch --all --prune
BEFORE="$(sudo -u "$APP_USER" git rev-parse --short HEAD)"
sudo -u "$APP_USER" git reset --hard origin/main
AFTER="$(sudo -u "$APP_USER" git rev-parse --short HEAD)"
echo "$BEFORE -> $AFTER"

say "Installing dependencies"
sudo -u "$APP_USER" npm ci

say "Building"
# NEXT_PUBLIC_* values are baked in at build time, so load the env file first.
set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env.production"
set +a
sudo -u "$APP_USER" -E npm run build

say "Restarting service"
systemctl restart tradekaro
sleep 3

if systemctl is-active --quiet tradekaro; then
  echo "tradekaro is up ($AFTER, $STAMP)"
else
  echo "tradekaro FAILED to start — rolling back is not automatic. Check:" >&2
  echo "  journalctl -u tradekaro -n 80" >&2
  exit 1
fi

say "Post-deploy check"
# Verifies the app answers and the database is intact, not just that the process
# is running.
if curl -fsS --max-time 10 http://127.0.0.1:3000/api/market/stats >/dev/null; then
  echo "health endpoint OK"
else
  echo "WARNING: health endpoint did not answer" >&2
fi
