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
 * back once every existing connection has ended. Two things never end on their
 * own, and `closeAllConnections()` is dev-only — so in production the callback
 * never fired, `process.exit(143)` was never reached, and systemd escalated to
 * SIGKILL after the full 30s `TimeoutStopSec`:
 *
 *   1. the market SSE streams, which are open by design; and
 *   2. nginx's idle upstream keep-alive sockets — measured 3 idle connections on
 *      :3000 after five Cloudflare-proxied requests, and a restart that then took
 *      30.13s. `server.close()` waits for idle sockets as well as busy ones.
 *
 * All 30 of those seconds were downtime rather than a grace period: the listener
 * was already closed from the instant SIGTERM landed, so nginx got
 * `connect() failed (111: Connection refused)` on 127.0.0.1:3000 and returned 502
 * to every visitor. Confirmed in `/var/log/nginx/error.log` during the `678beea`
 * deploy (11:04:15 refused, killed 11:04:24, SIGTERM at the top of that window).
 *
 * So this does two things: ends the registered streams (a direct curl with one
 * stream open then exits in 0.06s) and, because streams are only half the story,
 * caps the whole stop at 1.5s so nothing else can pin the timeout again.
 *
 * Measured on the VPS, worst case (idle keep-alive sockets *and* a live SSE
 * client): 30.0s + SIGKILL  →  1.56s, clean stop, no timeout.
 *
 * ⚠️ Tried and removed: walking `process._getActiveHandles()` for anything
 * exposing `closeIdleConnections()`. On Node 24 here it never reached the server
 * — the stop was 1.56s with it and without it — so it was deleted rather than left
 * in as folklore. The backstop is what actually bounds the stop. Don't re-add it
 * without measuring a difference.
 *
 * ⚠️ `installShutdownHook()` must be called at boot from `instrumentation.ts`,
 * not lazily. With keep-alive sockets but no SSE client connected, no route would
 * ever call `onShutdown` and the handler would never be installed — which is how
 * the first version of this file shipped and still took 30s.
 */
const closers = new Set<() => void>();
let hooked = false;

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

  // Hard backstop. The listener stopped accepting the instant SIGTERM landed, so
  // every millisecond from here is a 502 for a real visitor. Cap the wait instead
  // of sitting out TimeoutStopSec and being SIGKILLed — which is what made every
  // deploy a 30s outage. unref() so that if Next's own clean exit wins the race,
  // this never fires. In-flight responses have had the whole SIGTERM→here window
  // plus 1.5s to finish, and nothing new can arrive because the listener is shut.
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
