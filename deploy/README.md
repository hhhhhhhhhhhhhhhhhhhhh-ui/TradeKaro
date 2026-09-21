# Deploying TradeKaro to a Linux VPS

Tested target: Ubuntu 22.04/24.04 or Debian 12, Node 24, nginx, systemd.

## Why not serverless

This app keeps a SQLite file at `data/trade.db`, a websocket to the market feed, and a
60-second intraday square-off timer. It needs **a persistent disk and a process that stays
alive**, so Vercel / Netlify / Cloudflare Workers are not options — the database would be
wiped on every deploy.

## TL;DR

```bash
# On the VPS, as root:
git clone https://github.com/h0i5/Foursight.git /tmp/tk
sudo bash /tmp/tk/deploy/setup-vps.sh yourdomain.com
```

Then fill in `/opt/tradekaro/.env.production`, restart, and get a certificate.

## Step by step

### 1. DNS first

Point an `A` record for your domain at the server's IP **before** running certbot.
Everything else works before DNS propagates; only the certificate step waits on it.

### 2. Bootstrap the server

```bash
scp -r deploy root@YOUR_IP:/tmp/deploy      # or just git clone on the box
sudo bash /tmp/deploy/setup-vps.sh yourdomain.com
```

That installs Node 24, nginx, ufw; creates a `tradekaro` system user; clones the repo to
`/opt/tradekaro`; runs `npm ci` and `npm run build`; installs the systemd unit; and
configures nginx.

### 3. Secrets

The script deliberately does **not** create this file, so the values never pass through a
shell argument or into `history`:

```bash
sudo -u tradekaro tee /opt/tradekaro/.env.production >/dev/null <<'ENV'
UPSTOX_ANALYTICS_TOKEN=your-token
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=pick-something-strong
AUTH_SECRET=replace-me
NEXT_PUBLIC_SITE_URL=https://yourdomain.com
ENV
sudo chmod 600 /opt/tradekaro/.env.production
sudo chown tradekaro:tradekaro /opt/tradekaro/.env.production
```

Generate a real `AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Leave `ADMIN_PASSWORD` blank if you prefer — a random one is generated on first boot and
printed once to the journal (`journalctl -u tradekaro | grep 'bootstrap password'`).

`NEXT_PUBLIC_SITE_URL` is inlined at **build** time, so after changing it you must rebuild:

```bash
sudo bash /opt/tradekaro/deploy/deploy.sh
```

### 4. Start and verify

```bash
sudo systemctl restart tradekaro
systemctl status tradekaro
journalctl -u tradekaro -f
```

In another shell, on the box:

```bash
curl -fsS http://127.0.0.1:3000/api/market/stats
```

If that answers, the app is healthy and any remaining problem is nginx or DNS.

### 5. TLS

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

### 6. Run the test suite against production (optional)

```bash
cd /opt/tradekaro
sudo -u tradekaro ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... \
  node scripts/smoke.mjs https://yourdomain.com
