/**
 * Cooperative shutdown for a `next start` process.
 *
 * `next start` installs its own SIGTERM handler (see
 * `next/dist/server/lib/start-server.js`) that does:
 *
 *     await new Promise((res) => {
 *       server.close(() => res());
 *       if (isDev) server.closeAllConnections();   // dev only
 *     });
 *     ...
 *     process.exit(143);
 *
 * `server.close()` stops accepting new connections *immediately* but only calls
 * back once every existing connection has ended. Two kinds of connection never
 * end on their own, and `closeAllConnections()` is dev-only — so in production
 * the callback never fired, `process.exit(143)` was never reached, and systemd
 * escalated to SIGKILL after the full 30s `TimeoutStopSec`.
 *
 *   1. the market SSE streams, which are open by design; and
 *   2. nginx's idle upstream keep-alive sockets. `ss -tn state established
 *      '( sport = :3000 )'` showed 2 idle connections after three
 *      Cloudflare-proxied requests, and a restart then measured 30.13s. One idle
 *      socket pins the whole timeout — `server.close()` waits for idle sockets as
 *      well as busy ones, and Node's `server.closeIdleConnections()` (the right
 *      tool) is never called by Next outside dev.
 *
 * All 30 of those seconds were downtime rather than a grace period: the listener
 * was already closed from the instant SIGTERM landed, so nginx got
 * `connect() failed (111: Connection refused)` on 127.0.0.1:3000 and returned 502
 * to every visitor. Confirmed in `/var/log/nginx/error.log` during the `678beea`
 * deploy (11:04:15 refused, killed 11:04:24, SIGTERM at the top of that window).
 *
 * So: end the registered streams, close the idle sockets, and keep a hard
 * backstop so no other handle type can pin the timeout again.
 *
 * ⚠️ `installShutdownHook()` must be called at boot from `instrumentation.ts`,
 * not lazily. With keep-alive sockets but no SSE client connected, no route would
 * ever call `onShutdown` and the handler would never be installed — which is how
 * the first version of this file shipped and still took 30s.
 */
const closers = new Set<() => void>();
let hooked = false;

/**
 * Best-effort close of idle keep-alive sockets.
 *
 * A route has no supported way to reach the HTTP server object, so walk the
 * active handles. Internal API, hence the guards — the backstop below covers a
 * miss, so failing silently here is fine.
 */
function closeIdleSockets() {
  try {
    const handles = (
      process as unknown as { _getActiveHandles?: () => unknown[] }
    )._getActiveHandles?.();
    for (const h of handles ?? []) {
      const fn = (h as { closeIdleConnections?: () => void })
        ?.closeIdleConnections;
      if (typeof fn === "function") fn.call(h);
    }
  } catch {
    /* the backstop below covers us */
  }
}

function endAll() {
  // Iterate a copy: a closer that de-registers itself mutates the set.
  for (const close of [...closers]) {
    try {
      close();
    } catch {
      /* already gone */
    }
  }
  closers.clear();
  closeIdleSockets();
  // A stream's socket only counts as idle a tick after its response has ended, so
  // the sweep above runs too early to reap the SSE connections it just closed.
  // Sweep again shortly after — when that works, Next's own clean exit wins the
  // race and the backstop below never fires.
  for (const ms of [50, 250, 600]) {
    setTimeout(closeIdleSockets, ms).unref();
  }

  // Hard backstop. The listener stopped accepting the instant SIGTERM landed, so
  // every millisecond from here is a 502 for a real visitor. Cap the wait instead
  // of sitting out TimeoutStopSec and being SIGKILLed — which is what made every
  // deploy a 30s outage. unref() so that if Next's own clean exit wins the race,
  // this never fires.
  setTimeout(() => process.exit(0), 1500).unref();
}

/** Install the process-level handlers. Idempotent. */
export function installShutdownHook(): void {
  if (hooked) return;
  if (typeof process === "undefined" || typeof process.on !== "function")
    return;
  hooked = true;
  process.once("SIGTERM", endAll);
  process.once("SIGINT", endAll);
}

/**
 * Register a teardown to run when the process is asked to stop.
 * Returns a de-registration function; calling it is safe at any time.
 */
export function onShutdown(close: () => void): () => void {
  installShutdownHook();
  closers.add(close);
  return () => {
    closers.delete(close);
  };
}