```

## Redeploying

```bash
sudo bash /opt/tradekaro/deploy/deploy.sh
```

It snapshots the database, pulls `origin/main`, reinstalls, rebuilds, restarts, and checks
the health endpoint. The app keeps serving during the build; only the restart (~2s) is
downtime.

## Backups

`data/` is gitignored, so it never travels with the repo — back it up yourself:

```bash
sudo crontab -e
# nightly at 02:30, keeping 30 copies
30 2 * * * cd /opt/tradekaro && /usr/bin/node scripts/backup.mjs >> /var/log/tradekaro-backup.log 2>&1
```

Keep at least one copy **off the server** (rclone to object storage, or `scp` elsewhere).
This database holds every account and the admin password hashes.

## Conversion dispatch timer

Conversions are queued in the database when they happen and sent later, so something has
to drain the queue. That is `tradekaro-dispatch.timer`, and it is **not** installed by
`setup-vps.sh` — it needs a secret that only exists once you have generated one.

One timer serves the whole site. The queue is a single table holding every partner's owed
conversions, so fifty partners with fifty pixels is still one timer.

### Install

Generate the shared secret. The app and the timer must agree on it or every run is a 401:

```bash
SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "TRACKING_DISPATCH_SECRET=$SECRET" | sudo -u tradekaro tee -a /opt/tradekaro/.env.production
```

Install the units from the repo, so they are versioned rather than hand-typed on the host:

```bash
sudo install -m 644 /opt/tradekaro/deploy/tradekaro-dispatch.service /etc/systemd/system/
sudo install -m 644 /opt/tradekaro/deploy/tradekaro-dispatch.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart tradekaro          # picks up the new secret
sudo systemctl enable --now tradekaro-dispatch.timer
```

### Verify

```bash
systemctl list-timers tradekaro-dispatch.timer   # NEXT should be within 5 minutes
sudo systemctl start tradekaro-dispatch.service  # run one now, without waiting
systemctl status tradekaro-dispatch.service      # Active: inactive (dead) is SUCCESS for oneshot
journalctl -u tradekaro-dispatch -n 20
```

A healthy idle run prints:

```json
{"ok":true,"skipped":"nothing_configured","configured":[],"partnerPixels":0,"requeued":0}
```

That means no platform pixel is configured and no partner has one either, so the endpoint
returned without touching the queue. It is the normal state until you set tracking up, and
it costs one indexed count — the timer is meant to run always rather than be switched on
when a partner adds a pixel, because tying a schedule to database state means every
failure mode is silent.

Once a pixel exists the same call starts doing real work and reports something like
`{"ok":true,"considered":3,"sent":3,...}`. Nothing about the timer changes; it simply
stops short-circuiting. A partner saving a pixel also triggers a backfill immediately, so
their already-recorded conversions are forwarded without waiting for the next tick.

### If it 401s

```bash
journalctl -u tradekaro-dispatch -n 5     # look for "Unauthorized"
```

The secret in `/opt/tradekaro/.env.production` must match what the app sees. Two things
that catch people out: the app reads that file at **startup**, so a new secret needs
`systemctl restart tradekaro`; and systemd reads it for the *timer* separately, which is
why the value lives in one file rather than being written into the unit.

### Recovering terminal deliveries

A conversion that failed five times is marked `failed` and stops being retried. After
fixing the cause — a rotated token, a wrong pixel id — put them back in the queue:

```bash
sudo -u tradekaro bash -c 'set -a; . /opt/tradekaro/.env.production; set +a
curl -fsS -X POST -H "x-dispatch-secret: $TRACKING_DISPATCH_SECRET" \
  "http://127.0.0.1:3000/api/track/dispatch?requeue=1"'

# see what is owed, by provider and status
sudo -u tradekaro bash -c 'set -a; . /opt/tradekaro/.env.production; set +a
curl -fsS -H "x-dispatch-secret: $TRACKING_DISPATCH_SECRET" \
  "http://127.0.0.1:3000/api/track/dispatch"'
```

## Troubleshooting

| Symptom                             | Cause                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Page loads, prices never update     | SSE is buffered. Confirm `proxy_buffering off` on `/api/market/stream` and that `X-Accel-Buffering: no` reaches the browser. |
| `502 Bad Gateway`                   | The app is not listening. `systemctl status tradekaro`, then `journalctl -u tradekaro -n 80`.                                |
| `connection refused` from nginx     | `HOSTNAME` is not `0.0.0.0`, so Node bound to localhost only.                                                                |
| `Cannot find module 'node:sqlite'`  | Node is older than 23.4. `node -v` must be 24.x.                                                                             |
| All users logged out after a deploy | `AUTH_SECRET` changed. That is expected — it signs the session cookies.                                                      |
| Every account gone after a deploy   | `data/` was not preserved. It must stay outside the repo, on a path that survives deploys.                                   |
| Squares-off never run               | The process must stay up. `Restart=always` is already set; check the service is not being OOM-killed.                        |
| Conversions never leave the server  | No dispatch timer. `systemctl list-timers tradekaro-dispatch.timer` — nothing listed means it was never enabled.             |
| The timer fires but always 401s     | `TRACKING_DISPATCH_SECRET` is missing or the app has not been restarted since it was added. See "If it 401s" above.         |
| Unit file edited but nothing changed | systemd reads these into memory. `systemctl daemon-reload` after editing, and re-`install` after pulling a new version.      |
